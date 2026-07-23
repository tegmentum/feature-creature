//! Wasmtime host runner for the portable Wasm feature detector.
//!
//! Instantiates `detector.wasm`, supplies the `engine.validate` import
//! backed by Wasmtime's own module validator, invokes `detect`, and prints
//! the resulting feature bitmap decoded against `features.toml`.

use anyhow::{Context, Result, anyhow};
use serde::Deserialize;
use std::{env, fs, path::PathBuf};
use wasmtime::{Caller, Config, Engine, Linker, Module, Store};

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

fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let detector_path = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(default_detector_path);

    let workspace_root = detect_workspace_root()?;
    let registry_src = fs::read_to_string(workspace_root.join("features.toml"))
        .context("read features.toml")?;
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
        .wasm_wide_arithmetic(true);
    // `wasm_stack_switching` (typed-continuations) is intentionally omitted:
    // Wasmtime 38's default compiler (Cranelift) refuses to construct an
    // engine with the stack-switching feature enabled. The probe still runs
    // through Module::validate and will simply be reported as unsupported.

    let engine = Engine::new(&cfg)?;
    let module = Module::from_file(&engine, &detector_path)
        .with_context(|| format!("load {}", detector_path.display()))?;

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

    for feature in &registry.feature {
        let byte = feature.bit as usize / 8;
        let mask = 1u8 << (feature.bit as usize % 8);
        let on = bitmap.get(byte).map(|b| b & mask != 0).unwrap_or(false);
        println!("{:24} {}", feature.name, if on { "yes" } else { "no" });
    }

    Ok(())
}

fn default_detector_path() -> PathBuf {
    detect_workspace_root()
        .expect("locate workspace root")
        .join("target/wasm32-unknown-unknown/release/wasm_feature_detector.wasm")
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
