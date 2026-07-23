// Smoke test: build detector.wasm, then run the bootstrap in Node and print
// the decoded feature map. Exit non-zero if instantiation fails.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { detect, WASM_UNSUPPORTED } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(
  here,
  "../../target/wasm32-unknown-unknown/release/wasm_feature_detector.wasm",
);

const bytes = await readFile(wasmPath);
const result = await detect(bytes);
if (result === WASM_UNSUPPORTED) {
  console.error("WebAssembly unavailable in this runtime");
  process.exit(1);
}

function printSection(label, group) {
  console.log(`# ${label}`);
  for (const [name, on] of Object.entries(group)) {
    console.log(`${name.padEnd(24)} ${on ? "yes" : "no"}`);
  }
}

printSection("core", result.core);
console.log("");
printSection("environment", result.environment);
