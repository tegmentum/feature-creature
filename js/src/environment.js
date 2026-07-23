// Environment probes: capabilities that live in the host, not in the
// engine's core feature set. The detector cannot see these on its own
// because they depend on JS/host semantics (SharedArrayBuffer wiring,
// streaming compilation, BigInt<->i64 boundary, JS String Builtins).
//
// Every probe returns a boolean. Any thrown error becomes `false` — the
// caller must never have to guard against a rejected promise.

// (module (func (export "f") (result i64) (i64.const 42)))
// Used to test whether the engine surfaces i64 results as JS BigInt.
// Pre-BigInt-integration engines throw TypeError at call time.
const BIGINT_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type: () -> (i64)
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7e,
  // funcs: [type 0]
  0x03, 0x02, 0x01, 0x00,
  // export: "f" -> func 0
  0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00,
  // code: i64.const 42; end
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x42, 0x2a, 0x0b,
]);

// (module
//   (import "wasm:js-string" "test" (func (param externref) (result i32))))
// Validates only against an engine that recognises the js-string builtin
// namespace when the `builtins` compile option is honoured.
const JS_STRING_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type: (externref) -> (i32)
  0x01, 0x06, 0x01, 0x60, 0x01, 0x6f, 0x01, 0x7f,
  // import: "wasm:js-string"."test" as func type 0
  0x02, 0x17, 0x01,
  0x0e, 0x77, 0x61, 0x73, 0x6d, 0x3a, 0x6a, 0x73, 0x2d,
  0x73, 0x74, 0x72, 0x69, 0x6e, 0x67,
  0x04, 0x74, 0x65, 0x73, 0x74,
  0x00, 0x00,
]);

// Minimal well-formed empty module: header only. Used as an inert
// carrier for the js-string builtins instantiate-fallback.
const EMPTY_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
]);

function probeSharedMemory() {
  try {
    return typeof SharedArrayBuffer === "function" && new SharedArrayBuffer(1) instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

function probeStreamingCompilation() {
  try {
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.compileStreaming === "function";
  } catch {
    return false;
  }
}

async function probeBigintIntegration() {
  try {
    if (typeof BigInt !== "function") return false;
    const { instance } = await WebAssembly.instantiate(BIGINT_PROBE, {});
    const f = instance.exports.f;
    if (typeof f !== "function") return false;
    return typeof f() === "bigint";
  } catch {
    return false;
  }
}

async function probeJsStringBuiltins() {
  const options = { builtins: ["js-string"] };
  try {
    if (WebAssembly.validate(JS_STRING_PROBE, options) === true) return true;
  } catch {
    // Engines that don't recognise the second argument shape may throw
    // rather than return false. Fall through to the instantiate probe.
  }
  try {
    await WebAssembly.instantiate(EMPTY_MODULE, {}, options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe host-environment capabilities that sit outside the engine's
 * core feature set. Every value is a boolean; any thrown probe becomes
 * `false`.
 *
 * @returns {Promise<Record<string, boolean>>}
 */
export async function detectEnvironment() {
  const [sharedMemory, streaming, bigint, jsStrings] = await Promise.all([
    Promise.resolve().then(probeSharedMemory),
    Promise.resolve().then(probeStreamingCompilation),
    probeBigintIntegration(),
    probeJsStringBuiltins(),
  ]);
  const out = Object.create(null);
  out["shared-memory"] = sharedMemory;
  out["streaming-compilation"] = streaming;
  out["bigint-integration"] = bigint;
  out["js-string-builtins"] = jsStrings;
  return out;
}
