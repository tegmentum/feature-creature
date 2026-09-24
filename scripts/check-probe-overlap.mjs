#!/usr/bin/env node
// Warn when a `browser:*` WIT package has BOTH a BUILTIN_PROBES entry
// in `web/js/browser-report.js` AND a first-party shim package that
// exports its own `probe(env)` function. The two coexist by design —
// shim probes overwrite builtin entries when registered later, so the
// runtime always picks the stronger answer — but a BUILTIN_PROBES
// entry left in place after a shim ships is dead code that hides
// stale platform assumptions.
//
// The list of known shim packages is small enough to keep inline; it
// mirrors the `@tegmentum/browser-<name>-js` packages that ship a
// `probe` export today. Extend when new shim packages register their
// own probes.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// Known first-party shim packages → the WIT package they answer for.
// This IS a hand-maintained list — the whole point of the lint is to
// notice when a new shim ships without pruning the presence-only
// fallback. Add rows when new shim packages start exporting `probe`.
const SHIM_PROBES = [
  {
    npm: "@tegmentum/browser-webgpu-js",
    witPackage: "browser:webgpu@0.9.0",
  },
];

const reportPath = resolve(repoRoot, "web/js/browser-report.js");
const reportSrc = readFileSync(reportPath, "utf8");

// Pull the `browser:*` keys out of the BUILTIN_PROBES table. The table
// literal spans many lines, one entry per line, so the per-line regex
// is enough — no need to actually parse JS.
const KEY_RE = /"(browser:[^"]+)"\s*:/g;
const builtinKeys = new Set();
let match;
while ((match = KEY_RE.exec(reportSrc)) !== null) {
  builtinKeys.add(match[1]);
}

// Filter to keys that appear inside the BUILTIN_PROBES literal; the
// same regex would also match the switch in probeImpl(), which is
// fine — a package is a conflict iff there's a builtin entry AT ALL.

const conflicts = SHIM_PROBES.filter((s) => builtinKeys.has(s.witPackage));

if (conflicts.length === 0) {
  console.log(
    `probe-overlap: ${builtinKeys.size} builtin entries, ${SHIM_PROBES.length} known shim packages, no conflicts.`,
  );
  process.exit(0);
}

console.error("probe-overlap detected —");
for (const c of conflicts) {
  console.error(
    `  ${c.witPackage.padEnd(30)} — has both a BUILTIN_PROBES entry AND a shim in ${c.npm}.`,
  );
}
console.error("");
console.error(
  "Remove the BUILTIN_PROBES row for each conflicting WIT package —",
);
console.error(
  "the shim's probe() function is authoritative and the presence-only",
);
console.error("fallback is dead code once it ships.");
process.exit(1);
