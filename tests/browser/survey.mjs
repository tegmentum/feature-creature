#!/usr/bin/env node
// Run the browser-detector against Chromium / Firefox / WebKit and
// dump a canonical JSON snapshot per browser. Diffs against
// `baseline/*.json`; fails when a browser's answer has shifted. The
// maintainer updates the baseline with `--bless` after reviewing the
// change (a new browser rev shipping a WebGPU sub-feature, an API
// getting removed, etc.).
//
// The scheduled workflow at .github/workflows/browser-survey.yml runs
// this weekly against latest-Playwright browsers so regressions show
// up as a failed run + a diffable PR-worthy artifact.

import { chromium, firefox, webkit } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const baselineDir = resolve(here, "baseline");
const bless = process.argv.includes("--bless");

const BROWSERS = [
  { name: "chromium", launcher: chromium },
  { name: "firefox", launcher: firefox },
  { name: "webkit", launcher: webkit },
];

const PORT = 9788;
const server = spawn(
  process.execPath,
  ["serve-with-isolation.mjs", String(PORT), "_site"],
  { cwd: here, stdio: "ignore" },
);
server.unref();
process.on("exit", () => {
  try {
    server.kill("SIGTERM");
  } catch {}
});

// Wait for the server to answer.
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/index.html`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const results = {};
for (const { name, launcher } of BROWSERS) {
  const b = await launcher.launch();
  const page = await (await b.newContext()).newPage();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.waitForFunction(
      () => document.getElementById("json")?.textContent.length > 100,
      { timeout: 15_000 },
    );
    const jt = await page.locator("#json").textContent();
    results[name] = JSON.parse(jt);
  } finally {
    await b.close();
  }
}

// Normalise: strip the `core` axis (that's the raw wasm-feature-detect
// bitmap and moves independently of this catalog), keep the
// environment snapshot and the browser tri-state list.
function normalise(rep) {
  const out = { environment: rep.environment, browser: {} };
  for (const r of rep.browser) {
    out.browser[r.package_] = {
      state: r.state,
      subfeatures: Object.fromEntries(
        (r.subfeatures ?? []).map((s) => [s.name, s.state]),
      ),
    };
  }
  return out;
}

let anyDrift = false;
for (const [name, rep] of Object.entries(results)) {
  const norm = normalise(rep);
  const baselinePath = resolve(baselineDir, `${name}.json`);
  const serialised = JSON.stringify(norm, null, 2) + "\n";

  if (bless || !existsSync(baselinePath)) {
    await mkdir(baselineDir, { recursive: true });
    await writeFile(baselinePath, serialised);
    console.log(`${bless ? "blessed" : "wrote initial"} baseline for ${name}`);
    continue;
  }

  const existing = await readFile(baselinePath, "utf8");
  if (existing !== serialised) {
    anyDrift = true;
    console.error(`\n=== ${name} drifted ===`);
    // Simple line-diff: line-by-line with markers.
    const a = existing.split("\n");
    const b = serialised.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  L${i + 1}`);
        if (a[i] !== undefined) console.error(`   - ${a[i]}`);
        if (b[i] !== undefined) console.error(`   + ${b[i]}`);
      }
    }
  } else {
    console.log(`${name} matches baseline`);
  }
}

if (anyDrift) {
  console.error("\nOne or more browsers drifted from their baselines.");
  console.error(
    "Re-run with `--bless` after reviewing (`node survey.mjs --bless`)",
  );
  console.error("to update the checked-in snapshots.");
  process.exit(1);
}
