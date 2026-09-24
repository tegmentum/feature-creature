#!/usr/bin/env node
// Verify `web/js/browser-detector.transpiled.mjs` was generated from
// the currently-committed WIT + catalog + wasm, not stale output from
// a prior shape.
//
// The stored digest covers two things: (1) SHA-256 of the base64-
// embedded core modules in the transpiled `.mjs` — catches manual edits
// to the generated file; (2) SHA-256 of the source triple `wit/engine.wit`
// + `browser-features.toml` + `browser-subfeatures.toml` — catches "WIT
// or catalog changed but transpile wasn't rerun". A mismatch on either
// half fails the check; the maintainer regenerates the wasm + .mjs and
// runs `--write` to bless the new pair.
//
// Usage:
//
//   node scripts/check-transpile-drift.mjs           # verify
//   node scripts/check-transpile-drift.mjs --write   # write current hash
//
// The `--write` mode is what the maintainer runs after each successful
// regen; the default `verify` mode is what CI (or a pre-push hook) runs.
//
// Regenerating the transpiled `.mjs` still requires wit-js-bindgen
// locally — this script only detects that a regen is due; it doesn't
// perform one. See README.md § "Browser detection" for the full flow.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const transpiledPath = resolve(repoRoot, "web/js/browser-detector.transpiled.mjs");
const hashPath = resolve(repoRoot, "web/js/browser-detector.transpiled.sha256");

const write = process.argv.includes("--write");

const src = readFileSync(transpiledPath, "utf8");

// wit-js-bindgen emits each core module as:
//   const _module_bytes_N = _b64ToU8(
//       "..." +
//       "..." +
//       ...
//   );
// (module count varies with the composed component). Hash the base64
// blobs in emission order so the check is invariant across whitespace
// or comment changes but sensitive to any bytecode drift. The multi-
// line string-concat form comes from wit-js-bindgen's line-wrapped
// emit; joining the string literals reproduces the original blob.
const BLOB_RE = /_module_bytes_(\d+)\s*=\s*_b64ToU8\(([\s\S]*?)\);/g;
const STRING_RE = /"([A-Za-z0-9+/=]+)"/g;
const blobs = [];
let m;
while ((m = BLOB_RE.exec(src)) !== null) {
  const idx = Number(m[1]);
  const body = m[2];
  const parts = [];
  let s;
  while ((s = STRING_RE.exec(body)) !== null) parts.push(s[1]);
  STRING_RE.lastIndex = 0;
  if (parts.length === 0) continue;
  blobs.push({ idx, b64: parts.join("") });
}
if (blobs.length === 0) {
  console.error(
    "no base64-embedded core modules found — transpile output shape changed?",
  );
  process.exit(1);
}
blobs.sort((a, b) => a.idx - b.idx);

const transpileHasher = createHash("sha256");
for (const { b64 } of blobs) transpileHasher.update(b64);
const transpileHash = transpileHasher.digest("hex");

// Source triple: WIT + catalog + subfeatures. If any change, the wasm
// component (and therefore the transpiled .mjs) must be rebuilt.
const sourcePaths = [
  "wit/engine.wit",
  "browser-features.toml",
  "browser-subfeatures.toml",
];
const sourceHasher = createHash("sha256");
for (const rel of sourcePaths) {
  const bytes = readFileSync(resolve(repoRoot, rel));
  sourceHasher.update(rel);
  sourceHasher.update("\0");
  sourceHasher.update(bytes);
  sourceHasher.update("\0");
}
const sourceHash = sourceHasher.digest("hex");

const REGEN_STEPS = [
  "  cargo build --release --target wasm32-unknown-unknown \\",
  "      -p feature-creature-browser-detector-component",
  "  wasm-tools component new \\",
  "      target/wasm32-unknown-unknown/release/feature_creature_browser_detector_component.wasm \\",
  "      -o dist/browser-detector.component.wasm",
  "  wit-js-bindgen transpile dist/browser-detector.component.wasm \\",
  "      -o web/js/browser-detector.transpiled.mjs",
  "  node scripts/check-transpile-drift.mjs --write",
];

if (write) {
  writeFileSync(
    hashPath,
    "# Freshness digest for browser-detector.transpiled.mjs.\n" +
      "# Verified by scripts/check-transpile-drift.mjs; regenerated alongside\n" +
      "# the .mjs whenever the WIT or the catalog changes.\n" +
      `transpile ${transpileHash}\n` +
      `sources   ${sourceHash}\n`,
  );
  console.log(`wrote ${hashPath}`);
  console.log(`  transpile ${transpileHash}`);
  console.log(`  sources   ${sourceHash}`);
  process.exit(0);
}

let storedTranspile, storedSources;
try {
  for (const line of readFileSync(hashPath, "utf8").split("\n")) {
    const [key, value] = line.trim().split(/\s+/);
    if (key === "transpile") storedTranspile = value;
    else if (key === "sources") storedSources = value;
  }
} catch (err) {
  if (err.code === "ENOENT") {
    console.error(
      `${hashPath} missing — run with --write to bless the current transpile output.`,
    );
    process.exit(2);
  }
  throw err;
}

const mismatches = [];
if (storedTranspile !== transpileHash) {
  mismatches.push(
    `  transpile: stored=${storedTranspile} current=${transpileHash}`,
  );
}
if (storedSources !== sourceHash) {
  mismatches.push(`  sources:   stored=${storedSources} current=${sourceHash}`);
}

if (mismatches.length > 0) {
  console.error("transpile-drift detected —");
  for (const m of mismatches) console.error(m);
  console.error("");
  if (storedSources !== sourceHash) {
    console.error(
      "The WIT and/or catalog changed since the .mjs was last regenerated.",
    );
  } else {
    console.error(
      "The .mjs was edited without regenerating from the source component.",
    );
  }
  console.error("Regenerate:");
  for (const step of REGEN_STEPS) console.error(step);
  process.exit(1);
}

console.log(`transpile output fresh: ${transpileHash}`);
console.log(`sources digest:         ${sourceHash}`);
