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

// Extract the BUILTIN_PROBES table literal specifically. The
// SUBFEATURE_PROBES table in the same file also uses `"browser:X":`
// keys but represents rich per-layer probes that are DELIBERATELY
// authored inline — those are not "presence-only fallback" and don't
// conflict with shim availability.
const TABLE_RE = /const\s+BUILTIN_PROBES\s*=\s*{([\s\S]*?)^};/m;
const tableMatch = reportSrc.match(TABLE_RE);
if (!tableMatch) {
  console.error("no BUILTIN_PROBES table found in web/js/browser-report.js");
  process.exit(2);
}
const tableBody = tableMatch[1];

const KEY_RE = /"(browser:[^"]+)"\s*:/g;
const builtinKeys = new Set();
let match;
while ((match = KEY_RE.exec(tableBody)) !== null) {
  builtinKeys.add(match[1]);
}

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
