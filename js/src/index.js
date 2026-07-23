// Host bootstrap. Instantiates detector.wasm, supplies engine.validate
// backed by WebAssembly.validate, and returns a decoded feature map.
//
// Contract with detector.wasm:
//   imports: engine.validate(ptr: i32, len: i32) -> i32
//   exports: memory
//            feature_count()   -> i32
//            result_buffer()   -> i32   (address of a static output region)
//            result_capacity() -> i32   (bytes)
//            detect(ptr, cap)  -> i32   (bytes written, or -1)

import { FEATURES } from "./features.js";
import { detectEnvironment } from "./environment.js";

export const WASM_UNSUPPORTED = Symbol("WASM_UNSUPPORTED");

/**
 * @param {BufferSource | Promise<Response> | Response} source
 *   detector.wasm as bytes, a fetch Response, or a Promise resolving to one.
 * @returns {Promise<{
 *   core: Record<string, boolean>,
 *   environment: {
 *     "shared-memory": boolean,
 *     "shared-memory-transferable": boolean,
 *     "streaming-compilation": boolean,
 *     "bigint-integration": boolean,
 *     "js-string-builtins": boolean,
 *     "jspi": boolean,
 *   },
 * } | typeof WASM_UNSUPPORTED>}
 */
export async function detect(source) {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") {
    return WASM_UNSUPPORTED;
  }

  const instance = await instantiate(source);
  const { memory, feature_count, result_buffer, result_capacity, detect: detectFn } =
    instance.exports;

  const ptr = result_buffer();
  const cap = result_capacity();
  const written = detectFn(ptr, cap);
  if (written < 0) throw new Error(`detect() returned ${written}`);

  const bitmap = new Uint8Array(memory.buffer, ptr, written);
  const count = feature_count();
  const core = Object.create(null);
  for (let i = 0; i < count; i++) {
    const name = FEATURES[i] ?? `feature_${i}`;
    core[name] = (bitmap[i >> 3] & (1 << (i & 7))) !== 0;
  }

  const environment = await detectEnvironment();
  return { core, environment };
}

async function instantiate(source) {
  let cell;
  const imports = {
    engine: {
      validate(ptr, len) {
        const bytes = new Uint8Array(cell.instance.exports.memory.buffer, ptr, len);
        // Copy: WebAssembly.validate spec accepts BufferSource, but the
        // slice above aliases the exported memory and would be invalidated
        // if the module grows memory during a probe.
        return WebAssembly.validate(bytes.slice()) ? 1 : 0;
      },
    },
  };

  if (source instanceof Response || (source && typeof source.then === "function")) {
    cell = await WebAssembly.instantiateStreaming(source, imports);
  } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    cell = await WebAssembly.instantiate(source, imports);
  } else {
    throw new TypeError("detect(source): expected BufferSource or Response");
  }
  return cell.instance;
}
