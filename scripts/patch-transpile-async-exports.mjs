#!/usr/bin/env node
// Post-process the wit-js-bindgen transpile output to JSPI-promising-
// wrap the `detect-browser` export.
//
// Why: `browser-probe.probe` is transpiled with `--async-imports` so
// wit-js-bindgen wraps the JS impl in `WebAssembly.Suspending`. That
// makes the guest's synchronous probe call transparently suspending
// under JSPI. But the top-level `detect-browser` export must ALSO be
// wrapped in `WebAssembly.promising` so JS can call it and receive a
// Promise while the guest suspends inside — otherwise the wasm side
// hits `unreachable` when it tries to suspend without a promised
// entry point.
//
// wit-js-bindgen 0.0.1 does not auto-detect the transitive
// dependency (import is suspending → export must be promising). This
// script patches the emitted `.mjs` to fix that gap.
//
// Idempotent — the sentinel `_promiseDetectBrowser` in the output
// means the patch has already run and the file is left alone.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "web/js/browser-detector.transpiled.mjs");

const src = readFileSync(target, "utf8");
if (src.includes("_promiseDetectBrowser")) {
  console.log("patch-transpile-async-exports: already applied.");
  process.exit(0);
}

const OLD = `    _exports["feature-creature:engine/browser-report@0.2.0"] = {};
    _exports["feature-creature:engine/browser-report@0.2.0"]["detect-browser"] = (...args) => {
        const _retPtr = _instance.exports["feature-creature:engine/browser-report@0.2.0#detect-browser"]();
        const _r = _lift_anon6(_memory, _retPtr);
        _instance.exports["cabi_post_feature-creature:engine/browser-report@0.2.0#detect-browser"]?.(_retPtr);
        return _r;
    };`;

const NEW = `    _exports["feature-creature:engine/browser-report@0.2.0"] = {};
    // Promising-wrap detect-browser: it calls the Suspending-wrapped
    // probe import, so JS must receive a Promise back and await the
    // suspended wasm task via WebAssembly.promising. Patched in by
    // scripts/patch-transpile-async-exports.mjs — wit-js-bindgen
    // 0.0.1 doesn't auto-derive this from --async-imports.
    const _promiseDetectBrowser = _invoke(
      _instance.exports["feature-creature:engine/browser-report@0.2.0#detect-browser"],
    );
    _exports["feature-creature:engine/browser-report@0.2.0"]["detect-browser"] = async (...args) => {
        const _retPtr = await _promiseDetectBrowser();
        const _r = _lift_anon6(_memory, _retPtr);
        _instance.exports["cabi_post_feature-creature:engine/browser-report@0.2.0#detect-browser"]?.(_retPtr);
        return _r;
    };`;

if (!src.includes(OLD)) {
  console.error(
    "patch-transpile-async-exports: expected block not found. wit-js-bindgen output shape may have changed; update this script.",
  );
  process.exit(1);
}

writeFileSync(target, src.replace(OLD, NEW));
console.log("patch-transpile-async-exports: patched detect-browser to JSPI-promising.");
