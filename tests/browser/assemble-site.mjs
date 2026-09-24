#!/usr/bin/env node
// Assemble the same `_site/` layout the Pages workflow ships, but in
// this directory, so the Playwright test can serve it locally without
// touching `web/` in place. Mirrors `.github/workflows/pages.yml` —
// keep the two in sync when either changes.
//
// The core detector wasm is built on demand (skipped if the release
// artifact already exists at target/wasm32-unknown-unknown/release/).
// The browser detector's transpiled `.mjs` is not rebuilt here —
// wit-js-bindgen lives in a separate repo; see `scripts/check-transpile-drift.mjs`
// for the freshness check.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const siteDir = resolve(here, "_site");

const coreWasm = resolve(
  repoRoot,
  "target/wasm32-unknown-unknown/release/feature_creature_detector.wasm",
);

if (!existsSync(coreWasm)) {
  console.log(`building core detector wasm (missing: ${coreWasm})`);
  execSync(
    "cargo build --release --target wasm32-unknown-unknown -p feature-creature-detector",
    { cwd: repoRoot, stdio: "inherit" },
  );
}

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(resolve(siteDir, "assets"), { recursive: true });
mkdirSync(resolve(siteDir, "js"), { recursive: true });

cpSync(resolve(repoRoot, "web/index.html"), resolve(siteDir, "index.html"));
cpSync(
  resolve(repoRoot, "feature-creature-logo.png"),
  resolve(siteDir, "assets/logo.png"),
);
cpSync(coreWasm, resolve(siteDir, "assets/detector.wasm"));
for (const name of ["index.js", "features.js", "environment.js"]) {
  cpSync(resolve(repoRoot, "js/src", name), resolve(siteDir, "js", name));
}
for (const name of ["browser-detector.transpiled.mjs", "browser-report.js"]) {
  cpSync(resolve(repoRoot, "web/js", name), resolve(siteDir, "js", name));
}

console.log(`assembled ${siteDir}`);
