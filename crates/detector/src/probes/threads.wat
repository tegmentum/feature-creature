;; Threads / atomics. Requires shared memory + at least one atomic op.
;; Engine-side check only — shared-memory availability in the host
;; environment is a separate probe (see wit/engine.wit `environment`).
(module
  (memory 1 1 shared)
  (func
    i32.const 0
    i32.const 0
    i32.atomic.store))
