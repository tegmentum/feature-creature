// Browser-capability report — the counterpart to js/index.js's core-engine
// detector. Runs the `browser-detector` component (produced by
// `crates/browser-detector-component`, transpiled to a self-contained .mjs
// by wit-js-bindgen) against a set of built-in JS presence probes that
// answer "does this browser expose the backing API for a given
// `browser:*` WIT package?".
//
// The transpiled module base64-embeds the wasm — no separate fetch of
// `.component.wasm` needed at load time.
//
// The tri-state result mirrors feature-creature's WIT:
//   * available       — the browser has the API AND we have a probe.
//   * browser-missing — probe ran, API confirmed absent.
//   * shim-missing    — no probe registered for this package (either
//                       because we haven't added a check yet, or because
//                       the WIT covers a surface that needs a full shim
//                       package to answer meaningfully).

import { instantiate } from "./browser-detector.transpiled.mjs";

const BROWSER_PROBE_IFACE = "feature-creature:engine/browser-probe@0.2.0";
const BROWSER_REPORT_IFACE = "feature-creature:engine/browser-report@0.2.0";

// -------------------------------------------------------------------
// WebGPU sub-feature probe. browser:webgpu's WIT docstring (in the
// WasmOS repo) enumerates nine progressive layers — the two later
// ones (v0.8 polish, v0.9 introspection) are the batches that actually
// differ across shipping browsers, so we probe them explicitly. Layers
// v0.1–v0.7 shipped as one bundle in every browser that shipped WebGPU
// at all, so their availability tracks the whole package's.
// -------------------------------------------------------------------
function probeWebgpu() {
  const nav = globalThis.navigator;
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      state: "browser-missing",
      subfeatures: {
        triangle: "browser-missing",
        buffers: "browser-missing",
        "bind-groups": "browser-missing",
        "vertex-index": "browser-missing",
        "textures-samplers": "browser-missing",
        "depth-stencil-blend": "browser-missing",
        "compute-bundles": "browser-missing",
        polish: "browser-missing",
        introspection: "browser-missing",
      },
    };
  }
  const AdapterProto =
    typeof globalThis.GPUAdapter !== "undefined" ? globalThis.GPUAdapter.prototype : null;
  const DeviceProto =
    typeof globalThis.GPUDevice !== "undefined" ? globalThis.GPUDevice.prototype : null;
  const QueueProto =
    typeof globalThis.GPUQueue !== "undefined" ? globalThis.GPUQueue.prototype : null;
  const hasRenderBundleEncoder = typeof globalThis.GPURenderBundleEncoder !== "undefined";
  const hasPolish =
    !!AdapterProto &&
    Object.getOwnPropertyDescriptor(AdapterProto, "info") !== undefined &&
    !!QueueProto &&
    typeof QueueProto.onSubmittedWorkDone === "function";
  const hasIntrospection =
    !!AdapterProto &&
    typeof AdapterProto.getInfo === "function" &&
    typeof AdapterProto.getFeatures === "function" &&
    typeof AdapterProto.getLimits === "function" &&
    !!DeviceProto &&
    typeof DeviceProto.getLimits === "function";
  const yes = "available";
  const state = (cond) => (cond ? "available" : "browser-missing");
  return {
    state: "available",
    subfeatures: {
      triangle: yes,
      buffers: yes,
      "bind-groups": yes,
      "vertex-index": yes,
      "textures-samplers": yes,
      "depth-stencil-blend": yes,
      "compute-bundles": state(hasRenderBundleEncoder),
      polish: state(hasPolish),
      introspection: state(hasIntrospection),
    },
  };
}

// -------------------------------------------------------------------
// Presence-only probes for browser:* packages whose availability can be
// answered by a small `typeof` / property check. Mirrors the
// BUILTIN_PROBES table in @wasmos/feature-creature-browser.
// -------------------------------------------------------------------
// Every check routes through `globalThis` to stay safe on runtimes where
// browser identifiers aren't declared at all (Node lacks `document`,
// `PublicKeyCredential`, etc.; touching an undeclared identifier throws
// even under `?.`, so `globalThis.X` is the only portable form).
const g = globalThis;
const nav = g.navigator;

