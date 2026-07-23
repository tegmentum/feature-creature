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

// (module (func (export "f") (result i32) (i32.const 0)))
// A trivial, non-suspending export. Enough to prove that
// `WebAssembly.promising` accepts a real Wasm function and hands back
// something Promise-shaped when called.
const NOP_I32_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type: () -> (i32)
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
  // funcs: [type 0]
  0x03, 0x02, 0x01, 0x00,
  // export: "f" -> func 0
  0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00,
  // code: i32.const 0; end
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x00, 0x0b,
]);

function probeSharedMemory() {
  try {
    return typeof SharedArrayBuffer === "function" && new SharedArrayBuffer(1) instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

// `shared-memory` alone says "the SAB constructor exists," but that is a
// misleadingly optimistic signal on the web: without cross-origin
// isolation (COOP+COEP), a SharedArrayBuffer cannot survive a
// `postMessage` structured clone, which means real Wasm threads still
// won't work. GoogleChromeLabs/wasm-feature-detect's threads probe uses
// the same MessageChannel round-trip to make sure. Both conditions must
// hold: the constructor works AND the resulting SAB is transferable.
async function probeSharedMemoryTransferable() {
  if (!probeSharedMemory()) return false;
  if (typeof MessageChannel !== "function") return false;
  try {
    const sab = new SharedArrayBuffer(1);
    return await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        try { port1.close(); } catch { /* already closed */ }
        try { port2.close(); } catch { /* already closed */ }
        resolve(value);
      };
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = (ev) => {
        const data = ev && ev.data;
        done(data instanceof SharedArrayBuffer && data.byteLength === 1);
      };
      port1.onmessageerror = () => done(false);
      try {
        // A browser without cross-origin isolation throws DataCloneError
        // here; a browser (or Node) that supports transfer delivers the
        // SAB to port1.onmessage.
        port2.postMessage(sab);
      } catch {
        done(false);
      }
    });
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

// JS Promise Integration (JSPI). The public surface has churned across
// origin trials; the shipping shape is `WebAssembly.promising(fn)` which
// takes a Wasm export and returns a JS function that yields a Promise.
// Just checking for the constructor isn't enough — some engines expose
// it stubbed. Live-wrap a trivial export and confirm the wrapper hands
// back a Promise on call.
async function probeJspi() {
  try {
    if (typeof WebAssembly === "undefined") return false;
    if (typeof WebAssembly.promising !== "function") return false;
    const { instance } = await WebAssembly.instantiate(NOP_I32_PROBE, {});
    const f = instance.exports.f;
    if (typeof f !== "function") return false;
    const wrapped = WebAssembly.promising(f);
    if (typeof wrapped !== "function") return false;
    const result = wrapped();
    if (result === null || typeof result !== "object") return false;
    if (typeof result.then !== "function") return false;
    await result;
    return true;
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
  // The fallback module MUST reference the wasm:js-string namespace so
  // instantiation only succeeds when the engine actually honours the
  // `builtins` option. An engine that ignores the option would raise
  // LinkError because we pass an empty import object.
  try {
    await WebAssembly.instantiate(JS_STRING_PROBE, {}, options);
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
  const [sharedMemory, sharedMemoryTransferable, streaming, bigint, jsStrings, jspi] =
    await Promise.all([
      Promise.resolve().then(probeSharedMemory),
      probeSharedMemoryTransferable(),
      Promise.resolve().then(probeStreamingCompilation),
      probeBigintIntegration(),
      probeJsStringBuiltins(),
      probeJspi(),
    ]);
  const out = Object.create(null);
  out["shared-memory"] = sharedMemory;
  out["shared-memory-transferable"] = sharedMemoryTransferable;
  out["streaming-compilation"] = streaming;
  out["bigint-integration"] = bigint;
  out["js-string-builtins"] = jsStrings;
  out["jspi"] = jspi;
  return out;
}
