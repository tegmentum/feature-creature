import { defineConfig, devices } from "@playwright/test";

// Local port picked to avoid the common 8xxx range (macOS `serve-com` is
// often bound on 8787). Change if this collides locally; CI runs a
// clean environment.
const PORT = 9787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    // Custom Node server sends Cross-Origin-Opener-Policy: same-origin
    // + Cross-Origin-Embedder-Policy: require-corp so browsers enable
    // cross-origin isolation — required for SharedArrayBuffer transfer
    // via postMessage structured clone (`shared-memory-transferable`).
    // Python's http.server sends neither.
    command: `node serve-with-isolation.mjs ${PORT} _site`,
    url: `${BASE_URL}/index.html`,
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 20_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
