# wasm-feature-detect

Portable WebAssembly feature detection, bootstrapped into WebAssembly itself.

A tiny host-side shim asks *"is WebAssembly present?"* and hands one
capability — `validate(bytes) -> bool` — to a portable detector module.
Everything else lives in `detector.wasm`, which carries its own minimal
probe modules and reports back a stable feature bitmap. The same detector
binary runs unchanged under a browser, Node, Wasmtime, or any other host
willing to supply `validate`.

The design and its motivation (WasmOS build-time specialisation, runtime
capability negotiation, WasmCM implementation selection) are described in
the project conversation log.

## Architecture

```
        host bootstrap (JS / native / WIT)
                     │
                     │  supplies engine.validate(bytes) -> bool
                     ▼
              detector.wasm (portable)
                     │
                     │  embeds one minimal probe per feature
                     ▼
       calls engine.validate on each probe
                     │
                     ▼
       returns a little-endian feature bitmap
```

The detector's ABI:

| symbol                     | kind    | signature                          | purpose                                                                 |
|----------------------------|---------|------------------------------------|-------------------------------------------------------------------------|
| `memory`                   | export  | —                                  | Standard exported linear memory.                                        |
| `feature_count`            | export  | `() -> i32`                        | Number of features this build knows about.                              |
| `result_buffer`            | export  | `() -> i32`                        | Address of a static buffer inside `memory`.                             |
| `result_capacity`          | export  | `() -> i32`                        | Byte capacity of that buffer.                                           |
| `detect`                   | export  | `(ptr: i32, cap: i32) -> i32`      | Fills a bitmap at `ptr`; returns bytes written or `-1` on `cap` too small. |
| `engine.validate`          | import  | `(ptr: i32, len: i32) -> i32`      | Host-side `WebAssembly.validate` equivalent.                            |

The `wit/engine.wit` file defines the same host capability as a
component-model interface for hosts that speak WIT natively.

## Feature registry

`features.toml` at the workspace root is the single source of truth for
feature name → bit-index mapping. Both the Rust build script and the JS
bootstrap consume it. Never renumber existing bits; append new features at
the next free index.

## Layout

```
features.toml                # canonical feature registry
wit/engine.wit               # component-model host interface
crates/detector/             # portable detector, wasm32-unknown-unknown
  src/probes/*.wat           # one minimal module per feature
  build.rs                   # compiles WAT probes, emits Rust tables
crates/host-wasmtime/        # native runner + reference host implementation
js/                          # ~1 KiB browser/Node bootstrap
  src/features.js            # generated from features.toml (do not edit)
scripts/gen-features.mjs     # regenerates js/src/features.js from the registry
```

`js/src/features.js` is generated — after editing `features.toml`, run
`node scripts/gen-features.mjs` (or `npm run gen` from `js/`) to
regenerate it. The Rust build script picks up registry changes
automatically via `build.rs`.

## Building

Prerequisites: Rust with the `wasm32-unknown-unknown` target and Node 20+.

```sh
rustup target add wasm32-unknown-unknown
cargo build --release -p wasm-feature-detector --target wasm32-unknown-unknown
```

The detector artifact lands at
`target/wasm32-unknown-unknown/release/wasm_feature_detector.wasm`.

## Running against Wasmtime

```sh
cargo run --release -p host-wasmtime
```

Prints a `name yes/no` row per feature according to what the linked
Wasmtime engine actually validates.

### Capability manifest

Pass `--json` to emit a structured capability manifest suitable for
downstream WasmOS/WasmCM consumers:

```sh
cargo run --release -p host-wasmtime -- --json
```

The document has this shape (feature keys use exactly the names from
`features.toml`, in `bit`-index order):

```json
{
  "schema": "wasm-feature-detect/capability-manifest/v1",
  "namespace": "wasm.core",
  "host": {
    "engine": "wasmtime",
    "version": "38"
  },
  "features": {
    "mutable-globals": true,
    "saturating-float-to-int": true,
    "sign-extension": true,
    "bulk-memory": true,
    "multi-value": true,
    "reference-types": true,
    "simd": true,
    "threads": true,
    "tail-call": true,
    "exceptions": true,
    "memory64": true,
    "multi-memory": true,
    "gc": true,
    "relaxed-simd": true
  }
}
```

## Running under Node

```sh
cd js && npm test
```

Loads the detector, supplies `WebAssembly.validate` as the host
capability, and prints the decoded feature map — grouped by namespace
(see below).

## Environment probes

Some capabilities live in the host, not the engine, so the portable
`detector.wasm` cannot see them. `js/src/environment.js` fills that gap
with a small set of JS-side probes that mirror the `environment`
interface in `wit/engine.wit`:

| probe                    | how it's tested                                                                                   |
|--------------------------|---------------------------------------------------------------------------------------------------|
| `shared-memory`          | `new SharedArrayBuffer(1)` succeeds.                                                              |
| `streaming-compilation`  | `WebAssembly.compileStreaming` is a function.                                                     |
| `bigint-integration`     | Instantiate a module exporting an `() -> i64` function; the returned value is `typeof "bigint"`.  |
| `js-string-builtins`     | `WebAssembly.validate` accepts a module importing from `wasm:js-string` with `builtins:['js-string']`; falls back to a non-throwing `WebAssembly.instantiate` with the same option. |

Every probe swallows its own errors — a false return always means "not
available," never "the probe blew up." `detect(source)` now returns a
namespaced object:

```js
{
  core: {         // decoded from detector.wasm's bitmap
    "mutable-globals": true,
    // ...
  },
  environment: {  // supplied by js/src/environment.js
    "shared-memory": true,
    "streaming-compilation": true,
    "bigint-integration": true,
    "js-string-builtins": false,
  },
}
```

## What this is not (yet)

- **Component-model packaging**: the detector today is a core module. A
  component wrapper against `wit/engine.wit` is a follow-up.
