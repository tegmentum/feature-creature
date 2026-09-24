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
function makeWebgpuProbe(asyncCache) {
  return function probeWebgpu() {
    return probeWebgpuInner(asyncCache);
  };
}
function probeWebgpuInner(asyncCache) {
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
        "adapter-info-content": "browser-missing",
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
      // Async pre-awaited: getInfo()/info actually returns a
      // non-empty vendor string. Chromium exposes it; Firefox and
      // WebKit mask most fields.
      "adapter-info-content":
        !!asyncCache?.webgpuAdapterInfo?.vendor ? "available" : "browser-missing",
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

function makeStorageProbe(asyncCache) {
  return function probeStorage() {
    const names = [
      "basic",
      "estimate",
      "estimate-values",
      "usage-details",
      "persist",
      "directory",
    ];
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
        // Async pre-awaited: `available` means estimate() actually
        // resolves to real quota + usage numbers, not just that the
        // method is exposed.
        "estimate-values": asyncCache.storageEstimate ? "available" : "browser-missing",
        // Chromium exposes a `usageDetails` breakdown per store
        // (indexedDB, caches, fileSystem, etc.); Firefox and WebKit
        // don't. Signals whether per-storage-kind accounting is
        // available.
        "usage-details":
          asyncCache.storageEstimate?.hasUsageDetails ? "available" : "browser-missing",
        persist: typeof s.persist === "function" ? "available" : "browser-missing",
        directory: typeof s.getDirectory === "function" ? "available" : "browser-missing",
      },
    };
  };
}

function makeWebauthnProbe(asyncCache) {
  return function probeWebauthn() {
    const names = [
      "basic",
      "conditional-mediation",
      "platform-auth",
      "client-capabilities",
    ];
    const PKC = g.PublicKeyCredential;
    if (typeof PKC === "undefined") {
      return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
    }
    return {
      state: "available",
      subfeatures: {
        basic: "available",
        // Async pre-awaited: `available` means the engine reported
        // conditional-mediation is actually usable, not just that the
        // method exists.
        "conditional-mediation": asyncCache.webauthnConditionalMediation
          ? "available"
          : "browser-missing",
        // Async pre-awaited: `available` means a platform authenticator
        // (Touch ID / Windows Hello / etc) is physically present.
        "platform-auth": asyncCache.webauthnPlatformAuthenticator
          ? "available"
          : "browser-missing",
        "client-capabilities":
          typeof PKC.getClientCapabilities === "function"
            ? "available"
            : "browser-missing",
      },
    };
  };
}

function makeCryptoProbe(asyncCache) {
  return function probeCrypto() {
    const names = ["basic", "get-random-values", "random-uuid", "ed25519"];
    const c = g.crypto;
    if (!c || !c.subtle) {
      return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
    }
    return {
      state: "available",
      subfeatures: {
        basic: "available",
        "get-random-values":
          typeof c.getRandomValues === "function" ? "available" : "browser-missing",
        "random-uuid": typeof c.randomUUID === "function" ? "available" : "browser-missing",
        // Ed25519 is async-only — SubtleCrypto.generateKey returns a
        // Promise, so a sync probe can't answer directly. The
        // detectBrowserCapabilities() flow pre-awaits the check and
        // hands us a cached boolean; that value is authoritative.
        ed25519: asyncCache.ed25519 ? "available" : "browser-missing",
      },
    };
  };
}

/**
 * Run every browser-side sub-feature probe whose answer requires an
 * async underlying API. WIT declares `browser-probe.probe` as sync;
 * we pre-compute the async signals before booting the wasm component
 * and expose the results through a cache that the sync probes above
 * close over.
 *
 * All probes run in parallel via Promise.all — each one wraps its own
 * try/catch so a single failure doesn't sink the batch. Missing values
 * fall to the corresponding "browser-missing" / null sentinel.
 */
