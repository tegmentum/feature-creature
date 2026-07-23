#!/usr/bin/env node
// Regenerate js/src/features.js from features.toml.
//
// Paths are resolved relative to the repo root (this script's parent
// directory), so it works regardless of the caller's CWD:
//
//   node scripts/gen-features.mjs
//   (cd js && node ../scripts/gen-features.mjs)
//
// features.toml is the single source of truth for the (name, bit) mapping.
// This script parses the [[feature]] tables with a small hand-rolled reader
// — no external deps — and writes js/src/features.js so the JS bootstrap
// never drifts from the Rust build.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tomlPath = resolve(repoRoot, "features.toml");
const outPath = resolve(repoRoot, "js/src/features.js");

/**
 * Minimal parser for the subset of TOML used by features.toml:
 * an array of `[[feature]]` tables with `name = "..."`, `bit = <int>`,
 * and `probe = "..."` scalar fields. Comments (`#`) and blank lines are
 * skipped. Anything unexpected throws.
 */
function parseFeaturesToml(text) {
  const features = [];
  let current = null;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip comments and trim. `#` inside strings would be a problem in
    // general TOML, but features.toml has no such values.
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;

    if (line === "[[feature]]") {
      if (current !== null) features.push(current);
      current = {};
      continue;
    }

    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!kv) {
      throw new Error(`features.toml:${i + 1}: cannot parse line: ${raw}`);
    }
    if (current === null) {
      throw new Error(
        `features.toml:${i + 1}: key/value before any [[feature]] header`,
      );
    }

    const key = kv[1];
    const value = kv[2].trim();
    if (/^".*"$/.test(value)) {
      current[key] = value.slice(1, -1);
    } else if (/^-?\d+$/.test(value)) {
      current[key] = parseInt(value, 10);
    } else {
      throw new Error(
        `features.toml:${i + 1}: unsupported value for ${key}: ${value}`,
      );
    }
  }
  if (current !== null) features.push(current);
  return features;
}

const toml = readFileSync(tomlPath, "utf8");
const features = parseFeaturesToml(toml);

if (features.length === 0) {
  throw new Error("features.toml: no [[feature]] entries found");
}

for (const f of features) {
  if (typeof f.name !== "string" || typeof f.bit !== "number") {
    throw new Error(
      `features.toml: entry missing name/bit: ${JSON.stringify(f)}`,
    );
  }
}

features.sort((a, b) => a.bit - b.bit);

for (let i = 0; i < features.length; i++) {
  if (features[i].bit !== i) {
    throw new Error(
      `features.toml: bits must be contiguous from 0; expected bit=${i} at position ${i}, got ${features[i].bit} (${features[i].name})`,
    );
  }
}

const names = features.map((f) => f.name);

const out =
  `// GENERATED FROM features.toml — do not edit. Regenerate: node scripts/gen-features.mjs\n` +
  `// Ordered list of feature names by bit index. The detector writes a\n` +
  `// little-endian bitmap and this table decodes it back to names.\n` +
  `export const FEATURES = [\n` +
  names.map((n) => `  ${JSON.stringify(n)},\n`).join("") +
  `];\n`;

writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${features.length} features)`);
