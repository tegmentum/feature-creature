//! Browser-capability detector, packaged as a wasm-component-model guest.
//!
//! Iterates the catalog of `browser:*` WIT packages baked in at build time
//! (from workspace-root `browser-features.toml` + `browser-subfeatures.toml`)
//! and asks the host, through the `feature-creature:engine/browser-probe`
//! import, whether each package would resolve to a working underlying API
//! on the current platform. Loaders (`wasmbrowsers`, `wasmworkers`, native
//! embedders) implement that import by dispatching to per-package JS
//! shim probes; a package the loader knows nothing about returns
//! `capability-state::shim-missing`, and any *subfeature* the guest expects
//! but the host omits from its response is upgraded to `shim-missing` here
//! before the result is returned — the guest is authoritative for the
//! expected subfeature set because it holds the catalog.
//!
//! Output preserves catalog order (which is alphabetical by package name),
//! so the report is stable and diffable across runs.

#![no_main]

include!(concat!(env!("OUT_DIR"), "/catalog.rs"));

wit_bindgen::generate!({
    world: "browser-detector",
    path: "../../wit",
});

// wit-bindgen 0.60 emits distinct Rust types for the same WIT record when
// it appears on the import side (via `use`) and the export side (as an
// exported interface's definition), even though the two are structurally
// identical and share the same WIT identity. Alias them so the boundary
// code below reads clearly.
use exports::feature_creature::engine::browser_report::{
    CapabilityResult as ExportCapabilityResult,
    CapabilityState as ExportCapabilityState, EnvironmentSnapshot, Guest,
    SubfeatureResult as ExportSubfeatureResult,
};
use feature_creature::engine::browser_probe;
use feature_creature::engine::browser_report::{
    CapabilityState as ImportCapabilityState,
    SubfeatureResult as ImportSubfeatureResult,
};
use feature_creature::engine::environment as host_env;

struct Component;

impl Guest for Component {
    fn detect_browser() -> Vec<ExportCapabilityResult> {
        let mut out = Vec::with_capacity(PACKAGE_COUNT);
        for pkg in PACKAGES.iter() {
            let host_result = browser_probe::probe(pkg.name);
            let mut subfeatures: Vec<ExportSubfeatureResult> = host_result
                .subfeatures
                .into_iter()
                .map(convert_subfeature)
                .collect();

            // Splice in shim-missing entries for expected subfeatures the
            // host didn't report on. If the host reports a subfeature the
            // catalog doesn't know about, we pass it through unchanged —
            // that means the loader is ahead of the taxonomy and the
            // maintainer should update `browser-subfeatures.toml`.
            for expected in pkg.subfeatures.iter() {
                if !subfeatures.iter().any(|s| s.name == *expected) {
                    subfeatures.push(ExportSubfeatureResult {
                        name: (*expected).to_string(),
                        state: ExportCapabilityState::ShimMissing,
                    });
                }
            }

            out.push(ExportCapabilityResult {
                package: host_result.package,
                state: convert_state(host_result.state),
                subfeatures,
            });
        }
        out
    }

    fn detect_environment() -> EnvironmentSnapshot {
        EnvironmentSnapshot {
            shared_memory: host_env::shared_memory(),
            shared_memory_transferable: host_env::shared_memory_transferable(),
            bigint_integration: host_env::bigint_integration(),
            js_string_builtins: host_env::js_string_builtins(),
            streaming_compilation: host_env::streaming_compilation(),
            jspi: host_env::jspi(),
        }
    }
}

fn convert_state(s: ImportCapabilityState) -> ExportCapabilityState {
    match s {
        ImportCapabilityState::Available => ExportCapabilityState::Available,
        ImportCapabilityState::BrowserMissing => ExportCapabilityState::BrowserMissing,
        ImportCapabilityState::ShimMissing => ExportCapabilityState::ShimMissing,
    }
}

fn convert_subfeature(s: ImportSubfeatureResult) -> ExportSubfeatureResult {
    ExportSubfeatureResult {
        name: s.name,
        state: convert_state(s.state),
    }
}

export!(Component);