async function runAsyncSubfeatureProbes() {
  const cache = {
    ed25519: false,
    webauthnPlatformAuthenticator: false,
    webauthnConditionalMediation: false,
    storageEstimate: null, // { quota, usage, hasUsageDetails }
    webgpuAdapterInfo: null, // { vendor, architecture, device, description, backendType, adapterType }
    mediaDevices: null, // { hasAudioInput, hasVideoInput, hasAudioOutput }
  };

  const probes = [
    // Ed25519 in SubtleCrypto — try to generate an Ed25519 key pair.
    // Rejects with NotSupportedError on engines that don't ship it.
    async () => {
      const s = g.crypto?.subtle;
      if (!s?.generateKey) return;
      const kp = await s.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      cache.ed25519 = !!kp;
    },

    // WebAuthn platform authenticator — the real answer requires
    // asking the browser "is one physically present". The sync
    // presence check just tells us the METHOD exists; this returns
    // the actual runtime state (Touch ID / Windows Hello / etc).
    async () => {
      const PKC = g.PublicKeyCredential;
      if (typeof PKC?.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return;
      const v = await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
      cache.webauthnPlatformAuthenticator = !!v;
    },

    // WebAuthn conditional mediation — same distinction as above:
    // sync test says "method exists", async test says "engine + OS
    // will actually surface conditional-mediation UI".
    async () => {
      const PKC = g.PublicKeyCredential;
      if (typeof PKC?.isConditionalMediationAvailable !== "function") return;
      const v = await PKC.isConditionalMediationAvailable();
      cache.webauthnConditionalMediation = !!v;
    },

    // Storage estimate — the sync test only checks that `estimate` is
    // a function. The async test confirms the engine returns real quota
    // numbers, and reports whether the `usageDetails` breakdown is
    // populated (Chromium exposes per-store details, others don't).
    async () => {
      const s = nav?.storage;
      if (typeof s?.estimate !== "function") return;
      const est = await s.estimate();
      const details = est && est.usageDetails;
      cache.storageEstimate = {
        quota: typeof est?.quota === "number" ? est.quota : 0,
        usage: typeof est?.usage === "number" ? est.usage : 0,
        hasUsageDetails:
          !!details && Object.keys(details).length > 0,
      };
    },

    // WebGPU adapter info — pre-await requestAdapter, then read
    // adapter.info (v0.8) or adapter.getInfo() (v0.9). Provides real
    // hardware vendor + architecture strings when the browser exposes
    // them (Chromium does; Firefox and WebKit largely mask them).
    async () => {
      const gpu = nav?.gpu;
      if (typeof gpu?.requestAdapter !== "function") return;
      const adapter = await gpu.requestAdapter().catch(() => null);
      if (!adapter) return;
      let info = null;
      // v0.9: async getInfo() returning a full record.
      if (typeof adapter.getInfo === "function") {
        try {
          info = await adapter.getInfo();
        } catch {}
      }
      // v0.8 fallback: sync `.info` getter.
      if (!info && adapter.info) info = adapter.info;
      if (!info) return;
      cache.webgpuAdapterInfo = {
        vendor: String(info.vendor ?? ""),
        architecture: String(info.architecture ?? ""),
        device: String(info.device ?? ""),
        description: String(info.description ?? ""),
        backendType: String(info.backendType ?? ""),
        adapterType: String(info.adapterType ?? ""),
      };
    },

    // MediaDevices enumeration — every engine that ships MediaDevices
    // returns a list of devices, but labels are blank until the user
    // grants microphone/camera permission. We only care about `kind`,
    // which is populated regardless. Reveals whether the machine
    // physically has an audio-in, video-in, or audio-out endpoint.
    async () => {
      const md = nav?.mediaDevices;
      if (typeof md?.enumerateDevices !== "function") return;
      const devices = await md.enumerateDevices();
      const kinds = new Set(
        Array.isArray(devices) ? devices.map((d) => d?.kind) : [],
      );
      cache.mediaDevices = {
        hasAudioInput: kinds.has("audioinput"),
        hasVideoInput: kinds.has("videoinput"),
        hasAudioOutput: kinds.has("audiooutput"),
      };
    },
  ];

  await Promise.all(
    probes.map((fn) => fn().catch(() => {})), // suppress per-probe failures
  );
  return cache;
}

function makeMediaProbe(asyncCache) {
  return function probeMedia() {
    const names = [
      "basic",
      "recorder",
      "get-user-media",
      "device-enumeration",
      "audio-input-devices",
      "video-input-devices",
      "audio-output-devices",
    ];
    const hasStream = typeof g.MediaStream === "function";
    const md = g.navigator?.mediaDevices;
    if (!hasStream && !md) {
      return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
    }
    const dev = asyncCache.mediaDevices;
    return {
      state: "available",
      subfeatures: {
        basic: hasStream ? "available" : "browser-missing",
        recorder: typeof g.MediaRecorder === "function" ? "available" : "browser-missing",
        "get-user-media":
          typeof md?.getUserMedia === "function" ? "available" : "browser-missing",
        "device-enumeration":
          typeof md?.enumerateDevices === "function" ? "available" : "browser-missing",
        // Async pre-awaited enumerateDevices: reveals which physical
        // device kinds are present. Labels are blank without user
        // permission, but the `kind` field is always populated.
        "audio-input-devices": dev?.hasAudioInput ? "available" : "browser-missing",
        "video-input-devices": dev?.hasVideoInput ? "available" : "browser-missing",
        "audio-output-devices": dev?.hasAudioOutput ? "available" : "browser-missing",
      },
    };
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

function probeBluetooth() {
  const names = ["basic", "request-device", "get-availability", "get-devices"];
  const bt = nav?.bluetooth;
  if (!bt) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "request-device": typeof bt.requestDevice === "function" ? "available" : "browser-missing",
      "get-availability": typeof bt.getAvailability === "function" ? "available" : "browser-missing",
      "get-devices": typeof bt.getDevices === "function" ? "available" : "browser-missing",
    },
  };
}

function probeHid() {
  const names = ["basic", "request-device", "get-devices"];
  const h = nav?.hid;
  if (!h) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "request-device": typeof h.requestDevice === "function" ? "available" : "browser-missing",
      "get-devices": typeof h.getDevices === "function" ? "available" : "browser-missing",
    },
  };
}

