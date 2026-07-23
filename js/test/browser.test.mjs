// Headless-browser smoke test. Boots the static server, drives one or more
// Playwright browsers against js/test/browser.html, and asserts the scraped
// { core, environment } result is well-formed.
//
// Usage:
//   node js/test/browser.test.mjs                 # chromium only (CI default)
//   BROWSERS=chromium,firefox,webkit node js/test/browser.test.mjs
//
// Output artifacts (under js/test/output/):
//   browser-<name>.json     scraped result
//   browser-<name>.png      full-page screenshot
//
// Exits non-zero on any assertion failure.

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FEATURES } from "../src/features.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const outDir = resolve(here, "output");

const ENVIRONMENT_KEYS = [
  "shared-memory",
  "streaming-compilation",
  "bigint-integration",
  "js-string-builtins",
];

const requested = (process.env.BROWSERS ?? "chromium")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let playwright;
try {
  playwright = await import("playwright");
} catch (err) {
  console.error("playwright not installed. Run: npm --prefix js install");
  console.error(String(err && err.message ? err.message : err));
  process.exit(2);
}

const { chromium, firefox, webkit } = playwright;
const AVAILABLE = { chromium, firefox, webkit };

for (const name of requested) {
  if (!AVAILABLE[name]) {
    console.error(`unknown browser: ${name} (expected chromium|firefox|webkit)`);
    process.exit(2);
  }
}

await mkdir(outDir, { recursive: true });

const { url, stop } = await startServer();
console.log(`server: ${url}`);

let failed = 0;
try {
  for (const name of requested) {
    process.stdout.write(`\n== ${name} ==\n`);
    try {
      const result = await runOne(name, url);
      await writeFile(
        resolve(outDir, `browser-${name}.json`),
        JSON.stringify(result, null, 2) + "\n",
      );
      printResult(result);
    } catch (err) {
      failed += 1;
      console.error(`FAIL (${name}): ${err && err.stack ? err.stack : err}`);
    }
  }
} finally {
  await stop();
}

if (failed) process.exit(1);

// ---------------------------------------------------------------------------

async function runOne(name, baseURL) {
  const launcher = AVAILABLE[name];
  const browser = await launcher.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleLines = [];
    page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.stack ?? err}`));

    await page.goto(`${baseURL}js/test/browser.html`, { waitUntil: "load" });
    // The inline script sets documentElement.dataset.ready = "1" in a
    // finally block, so this wait fires whether detect() resolved or threw.
    await page.waitForFunction(() => document.documentElement.dataset.ready === "1", null, {
      timeout: 15_000,
    });

    const { result, error, prText } = await page.evaluate(() => ({
      result: window.__result ?? null,
      error: window.__error ?? null,
      prText: document.getElementById("result")?.textContent ?? null,
    }));

    await page.screenshot({
      path: resolve(outDir, `browser-${name}.png`),
      fullPage: true,
    });

    if (error) {
      throw new Error(
        `detect() reported an error in the page: ${JSON.stringify(error)}\n` +
          `console:\n${consoleLines.join("\n")}`,
      );
    }
    if (!result) throw new Error("no window.__result was set");

    assertShape(result, prText);
    return result;
  } finally {
    await browser.close();
  }
}

function assertShape(result, prText) {
  if (typeof result !== "object" || result === null) throw new Error("result must be an object");
  if (typeof result.core !== "object" || result.core === null) throw new Error("result.core missing");
  if (typeof result.environment !== "object" || result.environment === null)
    throw new Error("result.environment missing");

  // Every feature declared in the registry must be present with a boolean.
  for (const name of FEATURES) {
    if (typeof result.core[name] !== "boolean") {
      throw new Error(`result.core["${name}"] is not a boolean (got ${result.core[name]})`);
    }
  }
  const coreKeys = Object.keys(result.core);
  if (coreKeys.length !== FEATURES.length) {
    throw new Error(`result.core has ${coreKeys.length} keys, expected ${FEATURES.length}`);
  }
  for (const key of ENVIRONMENT_KEYS) {
    if (typeof result.environment[key] !== "boolean") {
      throw new Error(`result.environment["${key}"] is not a boolean`);
    }
  }

  // The <pre> and window.__result must agree.
  if (!prText) throw new Error("<pre id=result> is empty");
  const fromPre = JSON.parse(prText);
  if (JSON.stringify(fromPre) !== JSON.stringify(result)) {
    throw new Error(
      `pre and window.__result disagree\npre: ${prText}\nwindow: ${JSON.stringify(result)}`,
    );
  }
}

function printResult(result) {
  console.log("# core");
  for (const [k, v] of Object.entries(result.core)) {
    console.log(`${k.padEnd(24)} ${v ? "yes" : "no"}`);
  }
  console.log("\n# environment");
  for (const [k, v] of Object.entries(result.environment)) {
    console.log(`${k.padEnd(24)} ${v ? "yes" : "no"}`);
  }
}

async function startServer() {
  const proc = spawn(process.execPath, [resolve(here, "serve.mjs"), "--port", "0", "--quiet"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const url = await new Promise((resolveP, rejectP) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const line = buffer.split("\n").find((l) => l.startsWith("listening on "));
      if (line) {
        proc.stdout.off("data", onData);
        resolveP(line.slice("listening on ".length).trim());
      }
    };
    proc.stdout.on("data", onData);
    proc.once("exit", (code) => rejectP(new Error(`server exited early with code ${code}`)));
    setTimeout(() => rejectP(new Error("server did not become ready within 10s")), 10_000).unref();
  });

  // Pipe subsequent stdout to the parent so failures are visible.
  proc.stdout.on("data", (chunk) => process.stdout.write(chunk));

  const stop = async () => {
    if (proc.exitCode !== null) return;
    proc.kill("SIGTERM");
    await new Promise((res) => {
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        res();
      }, 3000);
      proc.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  };
  return { url, stop };
}
