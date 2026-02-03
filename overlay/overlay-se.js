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
