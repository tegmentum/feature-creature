//! Wasmtime host runner for the portable Wasm feature detector.
//!
//! Two modes:
//!  * default (core module): instantiates `detector.wasm`, supplies the
//!    raw `engine.validate` core-ABI import, invokes `detect`, and
//!    decodes the returned bitmap.
//!  * `--component`: instantiates the component-model variant against
//!    the `detector` world in `wit/engine.wit`, provides
//!    `wasm-feature-detect:engine/engine.validate` as a canonical-ABI
//!    import, and calls `detect-core`.
//!
//! Both modes emit the same feature bitmap, decoded against
//! `features.toml`.

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{env, fs, path::PathBuf, process::ExitCode};
use wasmtime::{Caller, Config, Engine, Linker, Module, Store};

/// Resolved wasmtime version, read from Cargo.lock at build time by
/// `build.rs`. Wasmtime doesn't expose a `VERSION` constant to source
/// this from at runtime.
const WASMTIME_VERSION: &str = env!("WASMTIME_VERSION");

#[derive(Deserialize)]
struct Registry {
    feature: Vec<Feature>,
}

#[derive(Deserialize, Clone)]
struct Feature {
    name: String,
    bit: u32,
    #[allow(dead_code)]
    probe: String,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<()> {
    let Args {
        detector_path,
        json,
        component,
    } = parse_args()?;

    let workspace_root = detect_workspace_root()?;
    let registry_src =
        fs::read_to_string(workspace_root.join("features.toml")).context("read features.toml")?;
    let mut registry: Registry = toml::from_str(&registry_src).context("parse features.toml")?;
    registry.feature.sort_by_key(|f| f.bit);

    let engine = build_engine()?;

    let bitmap = if component {
        let detector_path =
            detector_path.unwrap_or_else(|| default_component_path(&workspace_root));
        detect_via_component(&engine, &detector_path)?
    } else {
        let detector_path = detector_path.unwrap_or_else(|| default_detector_path(&workspace_root));
        detect_via_core_module(&engine, &detector_path, registry.feature.len())?
    };

    if json {
        emit_json(&registry.feature, &bitmap)?;
    } else {
        emit_pretty(&registry.feature, &bitmap);
    }

    Ok(())
}

/// Turn every proposal Wasmtime knows about on so probes get their
/// fairest shot at validating. Retries once with stack-switching off if
/// the linked wasmtime + compiler combination refuses to build (as
/// historically happened for `wasm_stack_switching` under Cranelift).
fn build_engine() -> Result<Engine> {
    let mut cfg = Config::new();
    cfg.wasm_simd(true)
        .wasm_relaxed_simd(true)
        .wasm_bulk_memory(true)
        .wasm_multi_value(true)
        .wasm_multi_memory(true)
        .wasm_reference_types(true)
        .wasm_tail_call(true)
        .wasm_threads(true)
        .wasm_memory64(true)
        .wasm_gc(true)
        .wasm_function_references(true)
        .wasm_exceptions(true)
        .wasm_extended_const(true)
        .wasm_custom_page_sizes(true)
        .wasm_wide_arithmetic(true)
        .wasm_stack_switching(true);
    // The component runner also needs the component-model on. It's
    // already enabled by the crate's feature flags, but flip the config
    // bit explicitly so future refactors don't quietly disable it.
    cfg.wasm_component_model(true);
    match Engine::new(&cfg) {
        Ok(e) => Ok(e),
        Err(_) => {
            cfg.wasm_stack_switching(false);
            Engine::new(&cfg).map_err(|e| anyhow!("construct wasmtime engine: {e}"))
        }
    }
}

fn detect_via_core_module(
    engine: &Engine,
    detector_path: &std::path::Path,
    registry_len: usize,
) -> Result<Vec<u8>> {
    let module = Module::from_file(engine, detector_path)
        .map_err(|e| anyhow!("load {}: {e}", detector_path.display()))?;

    let mut linker: Linker<()> = Linker::new(engine);
    linker.func_wrap(
        "engine",
        "validate",
        |mut caller: Caller<'_, ()>, ptr: u32, len: u32| -> i32 {
            let mem = match caller.get_export("memory").and_then(|e| e.into_memory()) {
                Some(m) => m,
                None => return 0,
            };
            let data = mem.data(&caller);
            let start = ptr as usize;
            let end = start.saturating_add(len as usize);
            if end > data.len() {
                return 0;
            }
            let bytes = &data[start..end];
            match Module::validate(caller.engine(), bytes) {
                Ok(()) => 1,
                Err(_) => 0,
            }
        },
    )?;

