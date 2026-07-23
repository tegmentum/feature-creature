;; Typed function references (`(ref null $t)` referencing a specific func type).
(module
  (type $t (func))
  (func (param (ref null $t))
    local.get 0
    drop))