function probeUsb() {
  const names = ["basic", "request-device", "get-devices"];
  const u = nav?.usb;
  if (!u) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "request-device": typeof u.requestDevice === "function" ? "available" : "browser-missing",
      "get-devices": typeof u.getDevices === "function" ? "available" : "browser-missing",
    },
  };
}

function probeSerial() {
  const names = ["basic", "request-port", "get-ports"];
  const s = nav?.serial;
  if (!s) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "request-port": typeof s.requestPort === "function" ? "available" : "browser-missing",
      "get-ports": typeof s.getPorts === "function" ? "available" : "browser-missing",
    },
  };
}

function probeIdleDetection() {
  const names = ["basic", "permission"];
  const ID = g.IdleDetector;
  if (typeof ID !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      permission: typeof ID.requestPermission === "function" ? "available" : "browser-missing",
    },
  };
}

function probeMediaSession() {
  const names = ["basic", "action-handlers", "position-state"];
  const ms = nav?.mediaSession;
  if (!ms) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "action-handlers": typeof ms.setActionHandler === "function" ? "available" : "browser-missing",
      "position-state": typeof ms.setPositionState === "function" ? "available" : "browser-missing",
    },
  };
}

function probeSpeechSynthesis() {
  const names = ["basic", "voices-available", "boundary-events"];
  const ss = g.speechSynthesis;
  if (!ss) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  // Voice list can be empty at page load until the async voiceschanged
  // event fires; use presence-of-getVoices as a proxy and check the
  // count. Zero voices at probe time still counts as basic-available.
  let voiceCount = 0;
  try {
    const list = typeof ss.getVoices === "function" ? ss.getVoices() : [];
    voiceCount = Array.isArray(list) ? list.length : 0;
  } catch {
    // fall through
  }
  let hasBoundary = false;
  try {
    const SSU = g.SpeechSynthesisUtterance;
    hasBoundary =
      typeof SSU === "function" &&
      Object.getOwnPropertyDescriptor(SSU.prototype, "onboundary") !== undefined;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "voices-available": voiceCount > 0 ? "available" : "browser-missing",
      "boundary-events": hasBoundary ? "available" : "browser-missing",
    },
  };
}

