import { expect, test } from "@playwright/test";

interface CapabilityResult {
  package_: string;
  state: "available" | "browser-missing" | "shim-missing";
  subfeatures: { name: string; state: CapabilityResult["state"] }[];
}

test("browser-detector produces a full 53-entry tri-state report", async ({
  page,
  browserName,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/index.html");

  // The status line reads "Probed N core capabilities ... · M browser
  // packages: X available, Y browser-missing, Z shim-missing." once
  // both detectors finish. Wait on that fingerprint.
  const status = page.locator("#status");
  await expect(status).toContainText("browser packages:", { timeout: 15_000 });

  await expect(page.locator("#core-section")).toBeVisible();
  await expect(page.locator("#browser-section")).toBeVisible();

  const jsonText = await page.locator("#json").textContent();
  expect(jsonText).toBeTruthy();
  const report = JSON.parse(jsonText!);
  const browser: CapabilityResult[] = report.browser;

  expect(browser).toHaveLength(53);

  // Environment snapshot is now routed through the WIT component's
  // `detect-environment` export. Every field is boolean; the six
  // canonical probe names all present with hyphenated keys.
  const env = report.environment as Record<string, boolean>;
  for (const key of [
    "shared-memory",
    "shared-memory-transferable",
    "bigint-integration",
    "js-string-builtins",
    "streaming-compilation",
    "jspi",
  ]) {
    expect(env, `env.${key}`).toHaveProperty(key);
    expect(typeof env[key], `typeof env.${key}`).toBe("boolean");
  }
  // With cross-origin isolation enabled (the Node server serves COOP
  // + COEP + CORP headers on every response), every environment probe
  // resolves true across Chromium, Firefox, and WebKit under the
  // Playwright ships they were installed with. If a future browser
  // release drops one of these, the assertion is where that shows up.
  for (const key of [
    "shared-memory",
    "shared-memory-transferable",
    "bigint-integration",
    "js-string-builtins",
    "streaming-compilation",
    "jspi",
  ]) {
    expect(env[key], `env.${key}`).toBe(true);
  }

  // Tri-state discipline: every state is one of the three arms.
  const states = new Set(browser.map((r) => r.state));
  expect(
    [...states].every((s) =>
      ["available", "browser-missing", "shim-missing"].includes(s),
    ),
  ).toBe(true);

  // BUILTIN_PROBES + webgpu means shim-missing should be zero on any
  // shipping browser — the built-in table covers every catalog entry.
  const shimMissing = browser.filter((r) => r.state === "shim-missing");
  expect(shimMissing, "expected zero shim-missing under builtin probes").toEqual(
    [],
  );

  // Every browser Playwright tests here ships fetch, WebSocket, and
  // BroadcastChannel — those are the load-bearing baseline.
  const byPkg: Record<string, CapabilityResult> = Object.fromEntries(
    browser.map((r) => [r.package_, r]),
  );
  expect(byPkg["browser:fetch"].state).toBe("available");
  expect(byPkg["browser:websocket"].state).toBe("available");
  expect(byPkg["browser:broadcast-channel"].state).toBe("available");

  // WebGPU sub-features. Chromium and modern Firefox both ship webgpu;
  // WebKit hides it behind a flag off by default.
  const webgpu = byPkg["browser:webgpu@0.9.0"];
  expect(webgpu.subfeatures).toHaveLength(9);

  const sub = (name: string) =>
    webgpu.subfeatures.find((s) => s.name === name)?.state;

  if (browserName === "webkit") {
    expect(webgpu.state).toBe("browser-missing");
    expect(webgpu.subfeatures.every((s) => s.state === "browser-missing")).toBe(
      true,
    );
  } else {
    expect(webgpu.state).toBe("available");
    // v0.1-v0.7 layers ship together in every browser that ships webgpu
    // at all — they either all report available or the whole package
    // reports browser-missing (the branch above).
    for (const layer of [
      "triangle",
      "buffers",
      "bind-groups",
      "vertex-index",
      "textures-samplers",
      "depth-stencil-blend",
      "compute-bundles",
    ]) {
      expect(sub(layer), `webgpu.${layer}`).toBe("available");
    }
    // v0.8 (polish: adapter.info getter + queue.onSubmittedWorkDone) and
    // v0.9 (introspection: adapter.getInfo/getFeatures/getLimits +
    // device.getLimits) are the two batches that actually differ across
    // shipping browsers. Both should be a valid tri-state arm; whether
    // they read available depends on that browser's WebGPU rev.
    expect(["available", "browser-missing"]).toContain(sub("polish"));
    expect(["available", "browser-missing"]).toContain(sub("introspection"));
  }

  // Sub-feature taxonomies beyond WebGPU. Each of these packages has
  // documented layers in `browser-subfeatures.toml`; each browser's
  // sub-feature answer should also be tri-state disciplined.
  for (const pkg of [
    "browser:service-worker",
    "browser:worker",
    "browser:storage",
    "browser:webauthn",
    "browser:crypto",
    "browser:media",
    "browser:performance",
    "browser:web-audio",
    "browser:webrtc",
    "browser:fetch",
    "browser:file-system",
    "browser:indexeddb",
    "browser:notifications",
    "browser:websocket",
  ]) {
    const r = byPkg[pkg];
    expect(r.subfeatures.length, `${pkg}.subfeatures`).toBeGreaterThan(0);
    for (const s of r.subfeatures) {
      expect(
        ["available", "browser-missing", "shim-missing"],
        `${pkg}.${s.name}`,
      ).toContain(s.state);
    }
  }

  // Real browser discrimination — Chromium ships Background Sync +
  // Periodic Sync alongside the base ServiceWorker; Firefox and WebKit
  // ship only base + Push. If a future engine flips one of those,
  // this is where the change surfaces.
  const swSub = (name: string) =>
    byPkg["browser:service-worker"].subfeatures.find((s) => s.name === name)
      ?.state;
  if (browserName === "chromium") {
    expect(swSub("sync")).toBe("available");
    expect(swSub("periodic-sync")).toBe("available");
  } else {
    expect(swSub("sync")).toBe("browser-missing");
    expect(swSub("periodic-sync")).toBe("browser-missing");
  }
  // Push, base, and dedicated Worker are universal on every current
  // shipping engine.
  expect(swSub("basic")).toBe("available");
  expect(swSub("push")).toBe("available");
  expect(
    byPkg["browser:worker"].subfeatures.find((s) => s.name === "dedicated")
      ?.state,
  ).toBe("available");

  // browser:performance — `memory` (non-standard performance.memory)
  // and `longtask` (PerformanceObserver "longtask" entry type) are
  // Chromium-only historically. Firefox and WebKit ship neither.
  const perfSub = (name: string) =>
    byPkg["browser:performance"].subfeatures.find((s) => s.name === name)?.state;
  expect(perfSub("basic")).toBe("available");
  expect(perfSub("observer")).toBe("available");
  if (browserName === "chromium") {
    expect(perfSub("memory")).toBe("available");
    expect(perfSub("longtask")).toBe("available");
  } else {
    expect(perfSub("memory")).toBe("browser-missing");
    expect(perfSub("longtask")).toBe("browser-missing");
  }

  // browser:web-audio — every layer available on every current engine.
  for (const layer of ["basic", "worklet", "offline", "analyser", "spatial"]) {
    expect(
      byPkg["browser:web-audio"].subfeatures.find((s) => s.name === layer)?.state,
      `web-audio.${layer}`,
    ).toBe("available");
  }
  // browser:crypto base surface + getRandomValues + randomUUID are
  // universal; Ed25519 has no cheap sync detection today, so we don't
  // assert on its value — only that it's a valid tri-state arm.
  for (const layer of ["basic", "get-random-values", "random-uuid"]) {
    expect(
      byPkg["browser:crypto"].subfeatures.find((s) => s.name === layer)?.state,
      `crypto.${layer}`,
    ).toBe("available");
  }

  // browser:file-system — the three "show*Picker" entry points are
  // Chromium-only. Firefox and WebKit ship OPFS (`basic`) without
  // pickers.
  const fsSub = (name: string) =>
    byPkg["browser:file-system"].subfeatures.find((s) => s.name === name)?.state;
  expect(fsSub("basic")).toBe("available");
  if (browserName === "chromium") {
    expect(fsSub("picker")).toBe("available");
    expect(fsSub("save-picker")).toBe("available");
    expect(fsSub("directory-picker")).toBe("available");
  } else {
    expect(fsSub("picker")).toBe("browser-missing");
    expect(fsSub("save-picker")).toBe("browser-missing");
    expect(fsSub("directory-picker")).toBe("browser-missing");
  }

  // browser:websocket — `WebSocketStream` is Chromium-only for
  // backpressure-aware streaming; Firefox and WebKit have base + binary
  // type only.
  const wsSub = (name: string) =>
    byPkg["browser:websocket"].subfeatures.find((s) => s.name === name)?.state;
  expect(wsSub("basic")).toBe("available");
  expect(wsSub("binary-type")).toBe("available");
  if (browserName === "chromium") {
    expect(wsSub("streams")).toBe("available");
  } else {
    expect(wsSub("streams")).toBe("browser-missing");
  }

  // browser:notifications cascading discrimination — Chromium ships the
  // richest set, Firefox omits badge + image, WebKit omits actions too.
  // persistent (via ServiceWorker) is universal.
  const notifSub = (name: string) =>
    byPkg["browser:notifications"].subfeatures.find((s) => s.name === name)?.state;
  expect(notifSub("basic")).toBe("available");
  expect(notifSub("persistent")).toBe("available");
  if (browserName === "webkit") {
    expect(notifSub("actions")).toBe("browser-missing");
  } else {
    expect(notifSub("actions")).toBe("available");
  }

  // browser:indexeddb — no engine ships IDBObserver yet.
  expect(
    byPkg["browser:indexeddb"].subfeatures.find((s) => s.name === "observer")
      ?.state,
  ).toBe("browser-missing");

  // Compact per-browser summary — becomes a stable diff surface across
  // Playwright versions as new APIs ship.
  const summary = browser.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});
  const availableList = browser
    .filter((r) => r.state === "available")
    .map((r) => r.package_)
    .join(", ");
  const webgpuLayers =
    webgpu.state === "available"
      ? webgpu.subfeatures.map((s) => `${s.name}=${s.state}`).join(", ")
      : "n/a";
  console.log(
    `[${browserName}] states=${JSON.stringify(summary)} ` +
      `webgpu=[${webgpuLayers}] ` +
      `available=[${availableList}]`,
  );

  expect(consoleErrors, `page reported: ${consoleErrors.join("\n")}`).toEqual(
    [],
  );
});
