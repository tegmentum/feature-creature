# ADR 0001 — Tri-state browser capability results

**Status:** accepted (2026-09-23).

## Context

feature-creature grew a second axis alongside its core-wasm feature
detector: a per-platform probe suite that answers, for every `browser:*`
WIT package in the WasmOS lineage, whether a component's imports of that
package would resolve to working underlying APIs on the current
platform.

The naive answer is a boolean — supported or not — but two failure
modes had to be distinguished for the loader (`wasmbrowsers`,
`wasmworkers`, native embedders) to act correctly:

1. **The browser lacks the underlying API.** The loader may still ship
   a shim that satisfies the WIT import — the guest wasm's instantiation
   succeeds, the shim binds — but the first call into the shim traps
   because the API it wraps is absent.

2. **The loader has no shim for that WIT package on this platform.**
   The WIT import can't be satisfied at all; instantiation itself
   fails unless the loader refuses / stubs / degrades the component
   beforehand.

Collapsing those two into "not supported" hides which of the two
responses the loader owes the caller. Two shipping browsers can both
"lack" a capability for very different reasons, and the loader's
response has to differ.

## Decision

Return a **tri-state** per catalog entry:

| state             | meaning                                                                        |
|-------------------|--------------------------------------------------------------------------------|
| `available`       | browser exposes the backing API AND a probe is registered for it               |
| `browser-missing` | probe ran, browser confirmed absent — instantiation would bind, then trap on call |
| `shim-missing`    | no probe registered for this package — loader has to refuse / stub / degrade    |

Provenance:

- Individual probe functions (in shim packages, or the shared
  `BUILTIN_PROBES` table for packages answerable by a small `typeof`
  check) return `available` / `browser-missing` — the two states the
  probe itself can observe.
- `shim-missing` is **synthesised on the guest side** by comparing the
  host's response against the guest's bundled catalog: a package the
  loader has no registered probe for gets `shim-missing`, and any
  subfeature the catalog knows about but the probe omits also gets
  `shim-missing`. The guest holds the catalog, so this is where the
  synthesis belongs.

The WIT records this as `enum capability-state { available,
browser-missing, shim-missing }` on the `browser-report` interface (see
`feature-creature:engine@0.2.0`).

## Consequences

**Loader behaviour becomes obvious.** For a component that imports
`browser:webhid`, an `available` row means instantiate freely; a
`browser-missing` row means either refuse or bind a stub that surfaces
a clean error at call time; a `shim-missing` row means either refuse
outright or wait for the shim to ship.

**Sub-features report the same tri-state.** WebGPU's v0.8 polish batch
(adapter.info getter + queue.onSubmittedWorkDone) and v0.9 introspection
batch (adapter.getInfo/getFeatures/getLimits, device.getLimits) can each
report `browser-missing` independently — Chrome and Firefox ship the
polish batch but neither has the full introspection surface yet, and
the report reflects that per-layer instead of collapsing to a
package-level "yes".

**Sub-feature provenance requires care.** When a whole package reports
`browser-missing`, the shim still covers all its documented layers —
what's missing is the API. Probes therefore return the full sub-feature
map with each layer set to `browser-missing` (rather than omitting them
and letting the guest synthesise `shim-missing`), so the report says
"the shim would cover this if it could" instead of "we don't know".

**Reports diff cleanly across platforms.** Chromium / Firefox / WebKit
each produce the same 53-entry list in the same order (alphabetical by
package). The state column is where the platforms differ, so a diff
answers "what does Chrome ship that Safari doesn't?" directly.

**Loaders own the shim-availability axis, not the WIT.** The WIT stays
platform-agnostic — the shim-missing distinction is a loader concern
that doesn't show up in the WIT surface a component imports. The
guest's catalog and the loader's registry together own the two axes.

## Alternatives considered

- **Boolean supported/not.** Rejected: loses the loader-response
  distinction the whole design is meant to expose.
- **Loader owns the sub-feature synthesis instead of the guest.**
  Requires the loader to also ship a copy of the catalog — pushes the
  same data into two places and invites drift.
- **Ergonomic optionality (`available?: SubfeatureMap | undefined`).**
  Rejected: obscures the difference between "shim doesn't cover it"
  and "browser lacks it".

## References

- `wit/engine.wit` — `browser-report` interface.
- `crates/browser-detector-component/src/lib.rs` — sub-feature
  synthesis.
- `web/js/browser-report.js` — `BUILTIN_PROBES` (presence-only checks)
  and the WebGPU sub-feature probe.
- `tests/browser/browser-report.spec.ts` — cross-browser assertions
  on the tri-state discipline.
