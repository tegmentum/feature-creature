#!/usr/bin/env node
// Warn when the two BUILTIN_PROBES tables — one in
// `web/js/browser-report.js` (feature-creature Pages demo), one in
// `packages/feature-creature-browser/src/builtin-probes.ts` in the
// WasmOS monorepo (@wasmos/feature-creature-browser) — cover different
// sets of browser:* WIT packages. The two are hand-maintained twins by
// convention; a drift means one repo added or removed a probe without
// the other, and the two consumers of the catalog will disagree on how
// many packages they can answer for.
//
// The check is symmetric — it fails if EITHER side has a package the
// other lacks. Extending one side implies extending the other in the
// same landing.
//
// Vela lives outside this repo; the script looks for it via:
//   1. $VELA_ROOT
//   2. `../wasmos/vela-wasm` (sibling-checkout convention)
// and exits `skipped` if neither is present — the Pages workflow runs
// without a WasmOS clone, and a missing sibling is not a hard failure
// there. Wire this into local pre-push hooks and the WasmOS-side CI to
// exercise both directions.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function resolveVelaRoot() {
  const env = process.env.VELA_ROOT;
  if (env) {
    return env.startsWith("~/") ? resolve(homedir(), env.slice(2)) : resolve(env);
  }
  return resolve(repoRoot, "..", "wasmos", "vela-wasm");
}

const velaRoot = resolveVelaRoot();
const velaProbesPath = resolve(
  velaRoot,
  "packages/feature-creature-browser/src/builtin-probes.ts",
);
if (!existsSync(velaProbesPath)) {
  console.log(
    `probe-sync: skipped — vela sibling not found at ${velaRoot}. Set VELA_ROOT to override.`,
  );
  process.exit(0);
}

// Same regex works on both files — the .js and .ts variants both use
// `"browser:X": ...` entries inside a table literal.
const KEY_RE = /"(browser:[^"]+)"\s*:/g;

function extractKeys(path) {
  const src = readFileSync(path, "utf8");
  const keys = new Set();
  let m;
  while ((m = KEY_RE.exec(src)) !== null) keys.add(m[1]);
  return keys;
}

const localPath = resolve(repoRoot, "web/js/browser-report.js");
const local = extractKeys(localPath);
const vela = extractKeys(velaProbesPath);

const onlyLocal = [...local].filter((k) => !vela.has(k)).sort();
const onlyVela = [...vela].filter((k) => !local.has(k)).sort();

if (onlyLocal.length === 0 && onlyVela.length === 0) {
  console.log(
    `probe-sync: ${local.size} entries in each table, in sync.`,
  );
  process.exit(0);
}

console.error("probe-sync: BUILTIN_PROBES tables have drifted —");
if (onlyLocal.length > 0) {
  console.error("  only in feature-creature/web/js/browser-report.js:");
  for (const k of onlyLocal) console.error(`    ${k}`);
}
if (onlyVela.length > 0) {
  console.error(
    "  only in vela-wasm/packages/feature-creature-browser/src/builtin-probes.ts:",
  );
  for (const k of onlyVela) console.error(`    ${k}`);
}
console.error("");
console.error(
  "Extending one side implies extending the other so downstream consumers agree.",
);
process.exit(1);