const BUILTIN_PROBES = {
  "browser:animation": () =>
    typeof g.Animation === "function" &&
    typeof g.Element !== "undefined" &&
    typeof g.Element.prototype?.animate === "function",
  "browser:battery": () => typeof nav?.getBattery === "function",
  "browser:bluetooth": () => typeof nav?.bluetooth !== "undefined",
  "browser:broadcast-channel": () => typeof g.BroadcastChannel === "function",
  "browser:cache": () => typeof g.caches !== "undefined",
  "browser:canvas@0.1.0": () =>
    typeof g.HTMLCanvasElement === "function" ||
    typeof g.OffscreenCanvas === "function",
  "browser:clipboard": () => typeof nav?.clipboard !== "undefined",
  "browser:console": () => typeof g.console !== "undefined",
  "browser:contacts": () => typeof nav?.contacts !== "undefined",
  "browser:cookie-store": () => typeof nav?.cookieStore !== "undefined",
  "browser:credential-management": () => typeof nav?.credentials !== "undefined",
  "browser:crypto": () =>
    typeof g.crypto !== "undefined" && typeof g.crypto.subtle !== "undefined",
  "browser:dom": () => typeof g.document !== "undefined" && typeof g.Element !== "undefined",
  "browser:eme": () => typeof nav?.requestMediaKeySystemAccess === "function",
  "browser:events": () => typeof g.EventTarget === "function",
  "browser:fedcm": () => typeof g.IdentityCredential !== "undefined",
  "browser:fetch": () => typeof g.fetch === "function",
  "browser:file-system": () => typeof nav?.storage?.getDirectory === "function",
  "browser:fullscreen": () => typeof g.document?.exitFullscreen === "function",
  "browser:gamepad": () => typeof nav?.getGamepads === "function",
  "browser:geolocation": () => typeof nav?.geolocation !== "undefined",
  "browser:hid": () => typeof nav?.hid !== "undefined",
  "browser:history": () =>
    typeof g.history !== "undefined" && typeof g.history.pushState === "function",
  "browser:idle-detection": () => typeof g.IdleDetector === "function",
  "browser:indexeddb": () => typeof g.indexedDB !== "undefined",
  "browser:media": () =>
    typeof g.MediaStream === "function" || typeof nav?.mediaDevices !== "undefined",
  "browser:media-session": () => typeof nav?.mediaSession !== "undefined",
  "browser:midi": () => typeof nav?.requestMIDIAccess === "function",
  "browser:network-info": () => typeof nav?.connection !== "undefined",
  "browser:notifications": () => typeof g.Notification !== "undefined",
  "browser:payment": () => typeof g.PaymentRequest === "function",
  "browser:payment-handler": () => typeof g.PaymentInstruments === "function",
  "browser:performance": () => typeof g.performance !== "undefined",
  "browser:presentation": () => typeof nav?.presentation !== "undefined",
  "browser:push": () => typeof g.PushManager === "function",
  "browser:screen": () => typeof g.screen !== "undefined",
  "browser:sensor": () => typeof g.Accelerometer === "function",
  "browser:serial": () => typeof nav?.serial !== "undefined",
  "browser:service-worker": () => typeof nav?.serviceWorker !== "undefined",
  "browser:speech-recognition": () =>
    typeof g.SpeechRecognition !== "undefined" ||
    typeof g.webkitSpeechRecognition !== "undefined",
  "browser:speech-synthesis": () => typeof g.speechSynthesis !== "undefined",
  "browser:storage": () => typeof nav?.storage !== "undefined",
  "browser:usb": () => typeof nav?.usb !== "undefined",
  "browser:vibration": () => typeof nav?.vibrate === "function",
  "browser:wake-lock": () => typeof nav?.wakeLock !== "undefined",
  "browser:web-audio": () =>
    typeof g.AudioContext !== "undefined" || typeof g.webkitAudioContext !== "undefined",
  "browser:web-locks": () => typeof nav?.locks !== "undefined",
  "browser:web-transport": () => typeof g.WebTransport === "function",
  "browser:webauthn": () =>
    typeof g.PublicKeyCredential !== "undefined" &&
    typeof g.PublicKeyCredential.isConditionalMediationAvailable === "function",
  "browser:webrtc": () =>
    typeof g.RTCPeerConnection === "function" &&
    typeof g.RTCDataChannel === "function",
  "browser:websocket": () => typeof g.WebSocket === "function",
  "browser:worker": () => typeof g.Worker === "function",
};

// -------------------------------------------------------------------
// The `browser-probe` interface implementation the wasm guest calls once
// per catalog entry. Unknown packages return `shim-missing`; that's the
// right signal for a WIT surface we don't have a check for yet.
// -------------------------------------------------------------------
function probeImpl(pkg) {
  if (pkg === "browser:webgpu@0.9.0") {
    const r = probeWebgpu();
    const subfeatures = r.subfeatures
      ? Object.entries(r.subfeatures).map(([name, state]) => ({ name, state }))
      : [];
    return { package_: pkg, state: r.state, subfeatures };
  }
  const check = BUILTIN_PROBES[pkg];
  if (!check) {
    return { package_: pkg, state: "shim-missing", subfeatures: [] };
  }
  return {
    package_: pkg,
    state: check() ? "available" : "browser-missing",
    subfeatures: [],
  };
}

/**
 * Run the browser-detector component and return the report.
 * @returns {Promise<Array<{ package_: string, state: string, subfeatures: Array<{name:string,state:string}> }>>}
 */
export async function detectBrowserCapabilities() {
  const exp = await instantiate({
    [BROWSER_PROBE_IFACE]: { probe: probeImpl },
  });
  return exp[BROWSER_REPORT_IFACE]["detect-browser"]();
}
