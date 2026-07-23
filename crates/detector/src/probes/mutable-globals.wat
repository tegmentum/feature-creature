;; Mutable-globals proposal: mutable globals crossing the module boundary.
(module
  (global (export "g") (mut i32) (i32.const 0)))