function probeWebTransport() {
  const names = [
    "basic",
    "datagrams",
    "unidirectional-streams",
    "bidirectional-streams",
  ];
  const WT = g.WebTransport;
  if (typeof WT !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  let hasProto = false;
  let hasDatagrams = false;
  let hasUni = false;
  let hasBi = false;
  try {
    const proto = WT.prototype;
    hasProto = !!proto;
    hasDatagrams =
      proto && Object.getOwnPropertyDescriptor(proto, "datagrams") !== undefined;
    hasUni =
      proto && typeof proto.createUnidirectionalStream === "function";
    hasBi = proto && typeof proto.createBidirectionalStream === "function";
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: hasProto ? "available" : "browser-missing",
      datagrams: hasDatagrams ? "available" : "browser-missing",
      "unidirectional-streams": hasUni ? "available" : "browser-missing",
      "bidirectional-streams": hasBi ? "available" : "browser-missing",
    },
  };
}

function probeAnimation() {
  const names = ["basic", "timeline", "keyframe-effect", "group-effects"];
  const El = g.Element;
  const hasBasic = typeof El?.prototype?.animate === "function";
  if (!hasBasic) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      timeline: typeof g.DocumentTimeline === "function" ? "available" : "browser-missing",
      "keyframe-effect": typeof g.KeyframeEffect === "function" ? "available" : "browser-missing",
      "group-effects": typeof g.GroupEffect === "function" ? "available" : "browser-missing",
    },
  };
}

function probeCache() {
  const names = ["basic", "open", "match", "keys", "delete"];
  const c = g.caches;
  if (!c) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      open: typeof c.open === "function" ? "available" : "browser-missing",
      match: typeof c.match === "function" ? "available" : "browser-missing",
      keys: typeof c.keys === "function" ? "available" : "browser-missing",
      delete: typeof c.delete === "function" ? "available" : "browser-missing",
    },
  };
}

function probeCanvas() {
  const names = ["basic", "context-2d", "offscreen", "image-data", "blob-export"];
  const HC = g.HTMLCanvasElement;
  if (typeof HC !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "context-2d": typeof HC.prototype?.getContext === "function" ? "available" : "browser-missing",
      offscreen: typeof g.OffscreenCanvas === "function" ? "available" : "browser-missing",
      "image-data": typeof g.ImageData === "function" ? "available" : "browser-missing",
      "blob-export": typeof HC.prototype?.toBlob === "function" ? "available" : "browser-missing",
    },
  };
}

function probeClipboard() {
  const names = ["basic", "read-text", "write-text", "read-items", "write-items"];
  const c = nav?.clipboard;
  if (!c) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "read-text": typeof c.readText === "function" ? "available" : "browser-missing",
      "write-text": typeof c.writeText === "function" ? "available" : "browser-missing",
      "read-items": typeof c.read === "function" ? "available" : "browser-missing",
      "write-items": typeof c.write === "function" ? "available" : "browser-missing",
    },
  };
}

function probeContacts() {
  const names = ["basic", "select", "get-properties"];
  const c = nav?.contacts;
  if (!c) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      select: typeof c.select === "function" ? "available" : "browser-missing",
      "get-properties": typeof c.getProperties === "function" ? "available" : "browser-missing",
    },
  };
}

function probeCookieStore() {
  const names = ["basic", "get", "set", "delete", "change-events"];
  const cs = g.cookieStore;
  if (!cs) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  let hasChange = false;
  try {
    const CS = g.CookieStore;
    hasChange =
      typeof CS === "function" &&
      Object.getOwnPropertyDescriptor(CS.prototype, "onchange") !== undefined;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      get: typeof cs.get === "function" ? "available" : "browser-missing",
      set: typeof cs.set === "function" ? "available" : "browser-missing",
      delete: typeof cs.delete === "function" ? "available" : "browser-missing",
      "change-events": hasChange ? "available" : "browser-missing",
    },
  };
}

