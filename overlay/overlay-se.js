
(function () {
  function hexToARGBInt(hex) {
    if (!hex) return null;
    let h = String(hex).trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 6) h = "ff" + h;
    if (h.length !== 8) return null;
    const n = parseInt(h, 16);
    return Number.isFinite(n) ? (n >>> 0) : null;
  }

  function setNum(C, key, v) {
    const n = (typeof v === "string") ? Number(v.replace(",", ".")) : Number(v);
    if (Number.isFinite(n)) C[key] = n;
  }

  function setBool(C, key, v) {
    if (typeof v === "boolean") C[key] = v;
  }

  function setStr(C, key, v) {
    if (typeof v === "string") C[key] = v;
  }

  const PRIDE_KEYS = Array.from({ length: 32 }, (_, i) => `pride_${i}`);
  const TEX_KEYS = Array.from({ length: 32 }, (_, i) => `tex_${i}`);

  let lastTextureValue = null;
  let lastPrideValue = null;
  let lastPrimary = null;
  let lastSecondary = null;

  function buildMask(keys, f) {
    let m = 0;
    for (let i = 0; i < 32; i++) {
      if (f[keys[i]] === true) m |= (1 << i);
    }
    return m >>> 0;
  }


  function applyFieldData(f) {
    const C = window.VDAY?.config;
    if (!C || !f) return;

    setNum(C, "density", f.density);
    setNum(C, "speed", f.speed);
    setNum(C, "longevity", f.longevity);
    setNum(C, "maxParticles", f.maxParticles);
    setNum(C, "direction", f.direction);
    setNum(C, "sizeMin", f.sizeMin);
    setNum(C, "sizeMax", f.sizeMax);
    
    if (
      Number.isFinite(C.sizeMin) &&
      Number.isFinite(C.sizeMax) &&
      C.sizeMax < C.sizeMin
    ) {
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

    const curPrimary = C.heartColorARGB >>> 0;
    const curSecondary = C.heartColorSecondaryARGB >>> 0;

    const texChanged = lastTextureValue !== C.textureValue;
    const prideChanged = lastPrideValue !== C.prideValue;
    const colorChanged = lastPrimary !== curPrimary || lastSecondary !== curSecondary;

    lastTextureValue = C.textureValue;
    lastPrideValue = C.prideValue;
    lastPrimary = curPrimary;
    lastSecondary = curSecondary;

    if (texChanged || prideChanged || colorChanged) {
      window.vdayRebuildTextures?.();
    }
  }

  function onFields(e) {
    const f = e?.detail?.fieldData || {};
    requestAnimationFrame(() => applyFieldData(f));
  }

  window.addEventListener("onWidgetLoad", onFields);
  window.addEventListener("onWidgetUpdate", onFields);
})();
