;; Tail-call proposal (return_call / return_call_indirect).
(module
  (func $f)
  (func
    return_call $f))