    let mut store = Store::new(engine, ());
    let instance = linker.instantiate(&mut store, &module)?;
    let memory = instance
        .get_memory(&mut store, "memory")
        .ok_or_else(|| anyhow!("detector did not export memory"))?;
    let feature_count = instance
        .get_typed_func::<(), u32>(&mut store, "feature_count")?
        .call(&mut store, ())?;
    let result_buffer = instance
        .get_typed_func::<(), u32>(&mut store, "result_buffer")?
        .call(&mut store, ())?;
    let result_capacity = instance
        .get_typed_func::<(), u32>(&mut store, "result_capacity")?
        .call(&mut store, ())?;
    let written = instance
        .get_typed_func::<(u32, u32), i32>(&mut store, "detect")?
        .call(&mut store, (result_buffer, result_capacity))?;
    if written < 0 {
        return Err(anyhow!("detect returned {written}"));
    }
    let written = written as usize;

    let mut bitmap = vec![0u8; written];
    memory
        .read(&mut store, result_buffer as usize, &mut bitmap)
        .context("read result bitmap")?;

    if feature_count as usize != registry_len {
        eprintln!(
            "warning: detector reports {feature_count} features but features.toml lists {registry_len}"
        );
    }

    Ok(bitmap)
}

/// Load a component-model detector and drive it through the `detector`
/// world defined in `wit/engine.wit`. Accepts either an already-encoded
/// component or a raw core wasm produced by wit-bindgen (in which case
/// it embeds the WIT metadata into a component in-memory via
/// `wit-component`).
fn detect_via_component(engine: &Engine, detector_path: &std::path::Path) -> Result<Vec<u8>> {
    use wasmtime::component::{Component, Linker as CLinker};

    let raw =
        fs::read(detector_path).map_err(|e| anyhow!("read {}: {e}", detector_path.display()))?;
    let encoded = ensure_component(raw).context("encode core module as component")?;

    let component = Component::from_binary(engine, &encoded)
        .map_err(|e| anyhow!("load component {}: {e}", detector_path.display()))?;

    let validator_engine = engine.clone();
    let mut linker: CLinker<()> = CLinker::new(engine);
    // `wasm-feature-detect:engine` is the WIT package name and `engine`
    // is the interface name inside it — see `wit/engine.wit`. The world
    // pulls the interface in via `import engine;` so components see it
    // at this fully-qualified path.
    // Wasmtime's component `Linker::instance` returns `wasmtime::Error`,
    // which doesn't implement `StdError` in this build, so
    // `anyhow::Context` won't attach. Use `map_err` instead.
    let mut iface = linker
        .instance("wasm-feature-detect:engine/engine@0.1.0")
        .map_err(|e| anyhow!("declare engine import instance: {e}"))?;
    iface
        .func_wrap(
            "validate",
            // `component::LinkerInstance::func_wrap` requires the
            // closure to return `wasmtime::Result`, not `anyhow::Result`.
            move |_store, (bytes,): (Vec<u8>,)| -> wasmtime::Result<(bool,)> {
                Ok((Module::validate(&validator_engine, &bytes).is_ok(),))
            },
        )
        .map_err(|e| anyhow!("wire engine.validate import: {e}"))?;

    let mut store = Store::new(engine, ());
    let instance = linker
        .instantiate(&mut store, &component)
        .map_err(|e| anyhow!("instantiate detector component: {e}"))?;

    // The `detect-core` export is defined at the world root, so it
    // lives directly on the instance's root exports.
    let detect_core = instance
        .get_typed_func::<(), (Vec<u8>,)>(&mut store, "detect-core")
        .map_err(|e| anyhow!("lookup detect-core export: {e}"))?;
    let (bitmap,) = detect_core
        .call(&mut store, ())
        .map_err(|e| anyhow!("call detect-core: {e}"))?;
    // Wasmtime 47's component TypedFunc handles post-return implicitly;
    // an explicit call is deprecated as a no-op.

    Ok(bitmap)
}

