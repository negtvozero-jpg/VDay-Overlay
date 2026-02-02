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
    SPAWN_ONLY: 9,
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

  const ALERT_KEYS = ["follow","sub","resub","giftsub","giftbomb","cheer","raid","tip"];
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

  const MAX_QUEUE = {
    heartbeat: 12,
    glow: 10,
    additive: 14,
    wobble: 14,
    colorShift: 10,
    scaleWave: 12,
    burst: 8,
  };

  const OVERFLOW_POLICY = "drop_oldest";

  let DEBUG = false;
  let __loggedNoRootVM = false;
  let __wsMsgLogCount_SB = 0;
  let __wsMsgLogCount_FB = 0;
  const __wsMsgLogLimit = 5;

  const state = {
    alertsEnabled: true,
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
      tip: EFFECT.OFF,
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

  let lastFrameMs = 0;
  let lastRenderMods = {
    additiveAlphaMul: 1,
    wobbleRad: 0,
    hueRotateDeg: 0,
    densityMul: 1,
    speedMul: 1,
    sizeMul: 1,
    scaleMul: 1,
    glowActive: false,
    glowAlpha: 0,
    glowBlurPx: 0,
  };

  function log(...a) { if (DEBUG) debug.log("[ALERTS]", ...a); }
  function warn(...a) { debug.log("[ALERTS]", ...a); }
  
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  
  function easeOutCubic(t) {
    const u = 1 - t;
    return 1 - u * u * u;
  }

  function pulseAD(t, attack, decay) {
    if (t < 0) return 0;
    const a = 1 - Math.exp(-t / Math.max(attack, 1e-6));
    const d = Math.exp(-t / Math.max(decay, 1e-6));
    return a * d;
  }

  function hubLabel(h) {
    if (h === HUB.STREAMERBOT) return "streamerbot";
    if (h === HUB.FIREBOT) return "firebot";
    return "off";
  }

  function pickRandomEffect() {
    const pool = ["heartbeat", "glow", "burst", "additive", "wobble", "colorShift", "scaleWave"];
    return pool[(Math.random() * pool.length) | 0] || "heartbeat";
  }

  function makeLayer(key) {
    return {
      key,
      preset: PRESETS[key],
      queue: [],
      active: null,
    };
  }

  const layers = {
    heartbeat: makeLayer("heartbeat"),
    glow: makeLayer("glow"),
    additive: makeLayer("additive"),
    wobble: makeLayer("wobble"),
    colorShift: makeLayer("colorShift"),
    scaleWave: makeLayer("scaleWave"),
    burst: makeLayer("burst"),
  };

  function layerCap(key) { return MAX_QUEUE[key] ?? 10; }

  function applyOverflow(queue, cap) {
    while (queue.length > cap) {
      if (OVERFLOW_POLICY === "drop_new") queue.pop();
      else queue.shift();
    }
  }

  function enqueueEffect(effectKey, nowMs) {
    if (!state.alertsEnabled) return;
    if (!state.effectsByAlert || Object.values(state.effectsByAlert).every(v => v === EFFECT.OFF)) {
      return;
    }
    
    const layer = layers[effectKey];
    if (!layer) return;

    layer.queue.push({ createdAt: nowMs });
    applyOverflow(layer.queue, layerCap(effectKey));
    log("[EFFECT] enqueued:", effectKey);
  }

  function startNextIfIdle(layer, nowMs) {
    if (layer.active) return;
    if (layer.queue.length === 0) return;

    layer.queue.shift();

    let durationMs = 1000;
    if (layer.key === "heartbeat") {
      durationMs = PRESETS.heartbeat.durationMs;
    } else {
      durationMs = Math.max(1, layer.preset?.durationMs || 1000);
    }

    let tailFactor = 0;
    if (layer.key !== "heartbeat") {
      const d = layer.preset?.decay || 0;
      tailFactor = Math.min(1.6, d * 3);
    }

    layer.active = {
      startMs: nowMs,
      endMs: nowMs + durationMs * (1 + tailFactor),
      durationMs,
    };
  }

  function tickLayer(layer, nowMs) {
    if (layer.active && nowMs >= layer.active.endMs) layer.active = null;
    startNextIfIdle(layer, nowMs);
  }

  function computeHeartbeatSizeMul(tt, durationMs) {
    const preset = PRESETS.heartbeat;
    const ramp = easeOutCubic(Math.min(1, tt / 0.15));
    const decay = 1 - tt;
    const env = ramp * decay;
    const phase = 2 * Math.PI * preset.beatsPerSecond * (tt * (durationMs / 1000));
    const pulse = Math.max(0, Math.sin(phase));
    return 1 + (preset.pulseStrength * env * pulse);
  }

  
  function __toNum(v) {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v.trim());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function syncFromConfig() {
    const C = window.VDAY && window.VDAY.config;
    if (!C) return;

    if (typeof C.alertsEnabled === "boolean") state.alertsEnabled = C.alertsEnabled;

    if (typeof C.spawnMode === "string") {
      const m = C.spawnMode.trim().toLowerCase();
      state.spawnMode = (m === "trigger") ? "trigger" : "continuous";
    }

    const tw = __toNum(C.triggerWindowMs);
    if (tw != null && tw > 0) state.triggerWindowMs = tw;

    const map = {
      follow: "followEffect",
      sub: "subEffect",
      resub: "resubEffect",
      giftsub: "giftsubEffect",
      giftbomb: "giftbombEffect",
      cheer: "cheerEffect",
      raid: "raidEffect",
      tip: "tipEffect"
    };

    for (const k in map) {
      const v = __toNum(C[map[k]]);
      if (v != null) state.effectsByAlert[k] = v;
    }
  }
function resetRenderMods() {
    lastRenderMods.additiveAlphaMul = 1;
    lastRenderMods.wobbleRad = 0;
    lastRenderMods.hueRotateDeg = 0;
    lastRenderMods.glowActive = false;
    lastRenderMods.glowAlpha = 0;
    lastRenderMods.glowBlurPx = 0;
  }

  function getMultipliers(nowMs) {
    syncFromConfig();
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
      out.glow = (size - 1) * 2; 
    }

    // BURST
    const b = layers.burst.active;
    if (b) {
      const tSec = (nowMs - b.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.burst.attack, PRESETS.burst.decay);
      out.densityMul *= (1 + (PRESETS.burst.densityMul - 1) * env);
      out.speedMul *= (1 + (PRESETS.burst.speedMul - 1) * env);
      out.burst = env;
    }

    // SCALE WAVE
    const sw = layers.scaleWave.active;
    if (sw) {
      const tSec = (nowMs - sw.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.scaleWave.attack, PRESETS.scaleWave.decay);
      const wave = Math.sin(2 * Math.PI * PRESETS.scaleWave.freqHz * tSec);
      const size = 1 + (PRESETS.scaleWave.amp * env * wave);
      out.sizeMul *= size;
      out.scaleMul *= size;
    }

    // ADDITIVE
    const ad = layers.additive.active;
    if (ad) {
      const tSec = (nowMs - ad.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.additive.attack, PRESETS.additive.decay);
      lastRenderMods.additiveAlphaMul = 1 + (PRESETS.additive.alphaAmp * env);
      out.additive = env;
    }

    // WOBBLE
    const wb = layers.wobble.active;
    if (wb) {
      const tSec = (nowMs - wb.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.wobble.attack, PRESETS.wobble.decay);
      const phase = 2 * Math.PI * PRESETS.wobble.freqHz * tSec;
      lastRenderMods.wobbleRad = PRESETS.wobble.angleRad * env * Math.sin(phase);
      out.wobble = lastRenderMods.wobbleRad;
    }

    // COLOR SHIFT
    const cs = layers.colorShift.active;
    if (cs) {
      const tSec = (nowMs - cs.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.colorShift.attack, PRESETS.colorShift.decay);
      const durSec = Math.max(0.001, cs.durationMs / 1000);
      const prog = clamp01(tSec / durSec);
      lastRenderMods.hueRotateDeg = 360 * PRESETS.colorShift.cycles * prog * env;
      out.hueShift = lastRenderMods.hueRotateDeg;
    }

    // GLOW
    const gl = layers.glow.active;
    if (gl) {
      const tSec = (nowMs - gl.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.glow.attack, PRESETS.glow.decay);
      lastRenderMods.glowActive = env > 0.001;
      lastRenderMods.glowAlpha = Math.min(1.75, 0.15 + 1.35 * env);
      lastRenderMods.glowBlurPx = Math.min(18, 2 + (PRESETS.glow.blurMaxPx * 1.6) * env);
      out.glow = env;
      out.alphaMul = 1 + 0.2 * env;
    }

    return out;
  }

  function installDrawWrapper() {
    if (!window.drawHeart || typeof window.drawHeart !== "function") return false;
    if (window.drawHeart.__vdayWrapped) return true;

    const original = window.drawHeart;

    function wrappedDrawHeart(ctx, p, render) {
      const m = lastRenderMods;
      const hasAny = (m.additiveAlphaMul !== 1) || 
                     (Math.abs(m.wobbleRad) > 1e-6) || 
                     (Math.abs(m.hueRotateDeg) > 0.5) || 
                     m.glowActive;

      if (!state.alertsEnabled || !hasAny) {
        return original(ctx, p, render);
      }

      ctx.save();
      const prevComp = ctx.globalCompositeOperation;
      const prevAlpha = ctx.globalAlpha;
      const prevFilter = ctx.filter;

      ctx.globalCompositeOperation = "lighter";

      if (Math.abs(m.hueRotateDeg) > 0.5) {
        try { ctx.filter = `hue-rotate(${m.hueRotateDeg}deg)`; } catch (_) {}
      }

      if (Math.abs(m.wobbleRad) > 1e-6) ctx.rotate(m.wobbleRad);

      original(ctx, p, render);

      try { ctx.filter = prevFilter; } catch (_) {}
      ctx.globalAlpha = prevAlpha;
      ctx.globalCompositeOperation = prevComp;
      ctx.restore();

      if (m.additiveAlphaMul > 1.001) {
        ctx.save();
        const prevCompA = ctx.globalCompositeOperation;
        const prevAlphaA = ctx.globalAlpha;
        const prevFilterA = ctx.filter;

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = prevAlphaA * m.additiveAlphaMul;

        if (Math.abs(m.hueRotateDeg) > 0.5) {
          try { ctx.filter = `hue-rotate(${m.hueRotateDeg}deg)`; } catch (_) {}
        }
        if (Math.abs(m.wobbleRad) > 1e-6) ctx.rotate(m.wobbleRad);

        ctx.scale(1.04, 1.04);
        original(ctx, p, render);

        try { ctx.filter = prevFilterA; } catch (_) {}
        ctx.globalAlpha = prevAlphaA;
        ctx.globalCompositeOperation = prevCompA;
        ctx.restore();
      }

      if (m.glowActive) {
        const alpha = m.glowAlpha;
        const blurPx = m.glowBlurPx;
        
        if (alpha > 0.001 && blurPx > 0.001) {
          ctx.save();
          const prevComp2 = ctx.globalCompositeOperation;
          const prevAlpha2 = ctx.globalAlpha;
          const prevFilter2 = ctx.filter;
          const prevShadowBlur = ctx.shadowBlur;
          const prevShadowColor = ctx.shadowColor;

          ctx.globalCompositeOperation = "lighter";


          let usedFilter = false;
          try {
            if (typeof ctx.filter === "string") {
              ctx.filter = `blur(${blurPx}px)`;
              usedFilter = true;
            }
          } catch (_) {}

          if (!usedFilter) {
            ctx.shadowBlur = blurPx * 2.0;
            ctx.shadowColor = "rgba(255,255,255,1)";
          }

          original(ctx, p, render);

          try { ctx.filter = prevFilter2; } catch (_) {}
          ctx.shadowBlur = prevShadowBlur;
          ctx.shadowColor = prevShadowColor;
          ctx.globalAlpha = prevAlpha2;
          ctx.globalCompositeOperation = prevComp2;
          ctx.restore();
        }
      }
    }

    wrappedDrawHeart.__vdayWrapped = true;
    window.drawHeart = wrappedDrawHeart;
    log("[DRAW] Wrapper installed");
    return true;
  }

  let __wrapTries = 0;
  const __wrapIv = setInterval(() => {
    __wrapTries++;
    if (installDrawWrapper() || __wrapTries >= 300) { // 5s timeout
      if (__wrapTries >= 300) warn("[DRAW] Failed to wrap drawHeart after 5s");
      clearInterval(__wrapIv);
    }
  }, 16);

  function tryGetRootVM() {
    if (window.__VDayRootVM) return window.__VDayRootVM;
    const ri = window.riveInstance || window.__riveInstance;
    if (ri && ri.viewModelInstance) return ri.viewModelInstance;
    return null;
  }

  function pickMainVM(rootVM) {
    try {
      if (rootVM && typeof rootVM.boolean === "function" && rootVM.boolean("alertsEnabled")) return rootVM;
    } catch {}
    try {
      const m = rootVM?.viewModel?.("Main");
      if (m) return m;
    } catch {}
    return null;
  }

  function safeNum(vm, name) {
    try { return Number(vm.number(name).value); } catch { return null; }
  }

  function safeVM(vm, name) {
    try { return vm.viewModel(name); } catch { return null; }
  }

  function observe(prop, cb, label) {
    if (!prop) return false;
    try {
      if (typeof prop.on === "function") {
        prop.on(cb);
        log(`[RIVE] Observing: ${label}`);
        return true;
      }
    } catch (e) {
      warn(`[RIVE] Observe failed for ${label}`, e);
    }
    return false;
  }

  function bindRive() {
    const rootVM = tryGetRootVM();
    if (!rootVM) {
      state.riveStatus = "waiting";
      state.riveDetails = "no global RootVM (need __VDayRootVM or riveInstance)";
      
      if (!__loggedNoRootVM) { 
        __loggedNoRootVM = true; 
        log("[RIVE] waiting: no global root VM yet"); 
      }
      return false;
    }

    const m = pickMainVM(rootVM);
    if (!m) {
      state.riveStatus = "failed";
      state.riveDetails = "Main VM not found";
      
      warn("[RIVE] found rootVM but could not locate Main/alertsEnabled");
      return false;
    }

    mainVM = m;

    const pAlertsEnabled = (() => { try { return mainVM.boolean("alertsEnabled"); } catch { return null; }})();
    const pAlertHub = (() => { try { return mainVM.number("alertHub"); } catch { return null; }})();

    if (!pAlertsEnabled || !pAlertHub) {
      state.riveStatus = "failed";
      state.riveDetails = "missing alertsEnabled/alertHub";
      
      warn("[RIVE] missing required props on Main VM");
      return false;
    }

    alertsContainerVM = safeVM(mainVM, "propertyOfAlertInstances") || 
                       safeVM(mainVM, "AlertInstances") || 
                       safeVM(mainVM, "alerts");

    state.alertsEnabled = !!pAlertsEnabled.value;
    state.alertHub = Number(pAlertHub.value) || 0;

    if (alertsContainerVM) {
      for (const n of ALERT_KEYS) {
        const a = safeVM(alertsContainerVM, n);
        const eff = a ? safeNum(a, "effectId") : null;
        if (eff != null && Number.isFinite(eff)) {
          state.effectsByAlert[n] = eff;
        }
      }
    }

    observe(pAlertsEnabled, () => {
      state.alertsEnabled = !!pAlertsEnabled.value;
      log("[RIVE] alertsEnabled ->", state.alertsEnabled);
      syncHubConnection();
      
    }, "alertsEnabled");

    observe(pAlertHub, () => {
      state.alertHub = Number(pAlertHub.value) || 0;
      log("[RIVE] alertHub ->", state.alertHub);
      syncHubConnection();
      
    }, "alertHub");

    if (alertsContainerVM) {
      for (const n of ALERT_KEYS) {
        const a = safeVM(alertsContainerVM, n);
        if (!a) continue;
        let pEff = null;
        try { pEff = a.number("effectId"); } catch {}
        if (!pEff) continue;
        observe(pEff, () => {
          state.effectsByAlert[n] = Number(pEff.value) || 0;
          log(`[RIVE] ${n}.effectId ->`, state.effectsByAlert[n]);
          
        }, `${n}.effectId`);
      }
    }

    bound = true;
    state.riveStatus = "bound";
    state.riveDetails = alertsContainerVM ? "full" : "partial (no alert instances)";
    

    log("[RIVE] Bound OK", {
      alertsEnabled: state.alertsEnabled,
      alertHub: state.alertHub,
      effects: { ...state.effectsByAlert },
    });

    syncHubConnection();
    return true;
  }

  function bindLoop() {
    if (bound) return;
    bindRive();
    if (!bound) requestAnimationFrame(bindLoop);
  }

  function applyUIConfig(payload, sourceLabel) {
    if (!payload || typeof payload !== "object") return;

    let touched = false;

    if (Object.prototype.hasOwnProperty.call(payload, "alertsEnabled")) {
      state.alertsEnabled = !!payload.alertsEnabled;
      touched = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "alertHub")) {
      const hubNum = Number(payload.alertHub);
      if (!Number.isNaN(hubNum)) {
        state.alertHub = hubNum;
        touched = true;
      }
    }

    const alertsObj = (payload.alerts && typeof payload.alerts === "object") ? payload.alerts : null;
    if (alertsObj) {
      for (const k of ALERT_KEYS) {
        const entry = alertsObj[k];
        if (entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "effectId")) {
          const v = Number(entry.effectId);
          if (!Number.isNaN(v)) {
            state.effectsByAlert[k] = v;
            touched = true;
          }
        } else if (Object.prototype.hasOwnProperty.call(alertsObj, k) && typeof alertsObj[k] === "number") {
          const v = Number(alertsObj[k]);
          if (!Number.isNaN(v)) {
            state.effectsByAlert[k] = v;
            touched = true;
          }
        }
      }
    }

    if (!touched) return;

    state.riveStatus = "ui-bridge";
    state.riveDetails = sourceLabel || "ui";
    
    log("[UI] Applied config", {
      alertsEnabled: state.alertsEnabled,
      alertHub: state.alertHub,
      effects: { ...state.effectsByAlert },
      source: sourceLabel,
    });

    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({
        alertsEnabled: state.alertsEnabled,
        alertHub: state.alertHub,
        alerts: Object.fromEntries(ALERT_KEYS.map(k => [k, { effectId: state.effectsByAlert[k] }]))
      }));
    } catch {}

    syncHubConnection();
  }

  function initUIBridge() {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY);
      if (raw) applyUIConfig(JSON.parse(raw), "localStorage");
    } catch {}

    try {
      if (typeof BroadcastChannel !== "function") {
        warn("[UI] BroadcastChannel not available");
        return;
      }
      const bc = new BroadcastChannel(UI_CHANNEL);
      bc.onmessage = (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type !== "config") return;
        applyUIConfig(msg.payload, "BroadcastChannel");
      };
      log("[UI] Bridge ready on channel:", UI_CHANNEL);
    } catch (e) {
      warn("[UI] Bridge init failed", e);
    }
  }

  function wsClose() {
    if (state.ws) {
      try { 
        state.ws.onopen = null; 
        state.ws.onmessage = null; 
        state.ws.onerror = null; 
        state.ws.onclose = null; 
      } catch {}
      try { state.ws.close(); } catch {}
    }
    state.ws = null;
    state.wsHub = HUB.OFF;
    state.wsStatus = "closed";
    
  }

  function syncHubConnection() {
    if (!state.alertsEnabled || state.alertHub === HUB.OFF) {
      if (state.ws) {
        log("[WS] Disconnecting (alerts OFF)");
        wsClose();
      } else {
        state.wsStatus = "idle";
        state.wsHub = HUB.OFF;
        
      }
      return;
    }

    if (state.ws && state.wsHub === state.alertHub && state.wsStatus === "open") return;

    wsClose();

    if (state.alertHub === HUB.STREAMERBOT) connectStreamerBot();
    else if (state.alertHub === HUB.FIREBOT) connectFirebot();
  }

  function connectStreamerBot() {
    const url = "ws://127.0.0.1:8080";
    state.wsStatus = "connecting";
    state.wsHub = HUB.STREAMERBOT;
    
    log("[WS][SB] Connecting to", url);

    let ws;
    try { ws = new WebSocket(url); } catch (e) {
      state.wsStatus = "error";
      state.lastError = String(e?.message || e);
      
      warn("[WS][SB] Connection failed", e);
      return;
    }
    state.ws = ws;

    ws.onopen = () => {
      state.wsStatus = "open";
      
      log("[WS][SB] Connected");
      
      const subMsg = {
        request: "Subscribe",
        id: "vday-sub-1",
        events: {
          Twitch: ["Follow", "Sub", "ReSub", "GiftSub", "GiftBomb", "Cheer", "Raid"],
        },
      };
      
      try {
        ws.send(JSON.stringify(subMsg));
        log("[WS][SB] Subscribed to events");
      } catch (e) {
        state.lastError = String(e?.message || e);
        
      }
    };

    ws.onerror = (ev) => {
      state.wsStatus = "error";
      state.lastError = "WebSocket error";
      
      warn("[WS][SB] Error", ev);
    };

    ws.onclose = (ev) => {
      state.wsStatus = "closed";
      
      log("[WS][SB] Closed", ev?.code);
    };

    ws.onmessage = (msg) => {
      const raw = msg?.data;
      if (!raw) return;
      
      if (__wsMsgLogCount_SB < __wsMsgLogLimit) { 
        __wsMsgLogCount_SB++; 
        log("[WS][SB] Message:", raw.substring(0, 200)); 
      }

      let j;
      try { j = JSON.parse(raw); } catch { return; }

      const src = j?.event?.source;
      const typ = j?.event?.type;
      if (src !== "Twitch" || !typ) return;

      const map = {
        Follow: "follow",
        Sub: "sub",
        ReSub: "resub",
        GiftSub: "giftsub",
        GiftBomb: "giftbomb",
        Cheer: "cheer",
        Raid: "raid",
      };

      const alertName = map[typ];
      if (alertName) dispatch(alertName, j?.data || {});
    };
  }

  function connectFirebot() {
    const url = "ws://127.0.0.1:7472";
    state.wsStatus = "connecting";
    state.wsHub = HUB.FIREBOT;
    
    log("[WS][FB] Connecting to", url);

    let ws;
    try { ws = new WebSocket(url); } catch (e) {
      state.wsStatus = "error";
      state.lastError = String(e?.message || e);
      
      return;
    }
    state.ws = ws;

    ws.onopen = () => {
      state.wsStatus = "open";
      
      log("[WS][FB] Connected");
      
      const subMsg = { type: "invoke", id: 0, name: "subscribe-events", data: [] };
      try {
        ws.send(JSON.stringify(subMsg));
      } catch (e) {
        state.lastError = String(e?.message || e);
        
      }
    };

    ws.onerror = () => {
      state.wsStatus = "error";
      state.lastError = "WebSocket error";
      
    };

    ws.onclose = () => {
      state.wsStatus = "closed";
      
    };

    ws.onmessage = (msg) => {
      const raw = msg?.data;
      if (!raw) return;
      
      if (__wsMsgLogCount_FB < __wsMsgLogLimit) { 
        __wsMsgLogCount_FB++; 
        log("[WS][FB] Message:", raw.substring(0, 200)); 
      }

      let j;
      try { j = JSON.parse(raw); } catch { return; }

      const name = String(j?.name || j?.event || j?.type || "").toLowerCase();
      let alertName = null;
      
      if (name.includes("follow")) alertName = "follow";
      else if (name.includes("resub")) alertName = "resub";
      else if (name.includes("sub")) alertName = "sub";
      else if (name.includes("cheer") || name.includes("bits")) alertName = "cheer";
      else if (name.includes("raid")) alertName = "raid";
      else if (name.includes("giftbomb") || name.includes("massgift")) alertName = "giftbomb";
      else if (name.includes("giftsub") || name.includes("gifts")) alertName = "giftsub";

      if (alertName) dispatch(alertName, j?.data || j);
    };
  }

  function dispatch(alertName, payload) {
    syncFromConfig();
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

    const nowMs = performance.now();
    activateTriggerWindow(nowMs);

    if (effId === EFFECT.SPAWN_ONLY) {
      log("[DISPATCH]", alertName, "->", "spawnOnly", `(ID:${effId})`);
      return;
    }

    let effectKey = ID_TO_KEY[effId];
    if (effId === EFFECT.RANDOM || !effectKey) {
      effectKey = pickRandomEffect();
    }

    enqueueEffect(effectKey, nowMs);
    log("[DISPATCH]", alertName, "->", effectKey, `(ID:${effId})`);
  }


  window.addEventListener("keydown", (e) => {
    if (e.code === "F8") {
      state.alertsEnabled = !state.alertsEnabled;
      log("[KEY] Toggle alerts:", state.alertsEnabled);
      syncHubConnection();
      
      return;
    }

    if (e.code === "F9") {
      dispatch("follow", { test: true });
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
    syncFromConfig,

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
  

  log("[INIT] Overlay Alerts Unified v2.0 started");
})();
