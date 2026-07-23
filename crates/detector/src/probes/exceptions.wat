;; Exception handling. Uses the current standardised `try_table` form.
(module
  (tag $e)
  (func
    block $l
      try_table (catch_all $l)
      end
    end))
