# wasm-feature-detect

Portable WebAssembly feature detection, bootstrapped into WebAssembly itself.

A tiny host-side shim asks *"is WebAssembly present?"* and hands one
capability — `validate(bytes) -> bool` — to a portable detector module.
Everything else lives in `detector.wasm`, which carries its own minimal
probe modules and reports back a stable feature bitmap. The same detector
binary runs unchanged under a browser, Node, Wasmtime, or any other host
willing to supply `validate`.

## Prior art

The immediate inspiration is
[GoogleChromeLabs/wasm-feature-detect][gcl], which ships a curated set of
minimal feature-triggering Wasm modules that each get validated via
`WebAssembly.validate`. This project starts from the same idea but
inverts the architecture: the JS side shrinks to a bootstrap that only
supplies `validate(bytes) -> bool`, and the probe fixtures live inside a
portable `detector.wasm` alongside the code that runs them. The same
detector then works unchanged under any host — browser, Node, Wasmtime,
WasmOS, WAMR — that can implement one function.

That reframing also lets the same feature catalogue serve as a capability
substrate: build-time specialisation of downstream Wasm-based systems,
runtime capability negotiation between components, and — via
`wit/engine.wit` — a component-model interface for hosts that speak WIT
natively.

[gcl]: https://github.com/GoogleChromeLabs/wasm-feature-detect

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

| symbol                     | kind    | signature                                     | purpose                                                                 |
|----------------------------|---------|-----------------------------------------------|-------------------------------------------------------------------------|
| `memory`                   | export  | —                                             | Standard exported linear memory.                                        |
| `feature_count`            | export  | `() -> i32`                                   | Number of features this build knows about.                              |
| `result_buffer`            | export  | `() -> i32`                                   | Address of a static buffer inside `memory`.                             |
| `result_capacity`          | export  | `() -> i32`                                   | Byte capacity of that buffer.                                           |
| `detect`                   | export  | `(ptr: i32, cap: i32) -> i32`                 | Fills a bitmap at `ptr`; returns bytes written or `-1` on `cap` too small. |
| `feature_bit_index`        | export  | `(name_ptr: i32, name_len: i32) -> i32`       | Linear-scans the built-in name table for the UTF-8 bytes at `name_ptr..+name_len`. Returns the bit index, or `-1` if unknown. Lets a host decode the bitmap by name without ever seeing `features.toml`. |
| `feature_name`             | export  | `(index: i32, out_ptr: i32, out_cap: i32) -> i32` | Writes the UTF-8 bytes of the name at `index` to `[out_ptr, out_ptr+out_cap)`. Returns bytes written, `-1` if `index` is out of range, or `-2` if `out_cap` is too small. Pairs with `feature_bit_index` so a host with just `detector.wasm` can enumerate feature names. |
| `engine.validate`          | import  | `(ptr: i32, len: i32) -> i32`                 | Host-side `WebAssembly.validate` equivalent.                            |

