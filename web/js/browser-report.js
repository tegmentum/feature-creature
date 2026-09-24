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
import { detectEnvironment } from "./environment.js";

const BROWSER_PROBE_IFACE = "feature-creature:engine/browser-probe@0.2.0";
const BROWSER_REPORT_IFACE = "feature-creature:engine/browser-report@0.2.0";
const ENVIRONMENT_IFACE = "feature-creature:engine/environment@0.2.0";

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
// Sub-feature-aware presence probes. Packages whose sub-feature
// taxonomy is documented in `browser-subfeatures.toml` need richer
// answers than the boolean BUILTIN_PROBES table above — each returns
// { state, subfeatures } where subfeatures is a per-layer state map
// mirroring the catalog. If the whole package is browser-missing,
// every sub-feature also reports browser-missing (rather than being
// omitted and letting the guest synthesise shim-missing, which would
// mis-attribute the gap to shim coverage).
// -------------------------------------------------------------------
function forAllSub(names, state) {
  const out = {};
  for (const n of names) out[n] = state;
  return out;
}

function probeServiceWorker() {
  const names = ["basic", "sync", "periodic-sync", "push"];
  const nav = g.navigator;
  if (!nav?.serviceWorker) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const swrp = g.ServiceWorkerRegistration?.prototype;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      sync: swrp && "sync" in swrp ? "available" : "browser-missing",
      "periodic-sync": swrp && "periodicSync" in swrp ? "available" : "browser-missing",
      push: swrp && "pushManager" in swrp ? "available" : "browser-missing",
    },
  };
}

function probeWorker() {
  const names = ["dedicated", "shared", "module"];
  const hasDedicated = typeof g.Worker === "function";
  if (!hasDedicated) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      dedicated: "available",
      shared: typeof g.SharedWorker === "function" ? "available" : "browser-missing",
      // Module workers can't be detected without actually instantiating
      // one — every modern engine that ships Worker also supports the
      // `{ type: 'module' }` option, so we report available when Worker
      // itself is available. If a caller wants ground-truth, they can
      // instantiate a real module worker and observe the pass.
      module: "available",
    },
  };
}

function probeStorage() {
  const names = ["basic", "estimate", "persist", "directory"];
  const nav = g.navigator;
  const s = nav?.storage;
  if (!s) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      estimate: typeof s.estimate === "function" ? "available" : "browser-missing",
      persist: typeof s.persist === "function" ? "available" : "browser-missing",
      directory: typeof s.getDirectory === "function" ? "available" : "browser-missing",
    },
  };
}

function probeWebauthn() {
  const names = ["basic", "conditional-mediation", "platform-auth", "client-capabilities"];
  const PKC = g.PublicKeyCredential;
  if (typeof PKC === "undefined") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "conditional-mediation":
        typeof PKC.isConditionalMediationAvailable === "function"
          ? "available"
          : "browser-missing",
      "platform-auth":
        typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable === "function"
          ? "available"
          : "browser-missing",
      "client-capabilities":
        typeof PKC.getClientCapabilities === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeCrypto() {
  const names = ["basic", "get-random-values", "random-uuid", "ed25519"];
  const c = g.crypto;
  if (!c || !c.subtle) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "get-random-values": typeof c.getRandomValues === "function" ? "available" : "browser-missing",
      "random-uuid": typeof c.randomUUID === "function" ? "available" : "browser-missing",
      // No cheap sync test for Ed25519 support — SubtleCrypto is
      // async, so we probe the `supportedAlgorithms` sentinel Chrome
      // exposes when available. Absent that, fall back to
      // browser-missing; every engine that ships Ed25519 in subtle
      // exposes it via `generateKey({ name: 'Ed25519' })` succeeding
      // at await time, which the WIT-sync-declared probe can't do.
      "ed25519":
        typeof c.subtle.supportedAlgorithms === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeMedia() {
  const names = ["basic", "recorder", "get-user-media", "device-enumeration"];
  const hasStream = typeof g.MediaStream === "function";
  const md = g.navigator?.mediaDevices;
  if (!hasStream && !md) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: hasStream ? "available" : "browser-missing",
      recorder: typeof g.MediaRecorder === "function" ? "available" : "browser-missing",
      "get-user-media": typeof md?.getUserMedia === "function" ? "available" : "browser-missing",
      "device-enumeration": typeof md?.enumerateDevices === "function" ? "available" : "browser-missing",
    },
  };
}

