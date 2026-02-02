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
    RANDOM: 8
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

  const PRESETS = {
    heartbeat: { durationMs: 1800, beatsPerSecond: 2.6, pulseStrength: 0.7, densityMul: 1, speedMul: 1 },
    glow: { durationMs: 2200, attack: 0.06, decay: 0.35, alphaMax: 100, blurMaxPx: 100, strength: 20 },
    additive: { durationMs: 1000, attack: 0.04, decay: 0.5, alphaAmp: 5 },
    wobble: { durationMs: 1500, attack: 0.04, decay: 0.28, angleRad: Math.PI / 2, freqHz: 3 },
    colorShift: { durationMs: 2200, attack: 0.03, decay: 0.25, cycles: 5 },
    scaleWave: { durationMs: 1100, attack: 0.04, decay: 0.28, amp: 0.5, freqHz: 5.5 },
    burst: { durationMs: 900, attack: 0.03, decay: 0.18, densityMul: 10, speedMul: 5 }
  };

  const state = {
    alertsEnabled: true,
    spawnMode: "continuous",
    triggerUntilMs: 0,
    triggerWindowMs: 6000,
    effectsByAlert: {
      follow: EFFECT.BURST,
      sub: EFFECT.BURST,
      resub: EFFECT.BURST,
      giftsub: EFFECT.BURST,
      giftbomb: EFFECT.BURST,
      cheer: EFFECT.BURST,
      raid: EFFECT.BURST
    }
  };

  const layers = {};
  for (const k in PRESETS) layers[k] = { queue: [], active: null };

  const clamp01 = v => Math.max(0, Math.min(1, v));

  function envAD(t, a, d) {
    if (t <= 0 || t >= 1) return 0;
    return Math.min(clamp01(t / a), clamp01((1 - t) / d));
  }

  function activateTriggerWindow(now, extra) {
    if (state.spawnMode !== "trigger") return;
    const dur = Number.isFinite(extra) ? extra : state.triggerWindowMs;
    const until = now + Math.max(0, dur);
    if (until > state.triggerUntilMs) state.triggerUntilMs = until;
  }

  function enqueueEffect(key, now) {
    const l = layers[key];
    if (l) l.queue.push({ at: now });
  }

  function pickRandomEffect() {
    const k = Object.keys(PRESETS);
    return k[(Math.random() * k.length) | 0];
  }

  function tickLayer(l, now) {
    if (!l.active && l.queue.length) {
      const q = l.queue.shift();
      l.active = { start: q.at, p: PRESETS[l.key] };
      return;
    }
    if (!l.active) return;
    if (now - l.active.start >= l.active.p.durationMs) l.active = null;
  }

  function getMultipliers(now) {
    const out = { densityMul: 1, speedMul: 1, sizeMul: 1 };

    if (state.spawnMode === "trigger" && now >= state.triggerUntilMs) {
      out.densityMul = 0;
    }

    if (!state.alertsEnabled) return out;

    for (const k in layers) tickLayer(layers[k], now);

    const hb = layers.heartbeat?.active;
    if (hb) {
      const tt = clamp01((now - hb.start) / PRESETS.heartbeat.durationMs);
      const t = (tt * PRESETS.heartbeat.durationMs) / 1000;
      const pulse = Math.max(0, Math.sin(t * PRESETS.heartbeat.beatsPerSecond * Math.PI * 2));
      const s = 1 + pulse * PRESETS.heartbeat.pulseStrength;
      out.sizeMul *= s;
      out.densityMul *= PRESETS.heartbeat.densityMul;
      out.speedMul *= PRESETS.heartbeat.speedMul;
    }

    const bu = layers.burst?.active;
    if (bu) {
      const tt = clamp01((now - bu.start) / PRESETS.burst.durationMs);
      const e = envAD(tt, PRESETS.burst.attack, PRESETS.burst.decay);
      out.densityMul *= PRESETS.burst.densityMul;
      out.speedMul *= PRESETS.burst.speedMul;
    }

    return out;
  }

  function dispatch(alert) {
    if (!state.alertsEnabled) return;

    const id = state.effectsByAlert[String(alert).toLowerCase()] ?? EFFECT.OFF;
    if (id === EFFECT.OFF) return;

    let key = ID_TO_KEY[id];
    if (id === EFFECT.RANDOM || !key) key = pickRandomEffect();

    const now = performance.now();
    activateTriggerWindow(now);
    enqueueEffect(key, now);

    debug.log("alert", alert, "->", key);
  }

  window.__vdayAlerts = {
    getMultipliers,
    dispatch,
    setEnabled(v) { state.alertsEnabled = !!v; },
    setSpawnMode(m) {
      state.spawnMode = m === "trigger" ? "trigger" : "continuous";
      state.triggerUntilMs = 0;
    },
    setTriggerWindowMs(ms) {
      const n = Number(ms);
      if (Number.isFinite(n) && n > 0) state.triggerWindowMs = n;
    }
  };
})();