function probeCredentialManagement() {
  const names = ["basic", "password-credential", "federated-credential", "store", "prevent-silent-access"];
  const cred = nav?.credentials;
  if (!cred) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "password-credential":
        typeof g.PasswordCredential === "function" ? "available" : "browser-missing",
      "federated-credential":
        typeof g.FederatedCredential === "function" ? "available" : "browser-missing",
      store: typeof cred.store === "function" ? "available" : "browser-missing",
      "prevent-silent-access":
        typeof cred.preventSilentAccess === "function" ? "available" : "browser-missing",
    },
  };
}

function probeDom() {
  const names = ["basic", "custom-elements", "shadow-dom", "form-associated", "popover", "dialog"];
  const doc = g.document;
  if (!doc || typeof g.Element === "undefined") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const HE = g.HTMLElement;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "custom-elements":
        typeof g.customElements !== "undefined" ? "available" : "browser-missing",
      "shadow-dom":
        typeof g.Element?.prototype?.attachShadow === "function" ? "available" : "browser-missing",
      "form-associated":
        typeof g.ElementInternals === "function" ? "available" : "browser-missing",
      popover:
        typeof HE?.prototype?.showPopover === "function" ? "available" : "browser-missing",
      dialog:
        typeof g.HTMLDialogElement === "function" ? "available" : "browser-missing",
    },
  };
}

function probeEme() {
  const names = ["basic", "hdcp-policy", "persistent-license"];
  if (typeof nav?.requestMediaKeySystemAccess !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const MK = g.MediaKeys;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      // Requires an actual MediaKeys instance to test — probe via the
      // prototype for a sync heuristic.
      "hdcp-policy":
        typeof MK?.prototype?.getStatusForPolicy === "function"
          ? "available"
          : "browser-missing",
      // Persistent license is a sessionType string; no reliable sync
      // check without creating a session. Report available whenever
      // basic ships.
      "persistent-license": "available",
    },
  };
}

function probeEvents() {
  const names = ["basic", "custom-event", "abort-signal", "options-object"];
  if (typeof g.EventTarget !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  // AbortSignal integration + options object are both universal on
  // modern engines. Detect via a test add/remove that would throw on
  // an engine that doesn't support the option shape.
  let hasSignal = false;
  let hasOptions = false;
  try {
    const et = new g.EventTarget();
    const ctrl = new g.AbortController();
    let called = false;
    et.addEventListener("x", () => (called = true), { signal: ctrl.signal });
    ctrl.abort();
    et.dispatchEvent(new g.Event("x"));
    hasSignal = !called;
    et.addEventListener("y", () => {}, { once: true, passive: true });
    hasOptions = true;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "custom-event": typeof g.CustomEvent === "function" ? "available" : "browser-missing",
      "abort-signal": hasSignal ? "available" : "browser-missing",
      "options-object": hasOptions ? "available" : "browser-missing",
    },
  };
}

function probeFedcm() {
  const names = ["basic", "active-mode", "disconnect"];
  const IC = g.IdentityCredential;
  if (typeof IC === "undefined") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "active-mode": typeof g.IdentityProvider !== "undefined" ? "available" : "browser-missing",
      disconnect: typeof IC.disconnect === "function" ? "available" : "browser-missing",
    },
  };
}

function probeFullscreen() {
  const names = ["basic", "request-element", "orientation-lock"];
  const doc = g.document;
  if (typeof doc?.exitFullscreen !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const El = g.Element;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "request-element":
        typeof El?.prototype?.requestFullscreen === "function"
          ? "available"
          : "browser-missing",
      "orientation-lock":
        typeof g.screen?.orientation?.lock === "function" ? "available" : "browser-missing",
    },
  };
}

function probeGamepad() {
  const names = ["basic", "vibration-actuator", "haptic-actuators"];
  if (typeof nav?.getGamepads !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const GP = g.Gamepad;
  let hasVib = false;
  let hasHaptic = false;
  try {
    hasVib =
      GP?.prototype
        ? Object.getOwnPropertyDescriptor(GP.prototype, "vibrationActuator") !== undefined
        : false;
    hasHaptic =
      GP?.prototype
        ? Object.getOwnPropertyDescriptor(GP.prototype, "hapticActuators") !== undefined
        : false;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "vibration-actuator": hasVib ? "available" : "browser-missing",
      "haptic-actuators": hasHaptic ? "available" : "browser-missing",
    },
  };
}

