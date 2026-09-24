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