function probePerformance() {
  const names = ["basic", "observer", "memory", "longtask"];
  const p = g.performance;
  if (!p) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const PO = g.PerformanceObserver;
  const supported = PO?.supportedEntryTypes ?? [];
  return {
    state: "available",
    subfeatures: {
      basic: typeof p.now === "function" ? "available" : "browser-missing",
      observer: typeof PO === "function" ? "available" : "browser-missing",
      memory:
        typeof p.memory !== "undefined" ? "available" : "browser-missing",
      longtask:
        Array.isArray(supported) && supported.includes("longtask")
          ? "available"
          : "browser-missing",
    },
  };
}

function probeWebAudio() {
  const names = ["basic", "worklet", "offline", "analyser", "spatial"];
  const AC = g.AudioContext ?? g.webkitAudioContext;
  if (typeof AC !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      // `audioWorklet` is a getter on AudioContext instances that
      // reads `this` — accessing it on the prototype throws "Illegal
      // invocation". Check for the `AudioWorkletNode` global instead;
      // every engine that ships worklet exposes this constructor.
      worklet:
        typeof g.AudioWorkletNode === "function"
          ? "available"
          : "browser-missing",
      offline: typeof g.OfflineAudioContext === "function" ? "available" : "browser-missing",
      analyser: typeof g.AnalyserNode === "function" ? "available" : "browser-missing",
      spatial: typeof g.PannerNode === "function" ? "available" : "browser-missing",
    },
  };
}