function probeGeolocation() {
  const names = ["basic", "get-current-position", "watch-position", "high-accuracy"];
  const geo = nav?.geolocation;
  if (!geo) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "get-current-position":
        typeof geo.getCurrentPosition === "function" ? "available" : "browser-missing",
      "watch-position":
        typeof geo.watchPosition === "function" ? "available" : "browser-missing",
      "high-accuracy": "available",
    },
  };
}

function probeHistory() {
  const names = ["basic", "push-state", "replace-state", "navigation-api"];
  const h = g.history;
  if (!h) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "push-state": typeof h.pushState === "function" ? "available" : "browser-missing",
      "replace-state": typeof h.replaceState === "function" ? "available" : "browser-missing",
      "navigation-api": typeof g.navigation !== "undefined" ? "available" : "browser-missing",
    },
  };
}

function probeMidi() {
  const names = ["basic", "sysex", "software-synth"];
  if (typeof nav?.requestMIDIAccess !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  // `sysex` and `software` are options on requestMIDIAccess. Every
  // engine that ships the API supports the options; the actual
  // permission is user-granted at request time.
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      sysex: "available",
      "software-synth": "available",
    },
  };
}

function probeNetworkInfo() {
  const names = ["basic", "effective-type", "downlink", "rtt", "save-data"];
  const c = nav?.connection;
  if (!c) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  let hasType = false, hasDl = false, hasRtt = false, hasSave = false;
  try {
    hasType = "effectiveType" in c;
    hasDl = "downlink" in c;
    hasRtt = "rtt" in c;
    hasSave = "saveData" in c;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "effective-type": hasType ? "available" : "browser-missing",
      downlink: hasDl ? "available" : "browser-missing",
      rtt: hasRtt ? "available" : "browser-missing",
      "save-data": hasSave ? "available" : "browser-missing",
    },
  };
}

function probePayment() {
  const names = ["basic", "can-make-payment", "show", "abort", "update-events"];
  const PR = g.PaymentRequest;
  if (typeof PR !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const proto = PR.prototype;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "can-make-payment":
        typeof proto?.canMakePayment === "function" ? "available" : "browser-missing",
      show: typeof proto?.show === "function" ? "available" : "browser-missing",
      abort: typeof proto?.abort === "function" ? "available" : "browser-missing",
      "update-events":
        typeof g.PaymentRequestUpdateEvent === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probePaymentHandler() {
  const names = ["basic", "user-hint", "instruments"];
  const PM = g.PaymentManager;
  if (typeof PM !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const proto = PM.prototype;
  let hasHint = false;
  try {
    hasHint =
      proto ? Object.getOwnPropertyDescriptor(proto, "userHint") !== undefined : false;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "user-hint": hasHint ? "available" : "browser-missing",
      instruments:
        typeof g.PaymentInstruments === "function" ? "available" : "browser-missing",
    },
  };
}

function probePresentation() {
  const names = ["basic", "controller", "receiver", "default-request"];
  const p = nav?.presentation;
  if (!p) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      controller: typeof g.PresentationRequest === "function" ? "available" : "browser-missing",
      receiver: typeof g.PresentationReceiver === "function" ? "available" : "browser-missing",
      "default-request": "defaultRequest" in p ? "available" : "browser-missing",
    },
  };
}

function probePush() {
  const names = ["basic", "subscribe", "get-subscription", "permission-state", "supported-encodings"];
  const PM = g.PushManager;
  if (typeof PM !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const proto = PM.prototype;
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      subscribe: typeof proto?.subscribe === "function" ? "available" : "browser-missing",
      "get-subscription":
        typeof proto?.getSubscription === "function" ? "available" : "browser-missing",
      "permission-state":
        typeof proto?.permissionState === "function" ? "available" : "browser-missing",
      "supported-encodings":
        Array.isArray(PM.supportedContentEncodings) ? "available" : "browser-missing",
    },
  };
}

