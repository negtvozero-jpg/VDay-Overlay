(() => {
  const bc = new BroadcastChannel("vday-config");

  const STORAGE_KEY_PRIDE = "vday_premium_pride_mask_v1";
  const STORAGE_KEY_TEX = "vday_premium_texture_mask_v1";

  const MAX_PRIDE = 25;
  const MAX_TEX = 32;

  const COLOR_PRESETS = [
    "#e85a5a",
    "#8a2e2e",
    "#ff7aa2",
    "#ffffff",
    "#ffcc66",
    "#66ccff",
    "#b36bff",
    "#66ff99",
  ];

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

  function hexToArgbInt(hex) {
    const clean = String(hex || "").replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return (0xff000000 | parseInt(clean, 16)) >>> 0;
  }

  function argbIntToHex(argb) {
    const n = Number(argb) >>> 0;
    return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  }

  function setRiveColor(rootVM, name, hex) {
    const argb = hexToArgbInt(hex);
    if (argb == null) return false;

    try {
      const c = rootVM.color?.(name);
      if (!c) return false;
      c.value = argb;
      return true;
    } catch {
      return false;
    }
  }

  function loadMask(key) {
    try {
      const s = localStorage.getItem(key);
      const n = s ? Number(s) : 0;
      return Number.isFinite(n) ? (n >>> 0) : 0;
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

    try {
      if (typeof trig.addListener === "function") {
        trig.addListener(fn);
        return true;
      }
    } catch {}

    try {
      if (typeof trig.addEventListener === "function") {
        trig.addEventListener(fn);
        return true;
      }
    } catch {}

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
      if (hit) return rootVM.viewModel?.(hit);
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
      if (hit) return rootVM.viewModel?.(hit);
    } catch {}

    return null;
  }

  function applyVisualSelection(rootVM, mask) {
    const container = getPrideContainer(rootVM);
    if (!container) return;

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
    if (!container) return;

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

  function ensureInlineColorPanel(rootVM, postFull) {
    if (document.getElementById("vdayInlineColorPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #vdayInlineColorPanel{
        position:fixed;
        left:16px;
        bottom:16px;
        width:280px;
        padding:14px;
        border-radius:16px;
        background:rgba(43,52,103,.96);
        border:1px solid rgba(186,215,233,.28);
        color:#FCFFE7;
        font:13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 18px 50px rgba(0,0,0,.45);
        z-index:99999;
        display:none;
      }
      #vdayInlineColorPanel.open{ display:block; }
      #vdayInlineColorPanel .row{ display:flex; align-items:center; gap:10px; margin:9px 0; }
      #vdayInlineColorPanel label{ width:22px; opacity:.75; font-weight:700; }
      #vdayInlineColorPanel input[type="range"]{ flex:1; }
      #vdayInlineColorPanel input[type="text"]{
        width:100%;
        height:34px;
        border-radius:10px;
        border:1px solid rgba(186,215,233,.28);
        background:rgba(0,0,0,.22);
        color:#FCFFE7;
        padding:0 10px;
        font-weight:700;
      }
      #vdayInlineColorPanel .head{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
      #vdayInlineColorPanel .preview{
        width:34px;
        height:34px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.35);
        background:#e85a5a;
      }
      #vdayInlineColorPanel .swatches{ display:grid; grid-template-columns:repeat(8,1fr); gap:6px; margin-top:10px; }
      #vdayInlineColorPanel .swatch{
        width:24px;
        height:24px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,.38);
        cursor:pointer;
      }
      #vdayInlineColorPanel .close{
        border:0;
        border-radius:10px;
        background:rgba(186,215,233,.18);
        color:#FCFFE7;
        height:30px;
        padding:0 10px;
        cursor:pointer;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "vdayInlineColorPanel";
    panel.innerHTML = `
      <div class="head">
        <strong id="vdayColorTitle">Color</strong>
        <div class="preview" id="vdayColorPreview"></div>
        <button class="close" id="vdayColorClose" type="button">Close</button>
      </div>
      <input id="vdayColorHex" type="text" maxlength="7" value="#e85a5a">
      <div class="row"><label>R</label><input id="vdayColorR" type="range" min="0" max="255" value="232"></div>
      <div class="row"><label>G</label><input id="vdayColorG" type="range" min="0" max="255" value="90"></div>
      <div class="row"><label>B</label><input id="vdayColorB" type="range" min="0" max="255" value="90"></div>
      <div class="swatches" id="vdayColorSwatches"></div>
    `;
    document.body.appendChild(panel);

    const title = panel.querySelector("#vdayColorTitle");
    const preview = panel.querySelector("#vdayColorPreview");
    const hexInput = panel.querySelector("#vdayColorHex");
    const rInput = panel.querySelector("#vdayColorR");
    const gInput = panel.querySelector("#vdayColorG");
    const bInput = panel.querySelector("#vdayColorB");
    const swatches = panel.querySelector("#vdayColorSwatches");
    const closeBtn = panel.querySelector("#vdayColorClose");

    let activeColorName = "heartColor";

    function rgbToHex(r, g, b) {
      return "#" + [r, g, b].map(v => {
        const n = Math.max(0, Math.min(255, Number(v) | 0));
        return n.toString(16).padStart(2, "0");
      }).join("");
    }

    function hexToRgb(hex) {
      const clean = String(hex || "").replace("#", "").trim();
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
      const n = parseInt(clean, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function applyHex(hex, write = true) {
      const rgb = hexToRgb(hex);
      if (!rgb) return;

      const normalized = rgbToHex(rgb.r, rgb.g, rgb.b);
      rInput.value = String(rgb.r);
      gInput.value = String(rgb.g);
      bInput.value = String(rgb.b);
      hexInput.value = normalized;
      preview.style.background = normalized;

      if (write) {
        setRiveColor(rootVM, activeColorName, normalized);
        postFull();
      }
    }

    function applyFromRgb() {
      applyHex(rgbToHex(rInput.value, gInput.value, bInput.value), true);
    }

    rInput.addEventListener("input", applyFromRgb);
    gInput.addEventListener("input", applyFromRgb);
    bInput.addEventListener("input", applyFromRgb);

    hexInput.addEventListener("input", () => {
      const value = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) applyHex(value, true);
    });

    closeBtn.addEventListener("click", () => {
      panel.classList.remove("open");
    });

    COLOR_PRESETS.forEach(hex => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch";
      btn.style.background = hex;
      btn.addEventListener("click", () => applyHex(hex, true));
      swatches.appendChild(btn);
    });

    window.__VDayOpenColorPanel = function openColorPanel(colorName) {
      activeColorName = colorName || "heartColor";
      title.textContent = activeColorName;

      let current = "#e85a5a";
      try {
        const c = rootVM.color?.(activeColorName);
        if (c && typeof c.value === "number") current = argbIntToHex(c.value);
      } catch {}

      applyHex(current, false);
      panel.classList.add("open");
    };
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

    function readColors() {
      let a = null, b = null;

      try {
        const c1 = rootVM.color?.("heartColor");
        if (c1 && typeof c1.value === "number") a = c1.value >>> 0;
      } catch {}

      try {
        const c2 = rootVM.color?.("heartColorSecondary");
        if (c2 && typeof c2.value === "number") b = c2.value >>> 0;
      } catch {}

      return { heartColorARGB: a, heartColorSecondaryARGB: b };
    }

    function postFull() {
      const colors = readColors();

      bc.postMessage({
        type: "config",
        payload: {
          isPride: readIsPride(),
          prideValue: readPrideValue(),
          prideMask: prideMask >>> 0,
          prideSelectSeq,
          prideClearSeq,
          isTexture: readIsTexture(),
          textureValue: readTextureValue(),
          textureMask: textureMask >>> 0,
          textureSelectSeq,
          textureClearSeq,
          ...(colors.heartColorARGB != null ? { heartColorARGB: colors.heartColorARGB } : {}),
          ...(colors.heartColorSecondaryARGB != null ? { heartColorSecondaryARGB: colors.heartColorSecondaryARGB } : {}),
        },
      });
    }

    ensureInlineColorPanel(rootVM, postFull);

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
    if (!prideTrig) {
      try { prideTrig = rootVM.trigger?.("Main/prideTriggerMain"); } catch {}
    }
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
    if (!clearTrig) {
      try { clearTrig = rootVM.trigger?.("Main/clearPride"); } catch {}
    }
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
    if (!texTrig) {
      try { texTrig = rootVM.trigger?.("Main/textureTriggerMain"); } catch {}
    }
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
    if (!clearTexTrig) {
      try { clearTexTrig = rootVM.trigger?.("Main/clearTexture"); } catch {}
    }
    hookTrigger(clearTexTrig, onClearTexturePulse, "clearTexture");

    function hookColorTrigger(triggerName, colorName) {
      let trig = null;

      try { trig = rootVM.trigger?.(triggerName); } catch {}
      if (!trig) {
        try { trig = rootVM.trigger?.(`Main/${triggerName}`); } catch {}
      }

      hookTrigger(trig, () => {
        if (window.__VDayOpenColorPanel) {
          window.__VDayOpenColorPanel(colorName);
        }
      }, triggerName);
    }

    hookColorTrigger("colorTrigger", "heartColor");
    hookColorTrigger("colorTriggerSecondary", "heartColorSecondary");
  });
})();