The `wit/engine.wit` file defines the same host capability as a
component-model interface for hosts that speak WIT natively — see
[Running as a component](#running-as-a-component).

## Feature registry

`features.toml` at the workspace root is the single source of truth for
feature name → bit-index mapping. Both the Rust build script and the JS
bootstrap consume it. Never renumber existing bits; append new features at
the next free index.

## Layout

```
features.toml                # canonical feature registry
wit/engine.wit               # component-model host interface + `detector` world
crates/detector/             # portable detector (core-module ABI, no_std cdylib)
  src/probes/*.wat           # one minimal module per feature
  build.rs                   # compiles WAT probes, emits Rust tables
crates/detector-component/   # same probes, packaged for the component model
  build.rs                   # reuses ../detector/src/probes fixtures
  src/lib.rs                 # wit-bindgen impl of the `detector` world
crates/host-wasmtime/        # native runner: core-module by default,
                             # `--component` for the component variant
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
`features.toml`, in `bit`-index order; `host.version` is the resolved
`wasmtime` crate version read from `Cargo.lock` at build time):

```json
{
  "schema": "wasm-feature-detect/capability-manifest/v1",
  "namespace": "wasm.core",
  "host": {
    "engine": "wasmtime",
    "version": "47.0.2"
  },
  "features": {
    "simd": true,
    "gc": true,
    "memory64": true,
    "typed-continuations": false
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

| probe                          | how it's tested                                                                                   |
|--------------------------------|---------------------------------------------------------------------------------------------------|
| `shared-memory`                | `new SharedArrayBuffer(1)` succeeds. Necessary but, on the web, not sufficient — see below.       |
| `shared-memory-transferable`   | `shared-memory` holds AND a `SharedArrayBuffer` survives a `MessageChannel` `postMessage` round-trip. This is the real precondition for Wasm threads on the web: without cross-origin isolation (COOP+COEP) the structured clone throws `DataCloneError` and threads still won't work, mirroring [GoogleChromeLabs/wasm-feature-detect][gcl]'s threads probe. |
| `streaming-compilation`        | `WebAssembly.compileStreaming` is a function.                                                     |
| `bigint-integration`           | Instantiate a module exporting an `() -> i64` function; the returned value is `typeof "bigint"`.  |
| `js-string-builtins`           | `WebAssembly.validate` accepts a module importing from `wasm:js-string` with `builtins:['js-string']`; falls back to `WebAssembly.instantiate` on the same import-bearing module (an engine that silently ignores the option raises `LinkError` on the unresolved import). |
| `jspi`                         | `WebAssembly.promising` is a function; wrapping a trivial exported Wasm function through it yields a callable that returns a `Promise`.                                                                                                                                                                                                                                              |

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
    "shared-memory-transferable": true,
    "streaming-compilation": true,
    "bigint-integration": true,
    "js-string-builtins": false,
    "jspi": false,
  },
}
```

## Running as a component

The same probe set is also packaged as a WebAssembly component that
speaks the `detector` world in `wit/engine.wit`. Two crates share the
one `features.toml`/probes fixtures:

- `crates/detector/` (unchanged) — raw core-module ABI consumed by the
  JS bootstrap and by `host-wasmtime`'s default mode.
- `crates/detector-component/` — `wit-bindgen`-generated bindings that
  emit a raw core wasm carrying wit-bindgen's `component-type` custom
  section.

Build the component variant with the same `wasm32-unknown-unknown`
target:

```sh
cargo build --release -p wasm-feature-detector-component --target wasm32-unknown-unknown
```

The artifact lands at
`target/wasm32-unknown-unknown/release/wasm_feature_detector_component.wasm`.
It's still a core module at this point — the `component-type` custom
section describes how to wrap it. `host-wasmtime --component` performs
that wrap in-memory (via the `wit-component` crate) and instantiates
the resulting component against the world:

```sh
cargo run --release -p host-wasmtime -- --component
cargo run --release -p host-wasmtime -- --component --json
```

Under the hood, `--component`:

1. Reads the file. If its preamble is already the component-model magic,
   it's used as-is; otherwise `wit_component::ComponentEncoder` wraps it.
2. Instantiates the component with `wasmtime::component::Linker`,
   supplying the `wasm-feature-detect:engine/engine@0.1.0` interface
   whose sole `validate: func(bytes: list<u8>) -> bool` import is
   backed by `wasmtime::Module::validate`.
3. Calls the world's `detect-core: func() -> list<u8>` export and
   decodes the bitmap against `features.toml` — producing the same
   output as the default (core-module) mode.

To pre-encode the component on disk without host-wasmtime (e.g. for
downstream WasmOS/WasmCM consumers that only speak the component
model), install `wasm-tools` and run:

```sh
cargo install wasm-tools
wasm-tools component new \
  target/wasm32-unknown-unknown/release/wasm_feature_detector_component.wasm \
  -o detector.component.wasm
```

The resulting `detector.component.wasm` is accepted directly by
`host-wasmtime --component detector.component.wasm`.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE)
for the full text.
