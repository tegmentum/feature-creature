#!/usr/bin/env node
// Serve `_site/` locally with COOP + COEP headers so
// `SharedArrayBuffer` (and its `postMessage` structured-clone transfer,
// gated by cross-origin isolation) actually work — Python's
// http.server does NOT send those headers, which forced the Playwright
// assertions to skip the `shared-memory-transferable` probe. This
// server does. Zero-dep, no build step.
//
// Usage:
//   node serve-with-isolation.mjs               # 9787, ./_site
//   node serve-with-isolation.mjs 9787 ./_site  # explicit
//
// Content-Types: hand-rolled minimal MIME map — the demo ships .html,
// .js, .mjs, .wasm, .png. Extend as needed.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, normalize, sep } from "node:path";

const PORT = Number(process.argv[2] ?? 9787);
const ROOT = resolve(process.argv[3] ?? "_site");

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".toml", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const joined = normalize(resolve(root, decoded));
  // Prevent path traversal — any path that resolves outside root fails.
  if (!joined.startsWith(root + sep) && joined !== root) return null;
  return joined;
}

const server = createServer(async (req, res) => {
  // Cross-origin isolation headers on every response — that's what
  // unlocks SharedArrayBuffer transferability in modern browsers.
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  const url = req.url ?? "/";
  let filePath = safeJoin(ROOT, url === "/" ? "/index.html" : url);
  if (!filePath) {
    res.statusCode = 400;
    return res.end("Bad Request\n");
  }
  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = resolve(filePath, "index.html");
    const bytes = await readFile(filePath);
    res.setHeader(
      "Content-Type",
      MIME.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    );
    res.setHeader("Content-Length", String(bytes.length));
    res.end(bytes);
  } catch {
    res.statusCode = 404;
    res.end("Not Found\n");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT} with COOP+COEP`);
});
