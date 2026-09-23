#!/usr/bin/env node
// Regenerate browser-features.toml from the WasmOS `browser:*` WIT packages.
//
// The union of every WIT package under `wit/deps/browser-*/` in the WasmOS
// repo is the source of truth for the browser-capability catalog. This
// script walks that directory, extracts each `package browser:<name>[@ver];`
// declaration, and rewrites `browser-features.toml` with one `[[browser]]`
// entry per package (sorted alphabetically for a stable diff).
//
// Subfeatures live in `browser-subfeatures.toml`, which this script never
// touches — new subfeature taxonomies are hand-authored there.
//
// Usage:
//
//   node scripts/gen-browser-catalog.mjs
//   WASMOS_ROOT=/path/to/wasmos node scripts/gen-browser-catalog.mjs
//
// WASMOS_ROOT defaults to `../wasmos` relative to this repo, matching the
// sibling-checkout convention used by the rest of the four-repo layout.
//
// `browser:types` is deliberately excluded — it carries only shared type
// definitions used by other packages and is not itself a capability.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const outPath = resolve(repoRoot, "browser-features.toml");

function resolveWasmosRoot() {
  const envRoot = process.env.WASMOS_ROOT;
  if (envRoot) {
    return envRoot.startsWith("~/")
      ? join(homedir(), envRoot.slice(2))
      : resolve(envRoot);
  }
  return resolve(repoRoot, "..", "wasmos");
}

const wasmosRoot = resolveWasmosRoot();
const depsDir = join(wasmosRoot, "wit", "deps");

let depsEntries;
try {
  depsEntries = readdirSync(depsDir);
} catch (err) {
  throw new Error(
    `cannot read ${depsDir}: ${err.message}\n` +
      `set WASMOS_ROOT to the wasmos checkout root, or clone tegmentum/wasmos` +
      ` as a sibling of this repo.`,
  );
}

const browserDirs = depsEntries
  .filter((name) => name.startsWith("browser-"))
  .map((name) => join(depsDir, name))
  .filter((path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  });

if (browserDirs.length === 0) {
  throw new Error(`no browser-* directories found under ${depsDir}`);
}

// Match `package browser:<name>[@<version>];`. Names are kebab-case
// identifiers; versions are semver-shaped. Whitespace is generous because
// wit-parser accepts it, and both single-file packages and multi-file
// packages declare `package` on the first non-comment/docstring line.
const PACKAGE_RE = /^\s*package\s+(browser:[a-z][a-z0-9-]*(?:@[0-9]+\.[0-9]+\.[0-9]+)?)\s*;\s*$/m;

const packages = [];
for (const dir of browserDirs) {
  let files;
  try {
    files = readdirSync(dir).filter((n) => n.endsWith(".wit"));
  } catch {
    continue;
  }
  if (files.length === 0) {
    console.warn(`warn: ${dir} contains no .wit files`);
    continue;
  }
  let found = null;
  for (const file of files) {
    const src = readFileSync(join(dir, file), "utf8");
    const m = src.match(PACKAGE_RE);
    if (m) {
      found = m[1];
      break;
    }
  }
  if (!found) {
    console.warn(`warn: no package declaration found in ${dir}`);
    continue;
  }
  packages.push(found);
}

// `browser:types` is a shared-types package, not a capability.
const EXCLUDE = new Set(["browser:types"]);
const filtered = packages
  .filter((p) => !EXCLUDE.has(p.split("@")[0]))
  .sort();

// De-duplicate defensively (a package split across two dirs would be a
// bug in wasmos, but we shouldn't silently emit a corrupted catalog).
const seen = new Set();
const unique = [];
for (const p of filtered) {
  if (seen.has(p)) {
    console.warn(`warn: duplicate package ${p} in wasmos deps`);
    continue;
  }
  seen.add(p);
  unique.push(p);
}

// Preserve the file's header comment (everything up to the first blank
// line before an entry, or the whole file if it has no entries yet).
let header;
try {
  const existing = readFileSync(outPath, "utf8");
  const firstEntry = existing.indexOf("\n[[browser]]");
  header = firstEntry === -1 ? existing.trimEnd() + "\n" : existing.slice(0, firstEntry).trimEnd() + "\n";
} catch {
  header = "";
}

let body = "\n";
for (const pkg of unique) {
  body += `[[browser]]\npackage = "${pkg}"\n\n`;
}

writeFileSync(outPath, header + body.trimEnd() + "\n");

console.log(
  `wrote ${unique.length} browser capability entries to ${outPath}` +
    ` (from ${wasmosRoot})`,
);
