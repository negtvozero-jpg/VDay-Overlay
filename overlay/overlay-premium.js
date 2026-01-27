
(() => {
  const _spawnHeart = window.spawnHeart;
  const _drawHeart = window.drawHeart;

  if (typeof _spawnHeart !== "function" || typeof _drawHeart !== "function") {
    console.error("[Premium] overlay.js (core) precisa carregar antes.");
    return;
  }

  const STORAGE_KEY_PRIDE = "vday_premium_pride_mask_v1";
  const STORAGE_KEY_TEX = "vday_premium_texture_mask_v1";

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

  let activePrideMask = loadMask(STORAGE_KEY_PRIDE);
  let activeTextureMask = loadMask(STORAGE_KEY_TEX);

  let heartColorARGB = 0xffff4da6;
  let heartColorSecondaryARGB = 0xffffffff;

  function pickFromMask(mask, maxBits = 25) {
    mask = (mask >>> 0);
    if (!mask) return null;
    const pool = [];
    for (let i = 0; i < maxBits; i++) if (mask & (1 << i)) pool.push(i);
    if (!pool.length) return null;
    return pool[(Math.random() * pool.length) | 0];
  }

  const prideCache = {};
  function getPrideImage(idx) {
    if (!prideCache[idx]) {
      const img = new Image();
      img.src = `/assets-premium/p_${idx}.webp`;
      prideCache[idx] = img;
    }
    return prideCache[idx];
  }

  const textureTintCache = new Map();
  const textureCache = {};
  function getTextureImage(idx) {
    if (!textureCache[idx]) {
      const img = new Image();
      img.src = `/assets-premium/T_${idx}.webp`;
      textureCache[idx] = img;
    }
    return textureCache[idx];
  }



  function argbToRgba(argb) {
    const a = ((argb >>> 24) & 0xff) / 255;
    const r = (argb >>> 16) & 0xff;
    const g = (argb >>> 8) & 0xff;
    const b = (argb >>> 0) & 0xff;
    return { r, g, b, a };
  }

const BASE_A = { r: 232, g: 90,  b: 90  }; 
const BASE_B = { r: 138, g: 46,  b: 46  }; 
const BASE_TOL = 28;


  function distRgb(p, q) {
    const dr = p.r - q.r;
    const dg = p.g - q.g;
    const db = p.b - q.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function tintTextureDual(img, idx, primaryARGB, secondaryARGB) {
    const key = `${idx}|${primaryARGB >>> 0}|${secondaryARGB >>> 0}`;
    if (textureTintCache.has(key)) return textureTintCache.get(key);

    if (!img.complete || !img.naturalWidth) return null;

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d", { willReadFrequently: true });
    cctx.clearRect(0, 0, w, h);
    cctx.drawImage(img, 0, 0);

    const im = cctx.getImageData(0, 0, w, h);
    const d = im.data;
    const P = argbToRgba(primaryARGB);
    const S = argbToRgba(secondaryARGB);

    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;

      const px = { r: d[i], g: d[i + 1], b: d[i + 2] };
      const da = distRgb(px, BASE_A);
      const db = distRgb(px, BASE_B);

      if (da <= BASE_TOL && da <= db) {
        d[i] = P.r;
        d[i + 1] = P.g;
        d[i + 2] = P.b;

      } else if (db <= BASE_TOL && db < da) {
        d[i] = S.r;
        d[i + 1] = S.g;
        d[i + 2] = S.b;
      }
    }

    if (textureTintCache.size > 300) textureTintCache.clear();

    cctx.putImageData(im, 0, 0);
    textureTintCache.set(key, c);
    return c;
  }

  const bc = new BroadcastChannel("vday-config");

  let lastPrideClearSeq = null;
  let lastTextureClearSeq = null;
  let didSyncClear = false;

  bc.onmessage = (ev) => {
    const payload = ev?.data?.payload;
    if (!payload) return;
    if (typeof payload.heartColorARGB === "number") heartColorARGB = (payload.heartColorARGB >>> 0);
    if (typeof payload.heartColorSecondaryARGB === "number") heartColorSecondaryARGB = (payload.heartColorSecondaryARGB >>> 0);
    if (typeof payload.prideMask === "number") {
      const m = (payload.prideMask >>> 0);
      if (m !== activePrideMask) {
        activePrideMask = m;
        saveMask(STORAGE_KEY_PRIDE, activePrideMask);
      }
    }

    if (typeof payload.textureMask === "number") {
      const m = (payload.textureMask >>> 0);
      if (m !== activeTextureMask) {
        activeTextureMask = m;
        saveMask(STORAGE_KEY_TEX, activeTextureMask);
      }
    }

    if (typeof payload.prideClearSeq === "number") {
      if (!didSyncClear) {
        didSyncClear = true;
        lastPrideClearSeq = payload.prideClearSeq;
      } else if (payload.prideClearSeq !== lastPrideClearSeq) {
        lastPrideClearSeq = payload.prideClearSeq;
        activePrideMask = 0 >>> 0;
        saveMask(STORAGE_KEY_PRIDE, activePrideMask);
      }
    }

    if (typeof payload.textureClearSeq === "number") {
      if (lastTextureClearSeq == null) {
        lastTextureClearSeq = payload.textureClearSeq;
      } else if (payload.textureClearSeq !== lastTextureClearSeq) {
        lastTextureClearSeq = payload.textureClearSeq;
        activeTextureMask = 0 >>> 0;
        saveMask(STORAGE_KEY_TEX, activeTextureMask);
      }
    }
  };

  window.spawnHeart = function (cfg, init) {
    const heart = _spawnHeart(cfg, init);

    heart.prideIndex = null;
    heart.textureIndex = null;


    if (cfg?.isTexture) {
      const pick = pickFromMask(activeTextureMask, 32);
      heart.textureIndex = (pick != null) ? pick : null;
      if (heart.textureIndex != null) heart.flipX = Math.random() < 0.5;
      return heart;
    }

    if (cfg?.isPride) {
      const pick = pickFromMask(activePrideMask, 25);
      heart.prideIndex = (pick != null) ? pick : null;
      if (heart.prideIndex != null) heart.flipX = Math.random() < 0.5;
      return heart;
    }

    return heart;
  };

  window.drawHeart = function (ctx, heart, render) {
    if (heart?.textureIndex != null) {
      const img = getTextureImage(heart.textureIndex);
      if (img.complete && img.naturalWidth > 0) {
        const s = (render && render.sizeNow) ? render.sizeNow : heart.size;

        const tinted = tintTextureDual(img, heart.textureIndex, heartColorARGB, heartColorSecondaryARGB) || img;

        ctx.save();
        if (heart.flipX) ctx.scale(-1, 1);
        ctx.drawImage(tinted, -s / 2, -s / 2, s, s);
        ctx.restore();
        return;
      }
    }

    if (heart?.prideIndex != null) {
      const img = getPrideImage(heart.prideIndex);
      if (img.complete && img.naturalWidth > 0) {
        const s = (render && render.sizeNow) ? render.sizeNow : heart.size;
        ctx.save();
        if (heart.flipX) ctx.scale(-1, 1);
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.restore();
        return;
      }
    }
    _drawHeart(ctx, heart, render);
  };
})();
