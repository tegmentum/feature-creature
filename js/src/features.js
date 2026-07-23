// Ordered list of feature names by bit index. Keep in sync with
// ../../features.toml. The detector writes a little-endian bitmap and this
// table decodes it back to names.
export const FEATURES = [
  "mutable-globals",
  "saturating-float-to-int",
  "sign-extension",
  "bulk-memory",
  "multi-value",
  "reference-types",
  "simd",
  "threads",
  "tail-call",
  "exceptions",
  "memory64",
  "multi-memory",
  "gc",
  "relaxed-simd",
];
