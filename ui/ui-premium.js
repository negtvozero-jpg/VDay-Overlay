

(() => {
  const bc = new BroadcastChannel("vday-config");
  const STORAGE_KEY_PRIDE = "vday_premium_pride_mask_v1";
  const STORAGE_KEY_TEX = "vday_premium_texture_mask_v1";
  const MAX_PRIDE = 25;
  const MAX_TEX = 32;

  function waitReady(cb) {
    if (window.__VDayRiveReady && window.__VDayRootVM) cb(window.__VDayRootVM);
    else requestAnimationFrame(() => waitReady(cb));
  }

  function getBool(vm, a, b) {
    try { return !!vm.boolean(a).value; } catch {}
    try { return !!vm.boolean(b).value; } catch {}
    return false;
  }

  function getNum(vm, a, b) {
    try { return vm.number(a).value; } catch {}
    try { return vm.number(b).value; } catch {}
    return 0;
  }

  function loadMask(key) {
    try {
      const s = localStorage.getItem(key);
      const n = s ? Number(s) : 0;
      return (Number.isFinite(n) ? (n >>> 0) : 0) >>> 0;
    } catch {
      return 0 >>> 0;
    }
  }

  function saveMask(key, mask) {
    try { localStorage.setItem(key, String(mask >>> 0)); } catch {}
  }

  function toggle(mask, idx) {
    return (mask ^ (1 << idx)) >>> 0;
  }

  function hookTrigger(trig, fn, label) {
    if (!trig) return false;

    try {
      if (typeof trig.on === "function") {
        trig.on(fn);
        return true;
      }
    } catch (e) {
      console.warn(`[UI Premium] '${label}' .on() failed:`, e);
    }

    try { if (typeof trig.addListener === "function") { trig.addListener(fn); return true; } } catch {}
    try { if (typeof trig.addEventListener === "function") { trig.addEventListener(fn); return true; } } catch {}

    console.warn(`[UI Premium] '${label}' not observable`);
    return false;
  }

  function getPrideContainer(rootVM) {
    try {
      const c = rootVM.viewModel?.("propertyOfPrideItems");
      if (c) return c;
    } catch {}

    try {
      const names = (rootVM.properties || []).map(p => p?.name).filter(Boolean);
      const hit = names.find(n => String(n).toLowerCase().includes("propertyofpride"));
      if (hit) {
        const c = rootVM.viewModel?.(hit);
        if (c) return c;
      }
    } catch {}

    return null;
  }

  function getTextureContainer(rootVM) {
    try {
      const c = rootVM.viewModel?.("propertyOfTextureItems");
      if (c) return c;
    } catch {}

    try {
      const names = (rootVM.properties || []).map(p => p?.name).filter(Boolean);
      const hit = names.find(n => String(n).toLowerCase().includes("propertyoftexture"));
      if (hit) {
        const c = rootVM.viewModel?.(hit);
        if (c) return c;
      }
    } catch {}

    return null;
  }

  function applyVisualSelection(rootVM, mask) {
    const container = getPrideContainer(rootVM);
    if (!container) {
      console.warn("[UI Premium] Pride container VM not found (root/propertyOfPrideItems)");
      return;
    }

    for (let i = 0; i < MAX_PRIDE; i++) {
      const selected = (((mask >>> i) & 1) === 1);

      let itemVM = null;
      try { itemVM = container.viewModel?.(`item${i}`); } catch {}
      if (!itemVM) continue;

      try {
        const b = itemVM.boolean?.("isSelected");
        if (b) b.value = !!selected;
      } catch {}
    }
  }

  function applyVisualTextureSelection(rootVM, mask) {
    const container = getTextureContainer(rootVM);
    if (!container) {
      console.warn("[UI Premium] Texture container VM not found (root/propertyOfTextureItems)");
      return;
    }

    for (let i = 0; i < MAX_TEX; i++) {
      const selected = (((mask >>> i) & 1) === 1);
      let itemVM = null;
      try { itemVM = container.viewModel?.(`item${i}`); } catch {}
      if (!itemVM) continue;

      try {
        const b = itemVM.boolean?.("isSelectedT");
        if (b) b.value = !!selected;
      } catch {}
    }
  }

  waitReady((rootVM) => {

    let prideMask = loadMask(STORAGE_KEY_PRIDE);
    let textureMask = loadMask(STORAGE_KEY_TEX);

    applyVisualSelection(rootVM, prideMask); 
    applyVisualTextureSelection(rootVM, textureMask);

    let prideSelectSeq = 0;
    let prideClearSeq = 0;
    let textureSelectSeq = 0;
    let textureClearSeq = 0;

    function readIsPride() {
      return getBool(rootVM, "isPride", "Main/isPride");
    }
    function readPrideValue() {
      return (getNum(rootVM, "prideValue", "Main/prideValue") | 0);
    }

    function readIsTexture() {
      return getBool(rootVM, "isTexture", "Main/isTexture");
    }
    function readTextureValue() {
      return (getNum(rootVM, "textureValue", "Main/textureValue") | 0);
    }

    
    // --- Alerts bridge (UI -> Overlay) ---
    // NOTE: The overlay does NOT share the same window/Rive instance.
    // We mirror alert settings via BroadcastChannel/localStorage only.
    function readAlertsEnabled() {
      return getBool(rootVM, "alertsEnabled", "Main/alertsEnabled");
    }
    function readAlertHub() {
      return (getNum(rootVM, "alertHub", "Main/alertHub") | 0);
    }
    function readAlertEffectId(name) {
      // Rive VM names are lowercase: follow/sub/resub/giftsub/giftbomb/cheer/raid
      return (getNum(rootVM, `propertyOfAlertInstances/${name}/effectId`, `Main/propertyOfAlertInstances/${name}/effectId`) | 0);
    }
    function readAlertsConfig() {
      return {
        alertsEnabled: !!readAlertsEnabled(),
        alertHub: readAlertHub(),
        alerts: {
          follow:   { effectId: readAlertEffectId("follow") },
          sub:      { effectId: readAlertEffectId("sub") },
          resub:    { effectId: readAlertEffectId("resub") },
          giftsub:  { effectId: readAlertEffectId("giftsub") },
          giftbomb: { effectId: readAlertEffectId("giftbomb") },
          cheer:    { effectId: readAlertEffectId("cheer") },
          raid:     { effectId: readAlertEffectId("raid") },
        },
      };
    }
function readColors() {
      let a = null, b = null;
      try {
        const c1 = rootVM.color?.("heartColor");
        if (c1 && typeof c1.value === "number") a = (c1.value >>> 0);
      } catch {}
      try {
        const c2 = rootVM.color?.("heartColorSecondary");
        if (c2 && typeof c2.value === "number") b = (c2.value >>> 0);
      } catch {}
      return { heartColorARGB: a, heartColorSecondaryARGB: b };
    }

    function postFull() {
      const _alertsCfg = readAlertsConfig();
      // Debug (deduped): only log when alerts config changes, to avoid spam.
      try {
        const _h = JSON.stringify(_alertsCfg);
        if (postFull.__lastAlertsHash !== _h) {
          postFull.__lastAlertsHash = _h;
          console.log('[UI] UI->Overlay alerts config changed:', _alertsCfg);
        }
      } catch {}

      const colors = readColors();
      bc.postMessage({
        type: "config",
        payload: {
          isPride: readIsPride(),
          prideValue: readPrideValue(),
          prideMask: (prideMask >>> 0),
          prideSelectSeq,
          prideClearSeq,
          isTexture: readIsTexture(),
          textureValue: readTextureValue(),
          textureMask: (textureMask >>> 0),
          textureSelectSeq,
          textureClearSeq,
          ...(colors.heartColorARGB != null ? { heartColorARGB: colors.heartColorARGB } : {}),
          ...(colors.heartColorSecondaryARGB != null ? { heartColorSecondaryARGB: colors.heartColorSecondaryARGB } : {}),
          ..._alertsCfg,
        },
      });
    }

    let lastSend = 0;
    function tick(now) {
      if (now - lastSend >= 40) {
        postFull();
        lastSend = now;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    function onPridePulse() {
      if (!readIsPride()) return;

      const idx = readPrideValue();
      if (idx < 0 || idx >= MAX_PRIDE) return;

      prideMask = toggle(prideMask, idx);
      saveMask(STORAGE_KEY_PRIDE, prideMask);
      applyVisualSelection(rootVM, prideMask);

      prideSelectSeq++;
      postFull();

    }

    let prideTrig = null;
    try { prideTrig = rootVM.trigger?.("prideTriggerMain"); } catch {}
    if (!prideTrig) { try { prideTrig = rootVM.trigger?.("Main/prideTriggerMain"); } catch {} }
    hookTrigger(prideTrig, onPridePulse, "prideTriggerMain");

    function onClearPulse() {
      prideMask = 0 >>> 0;
      saveMask(STORAGE_KEY_PRIDE, prideMask);
      applyVisualSelection(rootVM, prideMask);

      prideClearSeq++;
      postFull();

    }

    let clearTrig = null;
    try { clearTrig = rootVM.trigger?.("clearPride"); } catch {}
    if (!clearTrig) { try { clearTrig = rootVM.trigger?.("Main/clearPride"); } catch {} }
    hookTrigger(clearTrig, onClearPulse, "clearPride");

    function onTexturePulse() {
      if (!readIsTexture()) return;

      const idx = readTextureValue();
      if (idx < 0 || idx >= MAX_TEX) return;

      textureMask = toggle(textureMask, idx);
      saveMask(STORAGE_KEY_TEX, textureMask);
      applyVisualTextureSelection(rootVM, textureMask);

      textureSelectSeq++;
      postFull();

    }

    let texTrig = null;
    try { texTrig = rootVM.trigger?.("textureTriggerMain"); } catch {}
    if (!texTrig) { try { texTrig = rootVM.trigger?.("Main/textureTriggerMain"); } catch {} }
    hookTrigger(texTrig, onTexturePulse, "textureTriggerMain");

    function onClearTexturePulse() {
      textureMask = 0 >>> 0;
      saveMask(STORAGE_KEY_TEX, textureMask);
      applyVisualTextureSelection(rootVM, textureMask);

      textureClearSeq++;
      postFull();
    }

    let clearTexTrig = null;
    try { clearTexTrig = rootVM.trigger?.("clearTexture"); } catch {}
    if (!clearTexTrig) { try { clearTexTrig = rootVM.trigger?.("Main/clearTexture"); } catch {} }
    hookTrigger(clearTexTrig, onClearTexturePulse, "clearTexture");
  });

  // ----------------------------
  // Overlay status mini-panel (UI-only)
  // Shows hub + connection state + last event.
  // Does not affect existing UI logic.
  // ----------------------------
  (function initOverlayStatusPanel() {
    if (typeof BroadcastChannel !== "function") return;

    const STATUS_CHANNEL = "vday-alerts-status";
    const bcStatus = new BroadcastChannel(STATUS_CHANNEL);

    let el = null;
    function ensureEl() {
      if (el) return el;
      el = document.createElement("div");
      el.id = "vday-alerts-status";
      el.style.position = "fixed";
      el.style.left = "10px";
      el.style.bottom = "10px";
      el.style.zIndex = "999999";
      el.style.pointerEvents = "none";
      el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      el.style.fontSize = "12px";
      el.style.lineHeight = "1.25";
      el.style.padding = "8px 10px";
      el.style.borderRadius = "8px";
      el.style.background = "rgba(0,0,0,0.55)";
      el.style.color = "#fff";
      el.style.whiteSpace = "pre";
      el.textContent = "Alerts: (waiting)\nHub: -\nWS: -\nLast event: -";
      document.body.appendChild(el);
      return el;
    }

    function hubLabel(n) {
      if (n === 1) return "streamerbot";
      if (n === 2) return "firebot";
      return "off";
    }

    bcStatus.onmessage = (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== "status" || !msg.payload) return;
      const p = msg.payload;

      const alertsOn = !!p.alertsEnabled;
      const hub = hubLabel(Number(p.alertHub) || 0);
      const ws = String(p.wsStatus || "-");
      const last = (p.lastEvent && String(p.lastEvent)) || "-";
      const err = (p.lastError && String(p.lastError)) || "";

      const text = [
        `Alerts: ${alertsOn ? "ON" : "OFF"}`,
        `Hub: ${hub}`,
        `WS: ${ws}`,
        `Last event: ${last}`,
        ...(err ? [`Last error: ${err}`] : []),
      ].join("\n");

      ensureEl().textContent = text;
    };
  })();

})();
