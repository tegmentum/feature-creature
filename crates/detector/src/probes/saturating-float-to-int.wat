;; Non-trapping float-to-int conversions.
(module
  (func (result i32)
    f32.const 0
    i32.trunc_sat_f32_s))
