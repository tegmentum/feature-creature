//! Wasmtime host runner for the portable Wasm feature detector.
//!
//! Instantiates `detector.wasm`, supplies the `engine.validate` import
//! backed by Wasmtime's own module validator, invokes `detect`, and prints
//! the resulting feature bitmap decoded against `features.toml`.

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
        self_check,
    } = parse_args()?;

    let workspace_root = detect_workspace_root()?;
    let registry_src =
        fs::read_to_string(workspace_root.join("features.toml")).context("read features.toml")?;
    let mut registry: Registry = toml::from_str(&registry_src).context("parse features.toml")?;
    registry.feature.sort_by_key(|f| f.bit);

    let mut cfg = Config::new();
    // Turn on every proposal Wasmtime knows about so probes get their
    // fairest shot at validating.
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

    // If the linked wasmtime + compiler combination can't build an engine
    // with every proposal on (historically true of `wasm_stack_switching`
    // under Cranelift), retry with that flag off. Validation still reflects
    // what the underlying wasmtime crate accepts.
    let engine = match Engine::new(&cfg) {
        Ok(e) => e,
        Err(_) => {
            cfg.wasm_stack_switching(false);
            Engine::new(&cfg).map_err(|e| anyhow!("construct wasmtime engine: {e}"))?
        }
    };
    let detector_path = detector_path.unwrap_or_else(|| default_detector_path(&workspace_root));
    let module = Module::from_file(&engine, &detector_path)
        .map_err(|e| anyhow!("load {}: {e}", detector_path.display()))?;

    let mut linker: Linker<()> = Linker::new(&engine);
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

    let mut store = Store::new(&engine, ());
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

    if self_check {
        let ok = run_self_check(
            &mut store,
            &instance,
            &memory,
            result_buffer,
            result_capacity,
            &registry.feature,
        );
        if ok {
            println!("self-check: PASS");
            return Ok(());
        }
        println!("self-check: FAIL");
        std::process::exit(1);
    }

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

    if feature_count as usize != registry.feature.len() {
        eprintln!(
            "warning: detector reports {feature_count} features but features.toml lists {}",
            registry.feature.len()
        );
    }

    if json {
        emit_json(&registry.feature, &bitmap)?;
    } else {
        emit_pretty(&registry.feature, &bitmap);
    }

    Ok(())
}

/// Exercise the detector's `feature_bit_index` / `feature_name` exports and
/// cross-check them against `features.toml`. Prints per-check diagnostics to
/// stderr; returns `true` iff every check passed.
fn run_self_check(
    store: &mut Store<()>,
    instance: &wasmtime::Instance,
    memory: &wasmtime::Memory,
    result_buffer: u32,
    result_capacity: u32,
    features: &[Feature],
) -> bool {
    let feature_bit_index =
        match instance.get_typed_func::<(u32, u32), i32>(&mut *store, "feature_bit_index") {
            Ok(f) => f,
            Err(e) => {
                eprintln!("self-check: missing export feature_bit_index: {e}");
                return false;
            }
        };
    let feature_name =
        match instance.get_typed_func::<(u32, u32, u32), i32>(&mut *store, "feature_name") {
            Ok(f) => f,
            Err(e) => {
                eprintln!("self-check: missing export feature_name: {e}");
                return false;
            }
        };

    // 1) feature_bit_index("simd") must match features.toml.
    let expected_simd_bit = match features.iter().find(|f| f.name == "simd") {
        Some(f) => f.bit as i32,
        None => {
            eprintln!("self-check: features.toml has no `simd` entry");
            return false;
        }
    };
    let needle = b"simd";
    if let Err(e) = memory.write(&mut *store, result_buffer as usize, needle) {
        eprintln!("self-check: write needle failed: {e}");
        return false;
    }
    let got = match feature_bit_index.call(&mut *store, (result_buffer, needle.len() as u32)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("self-check: feature_bit_index call failed: {e}");
            return false;
        }
    };
    if got != expected_simd_bit {
        eprintln!("self-check: feature_bit_index(\"simd\") = {got}, expected {expected_simd_bit}");
        return false;
    }

    // 2) An unknown feature name must return -1.
    let unknown = b"definitely-not-a-real-feature";
    if let Err(e) = memory.write(&mut *store, result_buffer as usize, unknown) {
        eprintln!("self-check: write unknown-needle failed: {e}");
        return false;
    }
    let got = match feature_bit_index.call(&mut *store, (result_buffer, unknown.len() as u32)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("self-check: feature_bit_index(unknown) failed: {e}");
            return false;
        }
    };
    if got != -1 {
        eprintln!("self-check: feature_bit_index(unknown) = {got}, expected -1");
        return false;
    }

    // 3) feature_name(idx) must round-trip for every entry in features.toml.
    for feature in features {
        let written =
            match feature_name.call(&mut *store, (feature.bit, result_buffer, result_capacity)) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("self-check: feature_name({}) failed: {e}", feature.bit);
                    return false;
                }
            };
        if written < 0 {
            eprintln!(
                "self-check: feature_name({}) returned {written}, expected bytes-written",
                feature.bit
            );
            return false;
        }
        let mut buf = vec![0u8; written as usize];
        if let Err(e) = memory.read(&mut *store, result_buffer as usize, &mut buf) {
            eprintln!("self-check: read name bytes failed: {e}");
            return false;
        }
        if buf != feature.name.as_bytes() {
            eprintln!(
                "self-check: feature_name({}) returned {:?}, expected {:?}",
                feature.bit,
                String::from_utf8_lossy(&buf),
                feature.name
            );
            return false;
        }
    }

    // 4) feature_name(out-of-range) must return -1.
    let oor = features.len() as u32;
    let got = match feature_name.call(&mut *store, (oor, result_buffer, result_capacity)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("self-check: feature_name(out-of-range) failed: {e}");
            return false;
        }
    };
    if got != -1 {
        eprintln!("self-check: feature_name({oor}) = {got}, expected -1");
        return false;
    }

    // 5) feature_name with too-small cap must return -2.
    let got = match feature_name.call(&mut *store, (expected_simd_bit as u32, result_buffer, 0)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("self-check: feature_name(cap=0) failed: {e}");
            return false;
        }
    };
    if got != -2 {
        eprintln!("self-check: feature_name(cap=0) = {got}, expected -2");
        return false;
    }

    true
}

struct Args {
    detector_path: Option<PathBuf>,
    json: bool,
    self_check: bool,
}

fn parse_args() -> Result<Args> {
    let mut json = false;
    let mut self_check = false;
    let mut detector_path: Option<PathBuf> = None;
    let mut it = env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--self-check" => self_check = true,
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
    if json && self_check {
        eprintln!("--json and --self-check are mutually exclusive");
        std::process::exit(2);
    }
    Ok(Args {
        detector_path,
        json,
        self_check,
    })
}

fn usage_and_exit() -> ! {
    eprintln!("usage: wasm-feature-detect [--json | --self-check] [detector.wasm]");
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