/// Return `bytes` unchanged if it's already a component-model binary,
/// otherwise wrap it as a component by encoding wit-bindgen's embedded
/// `component-type` metadata via `wit_component::ComponentEncoder`.
fn ensure_component(bytes: Vec<u8>) -> Result<Vec<u8>> {
    // Component-model preamble: `\0asm` followed by little-endian
    // version=0x000d, layer=0x0001. Core modules use version=1, layer=0.
    const COMPONENT_MAGIC: &[u8; 8] = b"\x00asm\x0d\x00\x01\x00";
    if bytes.len() >= 8 && &bytes[0..8] == COMPONENT_MAGIC {
        return Ok(bytes);
    }
    let encoded = wit_component::ComponentEncoder::default()
        .validate(true)
        .module(&bytes)?
        .encode()?;
    Ok(encoded)
}

struct Args {
    detector_path: Option<PathBuf>,
    json: bool,
    component: bool,
}

fn parse_args() -> Result<Args> {
    let mut json = false;
    let mut component = false;
    let mut detector_path: Option<PathBuf> = None;
    let mut it = env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--component" => component = true,
            "--" => {
                if let Some(p) = it.next() {
                    detector_path = Some(PathBuf::from(p));
                }
                break;
            }
            s if s.starts_with("--") => {
                usage_and_exit();
            }
            _ => {
                if detector_path.is_some() {
                    usage_and_exit();
                }
                detector_path = Some(PathBuf::from(arg));
            }
        }
    }
    Ok(Args {
        detector_path,
        json,
        component,
    })
}

fn usage_and_exit() -> ! {
    eprintln!("usage: wasm-feature-detect [--json] [--component] [detector.wasm]");
    std::process::exit(2);
}

fn bit_is_set(bitmap: &[u8], bit: u32) -> bool {
    let byte = bit as usize / 8;
    let mask = 1u8 << (bit as usize % 8);
    bitmap.get(byte).map(|b| b & mask != 0).unwrap_or(false)
}

fn emit_pretty(features: &[Feature], bitmap: &[u8]) {
    for feature in features {
        let on = bit_is_set(bitmap, feature.bit);
        println!("{:24} {}", feature.name, if on { "yes" } else { "no" });
    }
}

fn emit_json(features: &[Feature], bitmap: &[u8]) -> Result<()> {
    // Preserve insertion order (features arrive sorted by bit) — requires
    // serde_json's `preserve_order` feature.
    let mut feature_map = Map::new();
    for feature in features {
        feature_map.insert(
            feature.name.clone(),
            Value::Bool(bit_is_set(bitmap, feature.bit)),
        );
    }
    let manifest = json!({
        "schema": "wasm-feature-detect/capability-manifest/v1",
        "namespace": "wasm.core",
        "host": {
            "engine": "wasmtime",
            "version": WASMTIME_VERSION,
        },
        "features": Value::Object(feature_map),
    });
    let out = serde_json::to_string_pretty(&manifest).context("serialize manifest")?;
    println!("{out}");
    Ok(())
}

fn default_detector_path(workspace_root: &std::path::Path) -> PathBuf {
    workspace_root.join("target/wasm32-unknown-unknown/release/wasm_feature_detector.wasm")
}

fn default_component_path(workspace_root: &std::path::Path) -> PathBuf {
    workspace_root
        .join("target/wasm32-unknown-unknown/release/wasm_feature_detector_component.wasm")
}

fn detect_workspace_root() -> Result<PathBuf> {
    let mut dir = env::current_dir()?;
    loop {
        if dir.join("features.toml").is_file() && dir.join("Cargo.toml").is_file() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err(anyhow!("could not locate workspace root (features.toml)"));
        }
    }
}
