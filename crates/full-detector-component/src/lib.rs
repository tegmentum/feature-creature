//! Combined core + browser detector as a single wasm-component-model
//! guest. Implements the `full-detector` world in `wit/engine.wit`:
//! imports `engine.validate` (core-wasm probes), `environment.*`
//! (JS/Web capability probes the guest can't self-answer), and
//! `browser-probe.probe` (per-package browser-capability probes), then
//! exports `detect-core: func() -> list<u8>` (bitmap) alongside the
//! `browser-report` interface (tri-state list).
//!
//! One instantiation, one snapshot — loaders that want the full
//! CapabilitySet in one go target this world instead of running the
//! `detector` and `browser-detector` worlds separately.

#![no_main]

include!(concat!(env!("OUT_DIR"), "/tables.rs"));

wit_bindgen::generate!({
    world: "full-detector",
    path: "../../wit",
});

use exports::feature_creature::engine::browser_report::{
    CapabilityResult as ExportCapabilityResult,
    CapabilityState as ExportCapabilityState, Guest as BrowserReportGuest,
    SubfeatureResult as ExportSubfeatureResult,
};
use feature_creature::engine::browser_probe;
use feature_creature::engine::browser_report::{
    CapabilityState as ImportCapabilityState,
    SubfeatureResult as ImportSubfeatureResult,
};
use feature_creature::engine::engine as host_engine;

struct Component;

impl Guest for Component {
    fn detect_core() -> Vec<u8> {
        let needed = FEATURE_COUNT.div_ceil(8);
        let mut out = vec![0u8; needed];
        for (i, probe) in CORE_PROBES.iter().enumerate() {
            if host_engine::validate(probe.bytes) {
                out[i / 8] |= 1u8 << (i % 8);
            }
        }
        out
    }
}

impl BrowserReportGuest for Component {
    fn detect_browser() -> Vec<ExportCapabilityResult> {
        let mut out = Vec::with_capacity(BROWSER_PACKAGE_COUNT);
        for pkg in BROWSER_PACKAGES.iter() {
            let host_result = browser_probe::probe(pkg.name);
            let mut subfeatures: Vec<ExportSubfeatureResult> = host_result
                .subfeatures
                .into_iter()
                .map(convert_subfeature)
                .collect();

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
