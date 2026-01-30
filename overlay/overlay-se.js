(function () {
  function hexToARGBInt(hex) {
    if (!hex) return null;
    let h = String(hex).trim();
    if (h.startsWith("#")) h = h.slice(1);
    if (h.length === 6) h = "ff" + h;
    if (h.length !== 8) return null;
    return parseInt(h, 16) >>> 0;
  }

  function applyFieldData(f) {
    const C = window.VDAY?.config;
    if (!C || !f) return;

    if (f.density != null) C.density = Number(f.density);
    if (f.speed != null) C.speed = Number(f.speed);
    if (f.longevity != null) C.longevity = Number(f.longevity);
    if (f.maxParticles != null) C.maxParticles = Number(f.maxParticles);
    if (f.direction != null) C.direction = Number(f.direction);

    if (f.sizeMin != null) C.sizeMin = Number(f.sizeMin);
    if (f.sizeMax != null) C.sizeMax = Number(f.sizeMax);
    if (C.sizeMax < C.sizeMin) C.sizeMax = C.sizeMin;

    // IMPORTANT: render usa colorHex
    if (f.primaryColor != null) C.colorHex = String(f.primaryColor).trim();

    const p = hexToARGBInt(f.primaryColor);
    const s = hexToARGBInt(f.secondaryColor);
    if (p != null) C.heartColorARGB = p;
    if (s != null) C.heartColorSecondaryARGB = s;

    if (f.styleMode === "texture") { C.isTexture = true; C.isPride = false; }
    else if (f.styleMode === "pride") { C.isPride = true; C.isTexture = false; }
    else { C.isPride = false; C.isTexture = false; }

    window.vdayRebuildTextures?.();
  }

  function onFields(e) {
    const f = e?.detail?.fieldData || {};
    requestAnimationFrame(() => applyFieldData(f));
  }

  window.addEventListener("onWidgetLoad", onFields);
  window.addEventListener("onWidgetUpdate", onFields);
})();
