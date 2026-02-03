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
  const STATUS_CHANNEL = "vday-alerts-status";


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
      blurMaxPx: 150,
      strength: 20,
      lightenHoldRatio: 0.5,
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
      decay: 0.55,
      cycles: 7,
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
  const __wsMsgLogLimit = 25;

  const state = {
    alertsEnabled: true,
    spawnMode: "continuous",
    triggerUntilMs: 0,
    triggerWindowMs: 6000,

    commandEnabled: false,
    commandTriggerWindowMs: 6000,

    redeemEnabled: false,
    redeemTriggerWindowMs: 6000,

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
      command: EFFECT.OFF,
      redeem: EFFECT.OFF,
    },

    ws: null,
    wsHub: HUB.OFF,
    wsStatus: "idle",
    wsRetryAt: 0,
    wsRetryDelayMs: 700,
    lastError: "",
    lastEvent: "",
    lastEventAt: 0,

    riveStatus: "waiting",
    riveDetails: "",
  };

  function anySourceEnabled() {
    return !!(state.alertsEnabled || state.commandEnabled || state.redeemEnabled);
  }

  function isAnyTriggerMode() {
    return state.spawnMode === "trigger";
  }

  function activateTriggerWindow(nowMs, source, extraMs) {
    if (state.spawnMode !== "trigger") return;

    let dur = state.triggerWindowMs;
    if (source === "command") dur = state.commandTriggerWindowMs;
    else if (source === "redeem") dur = state.redeemTriggerWindowMs;

    const useMs = Number.isFinite(extraMs) ? extraMs : dur;
    const until = nowMs + Math.max(0, useMs);
    if (until > state.triggerUntilMs) state.triggerUntilMs = until;
  }

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
    glowLightenAlpha: 0,
  };

  function log(...a) { if (DEBUG) { console.log("[ALERTS]", ...a); try { debug.log("[ALERTS]", ...a); } catch {} } }
  function warn(...a) { console.warn("[ALERTS]", ...a); try { debug.log("[ALERTS]", ...a); } catch {} }


  let __statusBC = null;
  function postStatus(extra) {
    try {
      if (typeof BroadcastChannel !== "function") return;
      if (!__statusBC) __statusBC = new BroadcastChannel(STATUS_CHANNEL);
      __statusBC.postMessage({
        type: "status",
        payload: {
          alertsEnabled: state.alertsEnabled,
          alertHub: state.alertHub,
          wsStatus: state.wsStatus,
          lastEvent: state.lastEvent,
          lastError: state.lastError,
          at: Date.now(),
          extra: extra || ""
        }
      });
    } catch {}
  }

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

  function enqueueEffect(effectKey, nowMs, bypassAlertsEnabled) {
    if (!bypassAlertsEnabled && !state.alertsEnabled) return;
    if (!state.effectsByAlert || Object.values(state.effectsByAlert).every(v => v === EFFECT.OFF)) return;

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

    if (typeof C.isTrigger === "boolean") {
      state.spawnMode = C.isTrigger ? "trigger" : "continuous";
    }

    const tw = __toNum(C.triggerWindowMs);
    if (tw != null && tw > 0) state.triggerWindowMs = tw;

    if (typeof C.commandEnabled === "boolean") state.commandEnabled = C.commandEnabled;
    if (typeof C.redeemEnabled === "boolean") state.redeemEnabled = C.redeemEnabled;

    const ctw = __toNum(C.commandTriggerWindowMs);
    if (ctw != null && ctw > 0) state.commandTriggerWindowMs = ctw;

    const rtw = __toNum(C.redeemTriggerWindowMs);
    if (rtw != null && rtw > 0) state.redeemTriggerWindowMs = rtw;

    const map = {
      follow: "followEffect",
      sub: "subEffect",
      resub: "resubEffect",
      giftsub: "giftsubEffect",
      giftbomb: "giftbombEffect",
      cheer: "cheerEffect",
      raid: "raidEffect",
      tip: "tipEffect",
      command: "commandEffect",
      redeem: "redeemEffect",
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
    lastRenderMods.glowLightenAlpha = 0;
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

    if (isAnyTriggerMode() && nowMs >= state.triggerUntilMs) {
      const hasActiveEffects = Object.values(layers).some(l => l.active || l.queue.length > 0);
      if (!hasActiveEffects) {
        out.densityMul = 0;
      }
    }

    if (!anySourceEnabled()) return out;

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

    const b = layers.burst.active;
    if (b) {
      const tSec = (nowMs - b.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.burst.attack, PRESETS.burst.decay);
      out.densityMul *= (1 + (PRESETS.burst.densityMul - 1) * env);
      out.speedMul *= (1 + (PRESETS.burst.speedMul - 1) * env);
      out.burst = env;
    }

    const sw = layers.scaleWave.active;
    if (sw) {
      const tSec = (nowMs - sw.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.scaleWave.attack, PRESETS.scaleWave.decay);
      const wave = Math.sin(2 * Math.PI * PRESETS.scaleWave.freqHz * tSec);
      const size = 1 + (PRESETS.scaleWave.amp * env * wave);
      out.sizeMul *= size;
      out.scaleMul *= size;
    }

    const ad = layers.additive.active;
    if (ad) {
      const tSec = (nowMs - ad.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.additive.attack, PRESETS.additive.decay);
      lastRenderMods.additiveAlphaMul = 1 + (PRESETS.additive.alphaAmp * env);
      out.additive = env;
    }

    const wb = layers.wobble.active;
    if (wb) {
      const tSec = (nowMs - wb.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.wobble.attack, PRESETS.wobble.decay);
      const phase = 2 * Math.PI * PRESETS.wobble.freqHz * tSec;
      lastRenderMods.wobbleRad = PRESETS.wobble.angleRad * env * Math.sin(phase);
      out.wobble = lastRenderMods.wobbleRad;
    }

    const cs = layers.colorShift.active;
    if (cs) {
      const tSec = (nowMs - cs.startMs) / 1000;
      const env = pulseAD(tSec, PRESETS.colorShift.attack, PRESETS.colorShift.decay);
      const durSec = Math.max(0.001, cs.durationMs / 1000);
      const prog = clamp01(tSec / durSec);
      lastRenderMods.hueRotateDeg = 360 * PRESETS.colorShift.cycles * prog * env;
      out.hueShift = lastRenderMods.hueRotateDeg;
    }

    const gl = layers.glow.active;
    if (gl) {
      const tSec = (nowMs - gl.startMs) / 1000;
      const preset = PRESETS.glow;
      const env = pulseAD(tSec, preset.attack, preset.decay);
      
      lastRenderMods.glowActive = env > 0.001;
      lastRenderMods.glowAlpha = Math.min(1.75, 0.15 + 1.35 * env);
      lastRenderMods.glowBlurPx = Math.min(18, 2 + (preset.blurMaxPx * 1.6) * env);

      const holdRatio = preset.lightenHoldRatio ?? 0.5;
      const durSec = gl.durationMs / 1000;
      const progress = tSec / durSec;
      
      let lightenEnv;
      if (progress < holdRatio) {
        lightenEnv = 1;
      } else {
        const decayProgress = (progress - holdRatio) / (1 - holdRatio);
        lightenEnv = Math.exp(-decayProgress * 3); 
      }
      
      lastRenderMods.glowLightenAlpha = lightenEnv;
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

      if (!anySourceEnabled() || !hasAny) {
        return original(ctx, p, render);
      }

      const hasTransform = Math.abs(m.wobbleRad) > 1e-6 || Math.abs(m.hueRotateDeg) > 0.5;
      
      if (hasTransform) {
        ctx.save();
        const prevFilter = ctx.filter;
        
        if (Math.abs(m.hueRotateDeg) > 0.5) {
          try { ctx.filter = `hue-rotate(${m.hueRotateDeg}deg)`; } catch (_) {}
        }
        if (Math.abs(m.wobbleRad) > 1e-6) ctx.rotate(m.wobbleRad);
        
        original(ctx, p, render);
        
        try { ctx.filter = prevFilter; } catch (_) {}
        ctx.restore();
      } else {
        original(ctx, p, render);
      }

      if (m.additiveAlphaMul > 1.001) {
        ctx.save();
        const prevCompA = ctx.globalCompositeOperation;
        const prevAlphaA = ctx.globalAlpha;
        const prevFilterA = ctx.filter;

        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = prevAlphaA * clamp01(m.additiveAlphaMul - 1);

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
        const lightenAlpha = m.glowLightenAlpha;

        if (alpha > 0.001 && blurPx > 0.001) {
          
          ctx.save();
          const prevComp = ctx.globalCompositeOperation;
          const prevAlpha = ctx.globalAlpha;
          const prevFilter = ctx.filter;
          const prevShadowBlur = ctx.shadowBlur;
          const prevShadowColor = ctx.shadowColor;

          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = prevAlpha * clamp01(alpha * 0.6);

          let usedFilter = false;
          try {
            if (typeof ctx.filter === "string") {
              ctx.filter = `blur(${blurPx}px) brightness(1.3)`;
              usedFilter = true;
            }
          } catch (_) {}

          if (!usedFilter) {
            ctx.shadowBlur = blurPx * 1.5;
            ctx.shadowColor = "rgba(255,200,200,0.8)";
          }

          original(ctx, p, render);

          try { ctx.filter = prevFilter; } catch (_) {}
          ctx.shadowBlur = prevShadowBlur;
          ctx.shadowColor = prevShadowColor;
          ctx.globalAlpha = prevAlpha;
          ctx.globalCompositeOperation = prevComp;
          ctx.restore();

          if (lightenAlpha > 0.01) {
            ctx.save();
            const prevComp2 = ctx.globalCompositeOperation;
            const prevAlpha2 = ctx.globalAlpha;
            
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = prevAlpha2 * clamp01(lightenAlpha * 0.4); 
            ctx.scale(0.95, 0.95);
            
            original(ctx, p, render);
            
            ctx.globalAlpha = prevAlpha2;
            ctx.globalCompositeOperation = prevComp2;
            ctx.restore();
          }
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
    if (installDrawWrapper() || __wrapTries >= 300) {
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

    }, "alertsEnabled");

    observe(pAlertHub, () => {
      state.alertHub = Number(pAlertHub.value) || 0;
      log("[RIVE] alertHub ->", state.alertHub);

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


    return true;
  }

  function bindLoop() {
    if (bound) return;
    bindRive();
    if (!bound) requestAnimationFrame(bindLoop);
  }

  
  function initOverlayStatusBox() {
    const id = "vday-ws-mini";
    if (document.getElementById(id)) return;

    const el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.left = "10px";
    el.style.top = "10px";
    el.style.zIndex = "999999";
    el.style.padding = "8px 10px";
    el.style.borderRadius = "10px";
    el.style.border = "2px solid #7b1620";
    el.style.background = "rgba(247, 214, 220, 0.92)";
    el.style.color = "#7b1620";
    el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    el.style.fontSize = "12px";
    el.style.lineHeight = "1.15";
    el.style.pointerEvents = "none";
    el.style.userSelect = "none";

    const l1 = document.createElement("div");
    const l2 = document.createElement("div");
    l2.style.marginTop = "2px";
    el.appendChild(l1);
    el.appendChild(l2);

    document.body.appendChild(el);

    let bc = null;
    try { bc = (typeof BroadcastChannel === "function") ? new BroadcastChannel("vday-alerts-status") : null; } catch {}

    let lastSig = "";
    function hubLabel(h) {
      if (h === HUB.STREAMERBOT) return "Streamer.bot";
      if (h === HUB.FIREBOT) return "Firebot";
      return "Off";
    }

    function tick() {
      const wsLine = `WS: ${hubLabel(state.alertHub)} / ${state.wsStatus}`;
      const evLine = state.lastEvent ? `Last: ${state.lastEvent}` : "Last: -";
      const sig = wsLine + "|" + evLine + "|" + (state.lastError || "");
      if (sig !== lastSig) {
        lastSig = sig;
        l1.textContent = wsLine;
        l2.textContent = evLine;
        if (bc) {
          try {
            bc.postMessage({
              type: "status",
              payload: {
                wsStatus: state.wsStatus,
                wsHub: state.wsHub,
                alertHub: state.alertHub,
                lastEvent: state.lastEvent,
                lastError: state.lastError,
                lastEventAt: state.lastEventAt,
              }
            });
          } catch {}
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  
  function dispatch(alertName, payload) {
    syncFromConfig();
    const key = String(alertName).toLowerCase();
    state.lastEvent = String(alertName);
    state.lastEventAt = Date.now();

    const isCmd = key === "command";
    const isRed = key === "redeem";

    if (isCmd && !state.commandEnabled) return;
    if (isRed && !state.redeemEnabled) return;

    if (!isCmd && !isRed && !state.alertsEnabled) {
      log("[DISPATCH] Ignored (alerts disabled):", alertName);
      return;
    }

    const effId = Number(state.effectsByAlert[key] ?? EFFECT.OFF);
    const nowMs = performance.now();
    log("[DISPATCH] recv", { hub: state.alertHub, name: alertName, effId });

    if (isCmd) activateTriggerWindow(nowMs, "command");
    else if (isRed) activateTriggerWindow(nowMs, "redeem");
    else activateTriggerWindow(nowMs, "alerts");

    if (effId === EFFECT.OFF) {
      log("[DISPATCH] Ignored (effect OFF):", alertName);
      return;
    }

    if (effId === EFFECT.SPAWN_ONLY) {
      log("[DISPATCH]", alertName, "->", "spawnOnly", `(ID:${effId})`);
      return;
    }

    let effectKey = ID_TO_KEY[effId];
    if (effId === EFFECT.RANDOM || !effectKey) {
      effectKey = pickRandomEffect();
    }

    enqueueEffect(effectKey, nowMs, isCmd || isRed);
    log("[DISPATCH]", alertName, "->", effectKey, `(ID:${effId})`);
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "F8") {
      state.alertsEnabled = !state.alertsEnabled;
      log("[KEY] Toggle alerts:", state.alertsEnabled);

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
      enqueueEffect(key, performance.now(), false);
      log("[KEY] Test effect:", key);
    }
  });

  window.__vdayAlerts = {
    getMultipliers,
    dispatch: (alertName, payload) => dispatch(alertName, payload),
    setEnabled: (v) => {
      state.alertsEnabled = !!v;

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

    connectHub: () => {},
    disconnectHub: () => {},
    setDebug: (v) => { DEBUG = !!v; },
    triggerEffect: (key) => enqueueEffect(key, performance.now(), false),

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
  initMiniStatus();
  log("[INIT] Overlay Alerts started");
})();
(function () {
  window.__VDAY_SE_FIELDS = true;

  const debug = (window.debug && typeof window.debug.log === "function")
    ? window.debug
    : { log: function () {} };

  function hexToARGBInt(hex) {
    if (!hex) return null;
    let h = String(hex).trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 6) h = "ff" + h;
    if (h.length !== 8) return null;
    const n = parseInt(h, 16);
    return Number.isFinite(n) ? (n >>> 0) : null;
  }

  function isChecked(v) {
    if (v === true) return true;
    if (v === 1) return true;
    const s = (typeof v === "string") ? v.trim().toLowerCase() : "";
    return s === "1" || s === "true" || s === "on" || s === "yes";
  }

  function setNum(C, key, v) {
    const n = (typeof v === "string") ? Number(v.replace(",", ".")) : Number(v);
    if (Number.isFinite(n)) C[key] = n;
  }

  function setStr(C, key, v) {
    if (typeof v === "string") C[key] = v;
  }

  const PRIDE_KEYS = Array.from({ length: 32 }, (_, i) => `pride_${i}`);
  const TEX_KEYS = Array.from({ length: 32 }, (_, i) => `tex_${i}`);

  function buildMask(keys, f) {
    let m = 0;
    for (let i = 0; i < 32; i++) {
      if (isChecked(f[keys[i]])) m |= (1 << i);
    }
    return m >>> 0;
  }

  function applyAlertsFields(C, f) {
    C.followEffect = f.followEffect;
    C.subEffect = f.subEffect;
    C.resubEffect = f.resubEffect;
    C.giftsubEffect = f.giftsubEffect;
    C.giftbombEffect = f.giftbombEffect;
    C.cheerEffect = f.cheerEffect;
    C.raidEffect = f.raidEffect;
    C.tipEffect = f.tipEffect;
    C.commandEnabled = isChecked(f.commandEnabled);
    if (typeof f.commandText === "string") C.commandText = f.commandText;
    C.commandEffect = f.commandEffect;

    C.redeemEnabled = isChecked(f.redeemEnabled);
    if (typeof f.redeemName === "string") C.redeemName = f.redeemName;
    C.redeemEffect = f.redeemEffect;

    if (typeof f.commandSpawnMode === "string") {
      const mode = f.commandSpawnMode.trim().toLowerCase();
      C.commandSpawnMode = (mode === "trigger") ? "trigger" : "continuous";
    }
    if (f.commandTriggerWindowMs != null) {
      const ms = (typeof f.commandTriggerWindowMs === "string")
        ? Number(f.commandTriggerWindowMs.replace(",", "."))
        : Number(f.commandTriggerWindowMs);
      if (Number.isFinite(ms) && ms > 0) C.commandTriggerWindowMs = ms;
    }

    if (typeof f.redeemSpawnMode === "string") {
      const mode = f.redeemSpawnMode.trim().toLowerCase();
      C.redeemSpawnMode = (mode === "trigger") ? "trigger" : "continuous";
    }
    if (f.redeemTriggerWindowMs != null) {
      const ms = (typeof f.redeemTriggerWindowMs === "string")
        ? Number(f.redeemTriggerWindowMs.replace(",", "."))
        : Number(f.redeemTriggerWindowMs);
      if (Number.isFinite(ms) && ms > 0) C.redeemTriggerWindowMs = ms;
    }
    if (typeof f.spawnMode === "string") {
      const mode = f.spawnMode.trim().toLowerCase();
      C.spawnMode = (mode === "trigger") ? "trigger" : "continuous";
    }

    if (f.triggerWindowMs != null) {
      const ms = (typeof f.triggerWindowMs === "string")
        ? Number(f.triggerWindowMs.replace(",", "."))
        : Number(f.triggerWindowMs);
      if (Number.isFinite(ms) && ms > 0) C.triggerWindowMs = ms;
    }

    if (f.alertsEnabled != null) {
      C.alertsEnabled = isChecked(f.alertsEnabled);
    }

    const A = window.__vdayAlerts;

    if (!A) {
      window.__vdayPendingAlertsCfg = {
        spawnMode: C.spawnMode,
        triggerWindowMs: C.triggerWindowMs,
        alertsEnabled: C.alertsEnabled
      };
    }
    if (A) {
      if (typeof A.setSpawnMode === "function" && typeof C.spawnMode === "string") {
        A.setSpawnMode(C.spawnMode);
      }
      if (typeof A.setTriggerWindowMs === "function" && Number.isFinite(C.triggerWindowMs)) {
        A.setTriggerWindowMs(C.triggerWindowMs);
      }
      if (typeof A.setEnabled === "function" && typeof C.alertsEnabled === "boolean") {
        A.setEnabled(C.alertsEnabled);
      }
    }
  }

  function applyFieldData(f) {
    const C = window.VDAY && window.VDAY.config;
    if (!C || !f) return;

    setNum(C, "density", f.density);
    setNum(C, "speed", f.speed);
    setNum(C, "longevity", f.longevity);
    setNum(C, "maxParticles", f.maxParticles);
    setNum(C, "direction", f.direction);
    setNum(C, "sizeMin", f.sizeMin);
    setNum(C, "sizeMax", f.sizeMax);

    if (Number.isFinite(C.sizeMin) && Number.isFinite(C.sizeMax) && C.sizeMax < C.sizeMin) {
      C.sizeMax = C.sizeMin;
    }

    if (typeof f.primaryColor === "string" && f.primaryColor.trim()) {
      setStr(C, "colorHex", f.primaryColor.trim());
      const p = hexToARGBInt(f.primaryColor);
      if (p != null) C.heartColorARGB = p;
    }

    if (typeof f.secondaryColor === "string" && f.secondaryColor.trim()) {
      const s = hexToARGBInt(f.secondaryColor);
      if (s != null) C.heartColorSecondaryARGB = s;
    }

    C.prideValue = buildMask(PRIDE_KEYS, f);
    C.textureValue = buildMask(TEX_KEYS, f);

    C.isPride = (C.prideValue >>> 0) !== 0;
    C.isTexture = (C.textureValue >>> 0) !== 0;

    applyAlertsFields(C, f);

    if (typeof window.vdayRebuildTextures === "function") window.vdayRebuildTextures();
  }

  function onFields(e) {
    const f = (e && e.detail && e.detail.fieldData) ? e.detail.fieldData : {};
    requestAnimationFrame(() => applyFieldData(f));
  }
  function normStr(v) {
    return String(v ?? "").trim();
  }

  function normLower(v) {
    return normStr(v).toLowerCase();
  }

  function pickMessageText(detail) {
    const ev = (detail && detail.event) ? detail.event : {};
    return (
      ev.message ??
      ev.text ??
      (ev.data && (ev.data.message ?? ev.data.text ?? ev.data.msg ?? ev.data.content)) ??
      ""
    );
  }

  function pickRedeemName(detail) {
    const ev = (detail && detail.event) ? detail.event : {};
    return (
      ev.rewardName ??
      ev.reward_name ??
      ev.redemptionName ??
      ev.redemption_name ??
      ev.name ??
      (ev.data && (ev.data.rewardName ?? ev.data.reward_name ?? ev.data.name)) ??
      ""
    );
  }

  function mapSeEventToAlertKey(detail) {
    const listener = String(detail && detail.listener ? detail.listener : "").toLowerCase();
    const ev = (detail && detail.event) ? detail.event : {};
    const type = String(ev && ev.type ? ev.type : "").toLowerCase();

    if (listener.includes("follow") || listener.includes("follower")) return "follow";
    if (listener.includes("raid")) return "raid";
    if (listener.includes("cheer")) return "cheer";
    if (listener.includes("tip") || listener.includes("donation")) return "tip";

    if (listener.includes("subscriber")) {
      const isGift = !!(ev.gifted || ev.isGift || ev.gift || ev.is_gift);
      const bulk = !!(ev.bulkGifted || ev.bulk_gifted);
      const amount = Number(ev.amount ?? ev.count ?? ev.gifts ?? 0);

      if (bulk || (isGift && amount > 1)) return "giftbomb";
      if (isGift) return "giftsub";
      if (type.includes("resub") || Number(ev.months ?? ev.totalMonths ?? 0) > 1) return "resub";
      return "sub";
    }

    return null;
  }

  function onSeEvent(e) {
    const detail = (e && e.detail) ? e.detail : {};

    const C = window.VDAY && window.VDAY.config;
    const A = window.__vdayAlerts;
    if (!A || typeof A.dispatch !== "function") return;

    if (C && C.commandEnabled) {
      const cmd = normLower(C.commandText);
      if (cmd) {
        const msg = normLower(pickMessageText(detail));
        const tok = msg ? (msg.split(/\s+/)[0] || "") : "";
        if (tok === cmd) {
          debug.log("[VDAY][SE] dispatch", "command");
          A.dispatch("command", (detail && detail.event) ? detail.event : detail);
          return;
        }
      }
    }

    if (C && C.redeemEnabled) {
      const want = normLower(C.redeemName);
      if (want) {
        const got = normLower(pickRedeemName(detail));
        if (got === want) {
          debug.log("[VDAY][SE] dispatch", "redeem");
          A.dispatch("redeem", (detail && detail.event) ? detail.event : detail);
          return;
        }
      }
    }

    const key = mapSeEventToAlertKey(detail);
    if (!key) return;

    debug.log("[VDAY][SE] dispatch", key);
    A.dispatch(key, (detail && detail.event) ? detail.event : detail);
  }


  
  function tryApplyPendingAlertsCfg() {
    const A = window.__vdayAlerts;
    const P = window.__vdayPendingAlertsCfg;
    if (!A || !P) return;

    try {
      if (typeof A.setSpawnMode === "function" && typeof P.spawnMode === "string") A.setSpawnMode(P.spawnMode);
      if (typeof A.setTriggerWindowMs === "function" && Number.isFinite(P.triggerWindowMs)) A.setTriggerWindowMs(P.triggerWindowMs);
      if (typeof A.setEnabled === "function" && typeof P.alertsEnabled === "boolean") A.setEnabled(P.alertsEnabled);
      if (typeof A.syncFromConfig === "function") A.syncFromConfig();
    } catch {}
  }

  setInterval(tryApplyPendingAlertsCfg, 250);
window.addEventListener("onWidgetLoad", onFields);
  window.addEventListener("onWidgetUpdate", onFields);
  window.addEventListener("onEventReceived", onSeEvent);
})();