function probeScreen() {
  const names = ["basic", "orientation", "capture", "multi-screen"];
  const s = g.screen;
  if (!s) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      orientation: s.orientation ? "available" : "browser-missing",
      capture: typeof nav?.mediaDevices?.getDisplayMedia === "function"
        ? "available"
        : "browser-missing",
      "multi-screen":
        typeof g.getScreenDetails === "function" || typeof g.window?.getScreenDetails === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeSensor() {
  const names = [
    "basic",
    "accelerometer",
    "gyroscope",
    "linear-acceleration",
    "orientation",
    "absolute-orientation",
    "magnetometer",
    "ambient-light",
    "gravity",
  ];
  const hasBasic = typeof g.Sensor === "function";
  const hasAccel = typeof g.Accelerometer === "function";
  if (!hasBasic && !hasAccel) {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  return {
    state: "available",
    subfeatures: {
      basic: hasBasic ? "available" : "browser-missing",
      accelerometer: hasAccel ? "available" : "browser-missing",
      gyroscope: typeof g.Gyroscope === "function" ? "available" : "browser-missing",
      "linear-acceleration":
        typeof g.LinearAccelerationSensor === "function" ? "available" : "browser-missing",
      orientation:
        typeof g.RelativeOrientationSensor === "function" ? "available" : "browser-missing",
      "absolute-orientation":
        typeof g.AbsoluteOrientationSensor === "function" ? "available" : "browser-missing",
      magnetometer: typeof g.Magnetometer === "function" ? "available" : "browser-missing",
      "ambient-light":
        typeof g.AmbientLightSensor === "function" ? "available" : "browser-missing",
      gravity: typeof g.GravitySensor === "function" ? "available" : "browser-missing",
    },
  };
}

function probeSpeechRecognition() {
  const names = ["basic", "continuous", "interim-results", "grammars"];
  const SR = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (typeof SR !== "function") {
    return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  }
  const proto = SR.prototype;
  let hasCont = false, hasInterim = false;
  try {
    hasCont = proto
      ? Object.getOwnPropertyDescriptor(proto, "continuous") !== undefined
      : false;
    hasInterim = proto
      ? Object.getOwnPropertyDescriptor(proto, "interimResults") !== undefined
      : false;
  } catch {
    // fall through
  }
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      continuous: hasCont ? "available" : "browser-missing",
      "interim-results": hasInterim ? "available" : "browser-missing",
      grammars:
        typeof g.SpeechGrammarList === "function" ||
        typeof g.webkitSpeechGrammarList === "function"
          ? "available"
          : "browser-missing",
    },
  };
}

function probeWakeLock() {
  const names = ["basic", "screen-lock", "system-lock"];
  const wl = nav?.wakeLock;
  if (!wl) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      "screen-lock": typeof wl.request === "function" ? "available" : "browser-missing",
      // `system` type is a proposal, nowhere shipping in stable.
      "system-lock": "browser-missing",
    },
  };
}

function probeWebLocks() {
  const names = ["basic", "request", "query", "if-available", "steal"];
  const l = nav?.locks;
  if (!l) return { state: "browser-missing", subfeatures: forAllSub(names, "browser-missing") };
  return {
    state: "available",
    subfeatures: {
      basic: "available",
      request: typeof l.request === "function" ? "available" : "browser-missing",
      query: typeof l.query === "function" ? "available" : "browser-missing",
      // These options are universal wherever locks ships — the API
      // rejects the promise for an actual conflict at call time, not
      // at API-check time. Report available whenever request ships.
      "if-available": typeof l.request === "function" ? "available" : "browser-missing",
      steal: typeof l.request === "function" ? "available" : "browser-missing",
    },
  };
}

