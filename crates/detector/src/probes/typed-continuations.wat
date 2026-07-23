;; Typed continuations / stack switching (declares a `cont` type).
(module
  (type $ft (func))
  (type $ct (cont $ft)))