function probeWebrtc() {
  const names = ["basic", "data-channel", "media-streams", "insertable-streams"];
  const PC = g.RTCPeerConnection;
  if (typeof PC !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const md = g.navigator?.mediaDevices;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "data-channel":
        typeof g.RTCDataChannel === "function" ||
        typeof PC.prototype?.createDataChannel === "function"
          ? "available"
          : "browser-missing",
      "media-streams":
        typeof md?.getUserMedia === "function" ? "available" : "browser-missing",
      "insertable-streams":
        typeof g.RTCRtpScriptTransform === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeFetch() {
  const names = ["basic", "abort-signal", "streaming-request", "keepalive", "priority"];
  if (typeof g.fetch !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  // Streaming request body needs `duplex: 'half'` + a ReadableStream
  // body; support is signalled by the presence of the `duplex` option
  // being reflected on the RequestInit. Sync probe: the Request
  // constructor accepting `{ duplex: 'half' }` without throwing.
  let streaming = "browser-missing";
  try {
    // Constructing with an empty body + duplex should succeed on
    // engines that ship streaming-request; on others it either
    // throws or silently ignores. Wrap in try/catch either way.
    new Request("about:blank", { method: "POST", duplex: "half", body: null });
    streaming = "available";
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "abort-signal":
        typeof g.AbortController === "function" && typeof g.AbortSignal === "function"
          ? "available"
          : "browser-missing",
      "streaming-request": streaming,
      // Every modern engine ships `keepalive` and `priority` options
      // on RequestInit; no cheap direct sync probe, but they're
      // universal in all three tested engines. Report available when
      // fetch itself is; a future browser without keepalive would fail
      // silently under real use, and this probe would need adjusting.
      keepalive: "available",
      priority: "available",
    },
  };
}

function probeFileSystem() {
  const names = [
    "basic",
    "picker",
    "save-picker",
    "directory-picker",
    "sync-access-handle",
  ];
  const hasBasic = typeof g.navigator?.storage?.getDirectory === "function";
  if (!hasBasic) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      picker: typeof g.showOpenFilePicker === "function" ? "available" : "browser-missing",
      "save-picker": typeof g.showSaveFilePicker === "function" ? "available" : "browser-missing",
      "directory-picker":
        typeof g.showDirectoryPicker === "function" ? "available" : "browser-missing",
      // FileSystemSyncAccessHandle is only reachable inside dedicated
      // workers; on the main thread, presence of the FileSystemFileHandle
      // prototype method is the best sync signal.
      "sync-access-handle":
        typeof g.FileSystemFileHandle?.prototype?.createSyncAccessHandle === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeIndexeddb() {
  const names = ["basic", "explicit-commit", "durability", "observer"];
  if (typeof g.indexedDB === "undefined") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const TX = g.IDBTransaction?.prototype;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "explicit-commit": TX && typeof TX.commit === "function" ? "available" : "browser-missing",
      // `{ durability }` is a config-time option — probe via the
      // `IDBDatabase.prototype.transaction` method's arity plus a
      // secondary signal: engines that ship it also expose
      // `IDBTransaction.prototype.durability` as a getter.
      durability:
        TX && "durability" in TX ? "available" : "browser-missing",
      // IDBObserver — no shipping engine has it as of this writing.
      observer: typeof g.IDBObserver === "function" ? "available" : "browser-missing",
    },
  };
}

function probeNotifications() {
  const names = ["basic", "actions", "badge", "image", "persistent"];
  const N = g.Notification;
  if (typeof N !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  // Every property lookup here could hit a getter with a `this`
  // assertion — reading them on the constructor or prototype throws
  // "Illegal invocation" on such engines. Guard each with try/catch.
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return false;
    }
  };
  const hasActions = safe(() => typeof N.maxActions === "number" && N.maxActions > 0);
  const hasBadge = safe(
    () =>
      Object.getOwnPropertyDescriptor(N.prototype, "badge") !== undefined,
  );
  const hasImage = safe(
    () =>
      Object.getOwnPropertyDescriptor(N.prototype, "image") !== undefined,
  );
  const swrp = g.ServiceWorkerRegistration?.prototype;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      actions: hasActions ? "available" : "browser-missing",
      badge: hasBadge ? "available" : "browser-missing",
      image: hasImage ? "available" : "browser-missing",
      persistent:
        swrp && typeof swrp.showNotification === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeWebsocket() {
  const names = ["basic", "binary-type", "streams"];
  if (typeof g.WebSocket !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  // `binaryType` is a getter on WebSocket instances — probe via the
  // property descriptor on the prototype, not by reading the value.
  let hasBinaryType = false;
  try {
    hasBinaryType =
      Object.getOwnPropertyDescriptor(g.WebSocket.prototype, "binaryType") !==
      undefined;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "binary-type": hasBinaryType ? "available" : "browser-missing",
      streams: typeof g.WebSocketStream === "function" ? "available" : "browser-missing",
    },
  };
}

const SUBFEATURE_PROBES = {
  "browser:webgpu@0.9.0": probeWebgpu,
  "browser:service-worker": probeServiceWorker,
  "browser:worker": probeWorker,
  "browser:storage": probeStorage,
  "browser:webauthn": probeWebauthn,
  "browser:crypto": probeCrypto,
  "browser:media": probeMedia,
  "browser:performance": probePerformance,
  "browser:web-audio": probeWebAudio,
  "browser:webrtc": probeWebrtc,
  "browser:fetch": probeFetch,
  "browser:file-system": probeFileSystem,
  "browser:indexeddb": probeIndexeddb,
  "browser:notifications": probeNotifications,
  "browser:websocket": probeWebsocket,
};

// -------------------------------------------------------------------
// The `browser-probe` interface implementation the wasm guest calls once
// per catalog entry. Unknown packages return `shim-missing`; that's the
// right signal for a WIT surface we don't have a check for yet.
// -------------------------------------------------------------------
function probeImpl(pkg) {
  const rich = SUBFEATURE_PROBES[pkg];
  if (rich) {
    const r = rich();
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
 * Run the browser-detector component and return both the browser
 * capability report and the environment snapshot. The environment
 * axis (SharedArrayBuffer, JSPI, JS String Builtins, streaming
 * compilation, etc.) is now part of the same wasm-component call —
 * the guest calls each environment.* import and packs the results
 * into `environment-snapshot`, so consumers get the full
 * platform-capability picture in one instantiation.
 *
 * The environment WIT declares its probes as sync bool-returning
 * funcs, but the JS implementations for `shared-memory-transferable`,
 * `bigint-integration`, `jspi`, and `js-string-builtins` are
 * inherently async (MessageChannel round-trip, wasm instantiate,
 * live-wrap probe). We pre-compute the whole snapshot BEFORE booting
 * the component and expose sync wrappers backed by the cache — the
 * guest sees synchronous imports the transpile ABI expects.
 *
 * @returns {Promise<{
 *   browser: Array<{ package_: string, state: string, subfeatures: Array<{name:string,state:string}> }>,
 *   environment: { shared_memory: boolean, shared_memory_transferable: boolean, bigint_integration: boolean, js_string_builtins: boolean, streaming_compilation: boolean, jspi: boolean }
 * }>}
 */
export async function detectBrowserCapabilities() {
  // Cache the async environment probes before boot so the sync
  // wrappers below can answer without suspending.
  const envCache = await detectEnvironment();

  const environmentImpls = {
    "shared-memory": () => !!envCache["shared-memory"],
    "shared-memory-transferable": () => !!envCache["shared-memory-transferable"],
    "bigint-integration": () => !!envCache["bigint-integration"],
    "js-string-builtins": () => !!envCache["js-string-builtins"],
    "streaming-compilation": () => !!envCache["streaming-compilation"],
    jspi: () => !!envCache["jspi"],
  };

  const exp = await instantiate({
    [BROWSER_PROBE_IFACE]: { probe: probeImpl },
    [ENVIRONMENT_IFACE]: environmentImpls,
  });
  const browser = exp[BROWSER_REPORT_IFACE]["detect-browser"]();
  const environment = exp[BROWSER_REPORT_IFACE]["detect-environment"]();
  return { browser, environment };
}
