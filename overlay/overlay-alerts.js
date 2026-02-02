(() => {
  "use strict";

  const debug = (window.debug && typeof window.debug.log === "function")
    ? window.debug
    : { log() {} };

  const EFFECT = {
    OFF: 0,
    HEARTBEAT: 1,
    GLOW: 2,
    WOBBLE: 3,
    ADDITIVE: 4,
    COLORSHIFT: 5,
    SCALEWAVE: 6,
    BURST: 7,
    RANDOM: 8,
    SPAWN_ONLY: 9
  };

  const ID_TO_KEY = {
    1: "heartbeat",
    2: "glow",
    3: "wobble",
    4: "additive",
    5: "colorShift",
    6: "scaleWave",
    7: "burst"
  };

  const EFFECT_KEYS = ["heartbeat","glow","wobble","additive","colorShift","scaleWave","burst"];

  const PRESETS = {
    heartbeat: { dur: 1800, bps: 2.6, amp: 0.70, sizeBase: 0.15 },
    glow:      { dur: 2200, a: 0.06, d: 0.35, size: 0.22, speed: 0.06, density: 0.10 },
    wobble:    { dur: 1500, a: 0.04, d: 0.28, speed: 0.18, size: 0.06, hz: 3.0 },
    additive:  { dur: 1000, a: 0.04, d: 0.50, density: 0.35, speed: 0.08 },
    colorShift:{ dur: 2200, a: 0.03, d: 0.25, size: 0.12, speed: 0.05, cycles: 5 },
    scaleWave: { dur: 1100, a: 0.04, d: 0.28, amp: 0.50, hz: 5.5 },
    burst:     { dur:  900, a: 0.03, d: 0.18, density: 10.0, speed: 5.0, size: 1.15 }
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  const state = {
    alertsEnabled: true,
    spawnMode: "continuous",
    triggerWindowMs: 6000,
    triggerUntilMs: 0,
    effectsByAlert: {
      follow: EFFECT.BURST,
      sub: EFFECT.BURST,
      resub: EFFECT.BURST,
      giftsub: EFFECT.BURST,
      giftbomb: EFFECT.BURST,
      cheer: EFFECT.BURST,
      raid: EFFECT.BURST,
      tip: EFFECT.BURST
    }
  };

  const layers = {};
  for (const k of EFFECT_KEYS) layers[k] = { key: k, q: [], a: null };

  const isNum = (v) => (typeof v === "number" && Number.isFinite(v));

  function envAD(tt, a, d) {
    if (tt <= 0 || tt >= 1) return 0;
    const aa = clamp01(tt / Math.max(1e-6, a));
    const dd = clamp01((1 - tt) / Math.max(1e-6, d));
    return Math.min(aa, dd);
  }

  function pickRandomEffectKey() {
    return EFFECT_KEYS[(Math.random() * EFFECT_KEYS.length) | 0];
  }

  function activateTriggerWindow(nowMs, extraMs) {
    if (state.spawnMode !== "trigger") return;
    const dur = isNum(extraMs) ? extraMs : state.triggerWindowMs;
    const until = nowMs + Math.max(0, dur);
    if (until > state.triggerUntilMs) state.triggerUntilMs = until;
  }

  function enqueue(key, nowMs) {
    const l = layers[key];
    if (!l) return;
    l.q.push(nowMs);
  }

  function tickLayer(l, nowMs) {
    const p = PRESETS[l.key];
    if (!l.a && l.q.length) {
      const t0 = l.q.shift();
      l.a = { t0 };
      return;
    }
    if (!l.a) return;
    if (nowMs - l.a.t0 >= p.dur) l.a = null;
  }

  function syncFromConfig() {
    const C = window.VDAY && window.VDAY.config;
    if (!C) return;

    if (typeof C.alertsEnabled === "boolean") state.alertsEnabled = C.alertsEnabled;

    if (typeof C.spawnMode === "string") {
      const m = C.spawnMode.toLowerCase();
      state.spawnMode = (m === "trigger") ? "trigger" : "continuous";
    }

    if (isNum(C.triggerWindowMs) && C.triggerWindowMs > 0) state.triggerWindowMs = C.triggerWindowMs;

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
      const v = C[map[k]];
      const n = (typeof v === "string") ? Number(v) : v;
      if (isNum(n)) state.effectsByAlert[k] = n;
    }
  }

  function getMultipliers(nowMs) {
    syncFromConfig();

    for (const k of EFFECT_KEYS) tickLayer(layers[k], nowMs);

    const out = { densityMul: 1, speedMul: 1, sizeMul: 1 };

    if (state.spawnMode === "trigger" && nowMs >= state.triggerUntilMs) out.densityMul = 0;
    if (!state.alertsEnabled) return out;

    const hb = layers.heartbeat.a;
    if (hb) {
      const p = PRESETS.heartbeat;
      const tt = clamp01((nowMs - hb.t0) / p.dur);
      const t = (tt * p.dur) / 1000;
      const pulse = Math.max(0, Math.sin(t * p.bps * Math.PI * 2));
      const s = 1 + pulse * p.amp;
      out.sizeMul *= (1 + (s - 1) * (1 - p.sizeBase) + p.sizeBase);
    }

    const gl = layers.glow.a;
    if (gl) {
      const p = PRESETS.glow;
      const tt = clamp01((nowMs - gl.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      out.sizeMul *= (1 + p.size * e);
      out.speedMul *= (1 + p.speed * e);
      out.densityMul *= (1 + p.density * e);
    }

    const wo = layers.wobble.a;
    if (wo) {
      const p = PRESETS.wobble;
      const tt = clamp01((nowMs - wo.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      const osc = Math.abs(Math.sin(((tt * p.dur) / 1000) * p.hz * Math.PI * 2));
      out.speedMul *= (1 + p.speed * e * osc);
      out.sizeMul *= (1 + p.size * e * osc);
    }

    const ad = layers.additive.a;
    if (ad) {
      const p = PRESETS.additive;
      const tt = clamp01((nowMs - ad.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      out.densityMul *= (1 + p.density * e);
      out.speedMul *= (1 + p.speed * e);
    }

    const cs = layers.colorShift.a;
    if (cs) {
      const p = PRESETS.colorShift;
      const tt = clamp01((nowMs - cs.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      const osc = Math.abs(Math.sin(tt * p.cycles * Math.PI * 2));
      out.sizeMul *= (1 + p.size * e * osc);
      out.speedMul *= (1 + p.speed * e * osc);
    }

    const sw = layers.scaleWave.a;
    if (sw) {
      const p = PRESETS.scaleWave;
      const tt = clamp01((nowMs - sw.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      const osc = Math.sin(((tt * p.dur) / 1000) * p.hz * Math.PI * 2);
      out.sizeMul *= (1 + p.amp * e * osc);
    }

    const bu = layers.burst.a;
    if (bu) {
      const p = PRESETS.burst;
      const tt = clamp01((nowMs - bu.t0) / p.dur);
      const e = envAD(tt, p.a, p.d);
      out.densityMul *= (1 + (p.density - 1) * e);
      out.speedMul *= (1 + (p.speed - 1) * e);
      out.sizeMul *= (1 + (p.size - 1) * e);
    }

    return out;
  }

  function dispatch(alertKey) {
    syncFromConfig();
    if (!state.alertsEnabled) return;

    const k = String(alertKey || "").toLowerCase();
    const id = state.effectsByAlert[k] ?? EFFECT.OFF;
    const n = (typeof id === "string") ? Number(id) : id;

    if (!isNum(n)) return;

    if (n === EFFECT.OFF) { debug.log("alert", k, "->", "off"); return; }

    const now = performance.now();
    if (state.spawnMode === "trigger") activateTriggerWindow(now);

    if (n === EFFECT.SPAWN_ONLY) { debug.log("alert", k, "->", "spawnOnly"); return; }

    let key = ID_TO_KEY[n];
    if (n === EFFECT.RANDOM || !key) key = pickRandomEffectKey();
    enqueue(key, now);

    debug.log("alert", k, "->", key);
  }

  window.__vdayAlerts = {
    getMultipliers,
    dispatch,
    setEnabled(v) { state.alertsEnabled = !!v; },
    setSpawnMode(m) { state.spawnMode = (m === "trigger") ? "trigger" : "continuous"; state.triggerUntilMs = 0; },
    setTriggerWindowMs(ms) { const n = Number(ms); if (isNum(n) && n > 0) state.triggerWindowMs = n; },
    setEffect(alertKey, effectId) {
      const k = String(alertKey || "").toLowerCase();
      const n = Number(effectId);
      if (k && isNum(n)) state.effectsByAlert[k] = n;
    }
  };
})();
