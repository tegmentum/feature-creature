//! Component-model variant of the portable Wasm feature detector.
//!
//! This crate produces a `cdylib` targeting `wasm32-unknown-unknown`.
//! The raw core wasm it emits carries a `component-type` custom section
//! (embedded by `wit-bindgen`) that describes the `detector` world in
//! `wit/engine.wit`. Encoding the core module into a proper component
//! artifact — via `wasm-tools component new` or the `wit-component`
//! crate — is the caller's responsibility; see `host-wasmtime
//! --component` for a runtime encoder.
//!
//! The shared `crates/detector` crate remains the source of truth for
//! the JS bootstrap's raw core-module ABI. This crate reuses the same
//! WAT probe fixtures via its build script.

#![no_main]

// Feature registry and embedded probe bytes, generated from
// `features.toml` by build.rs — same schema as `crates/detector`.
include!(concat!(env!("OUT_DIR"), "/probes.rs"));

wit_bindgen::generate!({
    world: "detector",
    path: "../../wit",
});

// The `engine` interface lives under the WIT package
// `feature-creature:engine` and is imported into the `detector`
// world, so wit-bindgen exposes it at this path.
use feature_creature::engine::engine as host_engine;

struct Component;

impl Guest for Component {
    /// Probe every known feature by asking the host to validate its
    /// pre-compiled minimal module. Returns a little-endian bitmap of
    /// exactly `ceil(FEATURE_COUNT / 8)` bytes, matching the core
    /// detector's output byte-for-byte.
    fn detect_core() -> Vec<u8> {
        let needed = FEATURE_COUNT.div_ceil(8);
        let mut out = vec![0u8; needed];
        for (i, probe) in PROBES.iter().enumerate() {
            if host_engine::validate(probe.bytes) {
                out[i / 8] |= 1u8 << (i % 8);
            }
        }
        out
    }
}

export!(Component);
