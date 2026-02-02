(() => {
  "use strict";

  const debug = (window.debug && typeof window.debug.log === "function")
    ? window.debug
    : { log: function () {} };


  const EFFECT = Object.freeze({
    OFF: 0,
    HEARTBEAT: 1,
    GLOW: 2,
    WOBBLE: 3,
    ADDITIVE: 4,
    COLORSHIFT: 5,
    SCALEWAVE: 6,
    BURST: 7,
    RANDOM: 8,
  });

  const ID_TO_KEY = {
    [EFFECT.HEARTBEAT]: "heartbeat",
    [EFFECT.GLOW]: "glow",
    [EFFECT.WOBBLE]: "wobble",
    [EFFECT.ADDITIVE]: "additive",
    [EFFECT.COLORSHIFT]: "colorShift",
    [EFFECT.SCALEWAVE]: "scaleWave",
    [EFFECT.BURST]: "burst",
    [EFFECT.RANDOM]: "random",
  };

  const HUB = Object.freeze({
    OFF: 0,
    STREAMERBOT: 1,
    FIREBOT: 2,
  });

  const ALERT_KEYS = ["follow","sub","resub","giftsub","giftbomb","cheer","raid"];
  const UI_CHANNEL = "vday-config";
  const UI_STORAGE_KEY = "vday_alerts_ui_bridge_v1";
  
  const PRESETS = {
    heartbeat: {
      durationMs: 1800,
      beatsPerSecond: 2.6,
      pulseStrength: 0.7,
      densityMul: 1.0,
      speedMul: 1.0,
    },
    glow: {
      durationMs: 2200,
      attack: 0.06,
      decay: 0.35,
      alphaMax: 100,
      blurMaxPx: 100,
      strength: 20,
    },
    additive: {
      durationMs: 1000,
      attack: 0.04,
      decay: 0.5,
      alphaAmp: 5,
    },
    wobble: {
      durationMs: 1500,
      attack: 0.04,
      decay: 0.28,
      angleRad: (90 * Math.PI) / 180,
      freqHz: 3.0,
    },
    colorShift: {
      durationMs: 2200,
      attack: 0.03,
      decay: 0.25,
      cycles: 5,
    },
    scaleWave: {
      durationMs: 1100,
      attack: 0.04,
      decay: 0.28,
      amp: 0.5,
      freqHz: 5.5,
    },
    burst: {
      durationMs: 900,
      attack: 0.03,
      decay: 0.18,
      densityMul: 10,
      speedMul: 5,
    },
  };

  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  let DEBUG = false;
  function log(...a) { if (DEBUG) debug.log(...a); }
  function warn(...a) { if (DEBUG) debug.log(...a); }
  
  const state = {
    alertsEnabled: false,

    spawnMode: "continuous",
    triggerUntilMs: 0,
    triggerWindowMs: 6000,

    alertHub: HUB.OFF,
    effectsByAlert: {
      follow: EFFECT.OFF,
      sub: EFFECT.OFF,
      resub: EFFECT.OFF,
      giftsub: EFFECT.OFF,
      giftbomb: EFFECT.OFF,
      cheer: EFFECT.OFF,
      raid: EFFECT.OFF,
    },
    
    ws: null,
    wsHub: HUB.OFF,
    wsStatus: "idle",
    lastError: "",
    lastEvent: "",
    lastEventAt: 0,

    riveStatus: "waiting",
    riveDetails: "",
  };

  let bound = false;
  let mainVM = null;
  let alertsContainerVM = null;

  // From .updated
  let lastFrameMs = 0;
  const lastRenderMods = {
    glowAlpha: 0,
    glowBlur: 0,
    additiveAlpha: 0,
    wobbleAngle: 0,
    hueShift: 0,
    scaleWave: 0,
    burstBoost: 0,
  };

  function resetRenderMods() {
    lastRenderMods.glowAlpha = 0;
    lastRenderMods.glowBlur = 0;
    lastRenderMods.additiveAlpha = 0;
    lastRenderMods.wobbleAngle = 0;
    lastRenderMods.hueShift = 0;
    lastRenderMods.scaleWave = 0;
    lastRenderMods.burstBoost = 0;
  }

  function makeLayer(preset) {
    return {
      queue: [],
      active: null,
      preset,
    };
  }

  const layers = {
    heartbeat: makeLayer(PRESETS.heartbeat),
    glow: makeLayer(PRESETS.glow),
    additive: makeLayer(PRESETS.additive),
    wobble: makeLayer(PRESETS.wobble),
    colorShift: makeLayer(PRESETS.colorShift),
    scaleWave: makeLayer(PRESETS.scaleWave),
    burst: makeLayer(PRESETS.burst),
  };

  function enqueueEffect(key, nowMs) {
    const layer = layers[key];
    if (!layer) return;
    layer.queue.push({ at: nowMs });
  }

  function pickRandomEffect() {
    const keys = Object.keys(PRESETS);
    return keys[(Math.random() * keys.length) | 0];
  }

  function tickLayer(layer, nowMs) {
    const p = layer.preset;

    if (!layer.active && layer.queue.length) {
      const item = layer.queue.shift();
      layer.active = {
        startMs: nowMs,
        durationMs: p.durationMs,
        preset: p,
      };
      return;
    }

    const a = layer.active;
    if (!a) return;

    if (nowMs - a.startMs >= a.durationMs) {
      layer.active = null;
    }
  }

  function envAD(tt, attack, decay) {
    if (tt <= 0) return 0;
    if (tt >= 1) return 0;
    const a = clamp01(tt / Math.max(1e-6, attack));
    const d = clamp01((1 - tt) / Math.max(1e-6, decay));
    return Math.min(a, d);
  }

  function computeHeartbeatSizeMul(tt, durationMs) {
    const p = PRESETS.heartbeat;
    const tSec = (tt * durationMs) / 1000;
    const phase = tSec * p.beatsPerSecond * Math.PI * 2;
    const pulse = Math.max(0, Math.sin(phase));
    return 1 + pulse * p.pulseStrength;
  }

  function activateTriggerWindow(nowMs, extraMs) {
    if (state.spawnMode !== "trigger") return;
    const dur = Number.isFinite(extraMs) ? extraMs : state.triggerWindowMs;
    const until = nowMs + Math.max(0, dur);
    if (until > state.triggerUntilMs) state.triggerUntilMs = until;
  }
  
  function getMultipliers(nowMs) {
    if (!lastFrameMs) lastFrameMs = nowMs;
    lastFrameMs = nowMs;

    for (const k of Object.keys(layers)) tickLayer(layers[k], nowMs);

    const out = {
      densityMul: 1,
      speedMul: 1,
      sizeMul: 1,
      scaleMul: 1,
      alphaMul: 1,
      hueShift: 0,
      additive: 0,
      wobble: 0,
      glow: 0,
      burst: 0,
    };

    resetRenderMods();

    if (state.spawnMode === "trigger" && nowMs >= state.triggerUntilMs) {
      out.densityMul = 0;
    }

    if (!state.alertsEnabled) return out;

    // HEARTBEAT
    const hb = layers.heartbeat.active;
    if (hb) {
      const tt = clamp01((nowMs - hb.startMs) / hb.durationMs);
      const size = computeHeartbeatSizeMul(tt, hb.durationMs);
      out.sizeMul *= size;
      out.scaleMul *= size;
      out.densityMul *= PRESETS.heartbeat.densityMul;
      out.speedMul *= PRESETS.heartbeat.speedMul;
    }

    // GLOW
    const gl = layers.glow.active;
    if (gl) {
      const tt = clamp01((nowMs - gl.startMs) / gl.durationMs);
      const e = envAD(tt, gl.preset.attack, gl.preset.decay);
      lastRenderMods.glowAlpha = e * gl.preset.alphaMax;
      lastRenderMods.glowBlur = e * gl.preset.blurMaxPx;
      out.glow = e * gl.preset.strength;
    }

    // ADDITIVE
    const ad = layers.additive.active;
    if (ad) {
      const tt = clamp01((nowMs - ad.startMs) / ad.durationMs);
      const e = envAD(tt, ad.preset.attack, ad.preset.decay);
      lastRenderMods.additiveAlpha = e * ad.preset.alphaAmp;
      out.additive = lastRenderMods.additiveAlpha;
    }

    // WOBBLE
    const wo = layers.wobble.active;
    if (wo) {
      const tt = clamp01((nowMs - wo.startMs) / wo.durationMs);
      const e = envAD(tt, wo.preset.attack, wo.preset.decay);
      const tSec = (tt * wo.durationMs) / 1000;
      lastRenderMods.wobbleAngle = Math.sin(tSec * wo.preset.freqHz * Math.PI * 2) * wo.preset.angleRad * e;
      out.wobble = lastRenderMods.wobbleAngle;
    }

    // COLORSHIFT
    const cs = layers.colorShift.active;
    if (cs) {
      const tt = clamp01((nowMs - cs.startMs) / cs.durationMs);
      const e = envAD(tt, cs.preset.attack, cs.preset.decay);
      const cyc = Math.sin(tt * cs.preset.cycles * Math.PI * 2);
      lastRenderMods.hueShift = cyc * e;
      out.hueShift = lastRenderMods.hueShift;
    }

    // SCALEWAVE
    const sw = layers.scaleWave.active;
    if (sw) {
      const tt = clamp01((nowMs - sw.startMs) / sw.durationMs);
      const e = envAD(tt, sw.preset.attack, sw.preset.decay);
      const tSec = (tt * sw.durationMs) / 1000;
      lastRenderMods.scaleWave = Math.sin(tSec * sw.preset.freqHz * Math.PI * 2) * sw.preset.amp * e;
      out.scaleMul *= (1 + lastRenderMods.scaleWave);
      out.sizeMul *= (1 + lastRenderMods.scaleWave);
    }

    // BURST
    const bu = layers.burst.active;
    if (bu) {
      const tt = clamp01((nowMs - bu.startMs) / bu.durationMs);
      const e = envAD(tt, bu.preset.attack, bu.preset.decay);
      lastRenderMods.burstBoost = e;
      out.densityMul *= bu.preset.densityMul;
      out.speedMul *= bu.preset.speedMul;
      out.burst = e;
    }

    return out;
  }

  function persistUIBridge(data) {
    try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(data)); } catch {}
  }

  function loadUIBridge() {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function applyUIBridgeData(d) {
    if (!d || typeof d !== "object") return;

    if (typeof d.alertsEnabled === "boolean") state.alertsEnabled = d.alertsEnabled;
    if (typeof d.alertHub === "number") state.alertHub = d.alertHub;

    if (d.effectsByAlert && typeof d.effectsByAlert === "object") {
      for (const k of ALERT_KEYS) {
        const v = d.effectsByAlert[k];
        if (typeof v === "number") state.effectsByAlert[k] = v;
      }
    }

    if (typeof d.spawnMode === "string") {
      state.spawnMode = (d.spawnMode === "trigger") ? "trigger" : "continuous";
      state.triggerUntilMs = 0;
    }

    if (typeof d.triggerWindowMs === "number" && Number.isFinite(d.triggerWindowMs) && d.triggerWindowMs > 0) {
      state.triggerWindowMs = d.triggerWindowMs;
    }

    syncHubConnection();
  }

  function initUIBridge() {
    const saved = loadUIBridge();
    if (saved) applyUIBridgeData(saved);

    try {
      const bc = new BroadcastChannel(UI_CHANNEL);

      bc.onmessage = (ev) => {
        const d = ev?.data;
        if (!d || typeof d !== "object") return;

        if (d.type === "alerts") {
          applyUIBridgeData(d.payload);
          persistUIBridge(d.payload);
          log("[UI] Bridge payload applied");
        }
      };
    } catch (e) {
      warn("[UI] BroadcastChannel not available:", e);
    }
  }

  function wsClose() {
    try { state.ws?.close?.(); } catch {}
    state.ws = null;
    state.wsStatus = "idle";
  }

  function syncHubConnection() {
    if (!state.alertsEnabled) {
      wsClose();
      return;
    }
    if (state.alertHub === HUB.OFF) {
      wsClose();
      return;
    }
  }

  function bindLoop() {
    if (!window.VDAY || !window.VDAY.rive || bound) {
      requestAnimationFrame(bindLoop);
      return;
    }

    try {
      const rive = window.VDAY.rive;
      const root = rive.viewModelInstance;
      if (!root) {
        requestAnimationFrame(bindLoop);
        return;
      }

      mainVM = root.viewModel("Main") || null;
      alertsContainerVM = root.viewModel("Alerts") || null;

      bound = true;
      state.riveStatus = "bound";
      state.riveDetails = "OK";
      log("[RIVE] Bound");
    } catch (e) {
      state.riveStatus = "error";
      state.riveDetails = String(e?.message || e);
      warn("[RIVE] Bind failed:", e);
    }

    requestAnimationFrame(bindLoop);
  }
  
  function onMessageFromHub(j) {
    if (!j) return;

    const name = String(j?.type || j?.name || "").toLowerCase();
    let alertName = null;

    if (name.includes("follow")) alertName = "follow";
    else if (name.includes("raid")) alertName = "raid";
    else if (name.includes("cheer")) alertName = "cheer";
    else if (name.includes("sub")) {
      if (name.includes("giftbomb") || name.includes("bulk")) alertName = "giftbomb";
      else if (name.includes("giftsub") || name.includes("gifts")) alertName = "giftsub";
      else if (name.includes("resub")) alertName = "resub";
      else alertName = "sub";
    }

    if (alertName) dispatch(alertName, j?.data || j);
  }
  
  function dispatch(alertName, payload) {
    state.lastEvent = String(alertName);
    state.lastEventAt = Date.now();

    if (!state.alertsEnabled) {
      log("[DISPATCH] Ignored (alerts disabled):", alertName);
      return;
    }

    const effId = Number(state.effectsByAlert[String(alertName).toLowerCase()] ?? EFFECT.OFF);
    
    if (effId === EFFECT.OFF) {
      log("[DISPATCH] Ignored (effect OFF):", alertName);
      return;
    }

    let effectKey = ID_TO_KEY[effId];
    if (effId === EFFECT.RANDOM || !effectKey) {
      effectKey = pickRandomEffect();
    }

    const nowMs = performance.now();
    activateTriggerWindow(nowMs);

    enqueueEffect(effectKey, nowMs);
    log("[DISPATCH]", alertName, "->", effectKey, `(ID:${effId})`, payload || "");
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "F8") {
      DEBUG = !DEBUG;
      log("[KEY] DEBUG:", DEBUG);
      return;
    }
    
    const numpadMap = {
      "Numpad1": "heartbeat",
      "Numpad2": "glow",
      "Numpad3": "wobble",
      "Numpad4": "additive",
      "Numpad5": "colorShift",
      "Numpad6": "scaleWave",
      "Numpad7": "burst",
      "Numpad8": "random",
    };

    if (numpadMap[e.code]) {
      const key = numpadMap[e.code] === "random" ? pickRandomEffect() : numpadMap[e.code];
      enqueueEffect(key, performance.now());
      log("[KEY] Test effect:", key);
      return;
    }

    if (e.code === "F7") {
      state.spawnMode = (state.spawnMode === "trigger") ? "continuous" : "trigger";
      state.triggerUntilMs = 0;
      log("[KEY] spawnMode =", state.spawnMode);
      return;
    }
  });
  
  window.__vdayAlerts = {
    getMultipliers,
    
    dispatch: (alertName, payload) => dispatch(alertName, payload),
    setEnabled: (v) => { 
      state.alertsEnabled = !!v; 
      syncHubConnection();
    },
    isEnabled: () => state.alertsEnabled,

    setSpawnMode: (mode) => {
      state.spawnMode = (mode === "trigger") ? "trigger" : "continuous";
      state.triggerUntilMs = 0;
      log("[ALERTS] spawnMode =", state.spawnMode);
    },
    setTriggerWindowMs: (ms) => {
      const v = Number(ms);
      if (Number.isFinite(v) && v > 0) {
        state.triggerWindowMs = v;
        log("[ALERTS] triggerWindowMs =", v);
      }
    },
    
    connectHub: () => syncHubConnection(),
    disconnectHub: () => wsClose(),
    
    setDebug: (v) => { 
      DEBUG = !!v; 
      log("[ALERTS] DEBUG =", DEBUG);
    },
    
    triggerEffect: (key) => enqueueEffect(key, performance.now()),

    _debug: () => ({
      state: { ...state },
      layers: Object.fromEntries(Object.keys(layers).map(k => [k, {
        queue: layers[k].queue.length,
        active: !!layers[k].active
      }])),
      mods: { ...lastRenderMods }
    })
  };


  requestAnimationFrame(bindLoop);
  initUIBridge();

  log("[INIT] Overlay Alerts cleaned");
})();
