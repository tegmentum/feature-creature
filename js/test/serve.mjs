// Tiny zero-dep static file server for the browser harness. Serves the
// repository root so that both /js/... and /target/... URLs resolve.
//
// Usage:
//   node js/test/serve.mjs [--port 0] [--root <dir>] [--quiet]
//
// Prints "listening on http://HOST:PORT/" on stdout once the socket is bound
// so callers can grep it. On --port 0 the OS assigns a free port.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, join, normalize, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");

const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  return argv[i + 1] ?? fallback;
}
const port = Number(argValue("--port", process.env.PORT ?? "0"));
const root = resolve(argValue("--root", repoRoot));
const quiet = argv.includes("--quiet");

// MIME table. Deliberately small: this server exists to feed the browser
// harness, not to be a general-purpose static host.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function contentType(path) {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// Reject anything that would escape the served root. `normalize` collapses
// ../ segments; we then verify the resolved path is still under root.
function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = resolve(join(root, rel));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

async function resolveTarget(urlPath) {
  const abs = safeResolve(urlPath === "/" ? "/js/test/browser.html" : urlPath);
  if (!abs) return null;
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const indexAbs = join(abs, "index.html");
      const idx = await stat(indexAbs).catch(() => null);
      return idx && idx.isFile() ? indexAbs : null;
    }
    return s.isFile() ? abs : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    res.end("method not allowed\n");
    return;
  }
  const target = await resolveTarget(req.url ?? "/");
  if (!target) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found\n");
    return;
  }
  res.writeHead(200, {
    "content-type": contentType(target),
    "cache-control": "no-store",
    // Enable SharedArrayBuffer under Chromium so the environment probe
    // matches Node's behaviour rather than being cross-origin-isolated off.
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-resource-policy": "same-origin",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(target)
    .on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end(`read error: ${err.message}\n`);
    })
    .pipe(res);
});

server.on("error", (err) => {
  console.error(`server error: ${err.message}`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  // Machine-parseable first line, then a human hint.
  console.log(`listening on http://127.0.0.1:${boundPort}/`);
  if (!quiet) console.log(`serving ${root}`);
});

// Graceful shutdown so the CI job doesn't leave orphan processes.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    // Fall back if in-flight requests hang.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