function makeSubfeatureProbes(asyncCache) {
  return {
    "browser:webgpu@0.9.0": makeWebgpuProbe(asyncCache),
    "browser:service-worker": probeServiceWorker,
    "browser:worker": probeWorker,
    "browser:storage": makeStorageProbe(asyncCache),
    "browser:webauthn": makeWebauthnProbe(asyncCache),
    "browser:crypto": makeCryptoProbe(asyncCache),
    "browser:media": makeMediaProbe(asyncCache),
    "browser:performance": probePerformance,
    "browser:web-audio": probeWebAudio,
    "browser:webrtc": probeWebrtc,
    "browser:fetch": probeFetch,
    "browser:file-system": probeFileSystem,
    "browser:indexeddb": probeIndexeddb,
    "browser:notifications": probeNotifications,
    "browser:websocket": probeWebsocket,
    "browser:bluetooth": probeBluetooth,
    "browser:hid": probeHid,
    "browser:usb": probeUsb,
    "browser:serial": probeSerial,
    "browser:idle-detection": probeIdleDetection,
    "browser:media-session": probeMediaSession,
    "browser:speech-synthesis": probeSpeechSynthesis,
    "browser:web-transport": probeWebTransport,
    "browser:animation": probeAnimation,
    "browser:cache": probeCache,
    "browser:canvas@0.1.0": probeCanvas,
    "browser:clipboard": probeClipboard,
    "browser:contacts": probeContacts,
    "browser:cookie-store": probeCookieStore,
    "browser:credential-management": probeCredentialManagement,
    "browser:dom": probeDom,
    "browser:eme": probeEme,
    "browser:events": probeEvents,
    "browser:fedcm": probeFedcm,
    "browser:fullscreen": probeFullscreen,
    "browser:gamepad": probeGamepad,
    "browser:geolocation": probeGeolocation,
    "browser:history": probeHistory,
    "browser:midi": probeMidi,
    "browser:network-info": probeNetworkInfo,
    "browser:payment": probePayment,
    "browser:payment-handler": probePaymentHandler,
    "browser:presentation": probePresentation,
    "browser:push": probePush,
    "browser:screen": probeScreen,
    "browser:sensor": probeSensor,
    "browser:speech-recognition": probeSpeechRecognition,
    "browser:wake-lock": probeWakeLock,
    "browser:web-locks": probeWebLocks,
  };
}

// -------------------------------------------------------------------
// The `browser-probe` interface implementation the wasm guest calls once
// per catalog entry. Unknown packages return `shim-missing`; that's the
// right signal for a WIT surface we don't have a check for yet. Closed
// over an async-cache built by `runAsyncSubfeatureProbes` so probes
// that need async underlying APIs (Ed25519 in SubtleCrypto today) can
// return an authoritative answer from a sync WIT call.
// -------------------------------------------------------------------
function makeProbeImpl(subfeatureProbes) {
  return function probeImpl(pkg) {
    const rich = subfeatureProbes[pkg];
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
  // Pre-run every async signal we need before booting the component:
  //   1. The six environment probes (SharedArrayBuffer, JSPI, etc.).
  //   2. Async sub-feature signals (Ed25519 SubtleCrypto today) that
  //      the WIT declares as sync but need an actual `await` on the
  //      underlying API to answer honestly.
  const [envCache, asyncSubCache] = await Promise.all([
    detectEnvironment(),
    runAsyncSubfeatureProbes(),
  ]);

  const environmentImpls = {
    "shared-memory": () => !!envCache["shared-memory"],
    "shared-memory-transferable": () => !!envCache["shared-memory-transferable"],
    "bigint-integration": () => !!envCache["bigint-integration"],
    "js-string-builtins": () => !!envCache["js-string-builtins"],
    "streaming-compilation": () => !!envCache["streaming-compilation"],
    jspi: () => !!envCache["jspi"],
  };

  const subfeatureProbes = makeSubfeatureProbes(asyncSubCache);
  const probe = makeProbeImpl(subfeatureProbes);

  const exp = await instantiate({
    [BROWSER_PROBE_IFACE]: { probe },
    [ENVIRONMENT_IFACE]: environmentImpls,
  });
  const browser = exp[BROWSER_REPORT_IFACE]["detect-browser"]();
  const environment = exp[BROWSER_REPORT_IFACE]["detect-environment"]();
  return { browser, environment };
}
