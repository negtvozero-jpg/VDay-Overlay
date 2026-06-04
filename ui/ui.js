
const canvas = document.getElementById("rive-canvas");
const RIVE_URL = "/assets/vday_ui.riv";
const ARTBOARD = "Premium";
const STATE_MACHINES = ["State Machine 1"];
const BC_NAME = "vday-config";
const UI_IN_MIN = 30;
const UI_IN_MAX = 420;
const STORAGE_KEY = "vday_ui";
const PATHS_KNOWN = {
  circleAngle: "propertyOfCircleSlider/angle",
  circleHandlePersist: "propertyOfCircleSlider/handlePersist",
};

const bc = new BroadcastChannel(BC_NAME);

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function remap(v, inMin, inMax, outMin, outMax) {
  const t = clamp01((v - inMin) / (inMax - inMin));
  return outMin + t * (outMax - outMin);
}

function resize(riveInstance) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  riveInstance.resizeDrawingSurfaceToCanvas();
}

function safeProps(vm) {
  try {
    return vm?.properties || [];
  } catch {
    return [];
  }
}

function collectNumericPaths(rootVM, vm, basePath, out) {
  const props = safeProps(vm);
  for (const p of props) {
    const name = p?.name;
    if (!name) continue;

    const full = basePath ? `${basePath}/${name}` : name;

    try {
      const acc = rootVM.number && rootVM.number(full);
      if (acc) out.push(full);
    } catch {}

    let nested = null;
    try {
      nested =
        (vm.viewModelInstance && vm.viewModelInstance(name)) ||
        (vm.viewModel && vm.viewModel(name)) ||
        null;
    } catch {}
    if (nested && nested !== vm) {
      collectNumericPaths(rootVM, nested, full, out);
    }

    // list
    try {
      const list = vm.list && vm.list(name);
      if (list && typeof list.length === "number") {
        for (let i = 0; i < list.length; i++) {
          const inst = list.instanceAt && list.instanceAt(i);
          if (!inst) continue;
          collectNumericPaths(rootVM, inst, `${full}/${i}`, out);
        }
      }
    } catch {}
  }
}

function buildLinearSliderPathMap(rootVM) {
  const allNum = [];
  collectNumericPaths(rootVM, rootVM, "", allNum);

  const sliderValuePaths = allNum.filter((p) =>
    String(p).toLowerCase().endsWith("/slidervalue")
  );

  function pickPathFor(name) {
    const n = String(name).toLowerCase();
    let c = sliderValuePaths.find((p) => p.toLowerCase().includes(`/${n}/`));
    if (c) return c;
    c = sliderValuePaths.find((p) => p.toLowerCase().includes(n));
    return c || null;
  }

  return {
    density: pickPathFor("density"),
    speed: pickPathFor("speed"),
    longevity: pickPathFor("longevity"),
    sizemin: pickPathFor("sizemin"),
    sizemax: pickPathFor("sizemax"),
    maxparticles: pickPathFor("maxparticles"),
  };
}

function readNumberByPath(rootVM, path) {
  if (!path) return null;
  try {
    const acc = rootVM.number(path);
    return acc ? acc.value : null;
  } catch {
    return null;
  }
}

function writeNumberByPath(rootVM, path, value) {
  if (!path) return false;
  try {
    const acc = rootVM.number(path);
    if (!acc) return false;
    acc.value = value;
    return true;
  } catch {
    return false;
  }
}

function getColorARGB(rootVM, name) {
  try {
    const c = rootVM.color && rootVM.color(name);
    return c ? (c.value >>> 0) : null;
  } catch {
    return null;
  }
}

function setColorARGB(rootVM, name, argb) {
  try {
    const c = rootVM.color && rootVM.color(name);
    if (!c) return false;
    c.value = (argb >>> 0);
    return true;
  } catch {
    return false;
  }
}

function argbToHexRGB(argb) {
  if (typeof argb !== "number") return "#e85a5a";
  const r = (argb >>> 16) & 0xff;
  const g = (argb >>> 8) & 0xff;
  const b = (argb >>> 0) & 0xff;
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

function hexRGBToARGB(hex) {
  const h = String(hex || "").trim().replace("#", "");
  if (h.length !== 6) return null;
  const rgb = parseInt(h, 16);
  if (!Number.isFinite(rgb)) return null;
  return ((0xff << 24) | (rgb >>> 0)) >>> 0;
}

function loadRawState() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function saveRawState(raw) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {}
}

let didRestoreOnce = false;

function restoreUIStateOnce(rootVM, linearPaths) {
  if (didRestoreOnce) return;
  didRestoreOnce = true;

  const saved = loadRawState();
  if (!saved) return;

  if (saved.sliders) {
    if (typeof saved.sliders.density === "number")
      writeNumberByPath(rootVM, linearPaths.density, saved.sliders.density);
    if (typeof saved.sliders.speed === "number")
      writeNumberByPath(rootVM, linearPaths.speed, saved.sliders.speed);
    if (typeof saved.sliders.longevity === "number")
      writeNumberByPath(rootVM, linearPaths.longevity, saved.sliders.longevity);
    if (typeof saved.sliders.sizemin === "number")
      writeNumberByPath(rootVM, linearPaths.sizemin, saved.sliders.sizemin);
    if (typeof saved.sliders.sizemax === "number")
      writeNumberByPath(rootVM, linearPaths.sizemax, saved.sliders.sizemax);
    if (typeof saved.sliders.maxparticles === "number")
      writeNumberByPath(
        rootVM,
        linearPaths.maxparticles,
        saved.sliders.maxparticles
      );
  }

  if (typeof saved.circleAngle === "number") {
    const a = ((saved.circleAngle % 360) + 360) % 360;
    const hp = (360 - a) % 360; 
    requestAnimationFrame(() => {
      writeNumberByPath(rootVM, PATHS_KNOWN.circleHandlePersist, hp);
    });
  }

  if (typeof saved.heartColorARGB === "number") {
    setColorARGB(rootVM, "heartColor", saved.heartColorARGB);
  }
  if (typeof saved.heartColorSecondaryARGB === "number") {
    setColorARGB(rootVM, "heartColorSecondary", saved.heartColorSecondaryARGB);
  }
}

function clampSizeRaw(rootVM, linearPaths) {
  const rawMin = readNumberByPath(rootVM, linearPaths?.sizemin);
  const rawMax = readNumberByPath(rootVM, linearPaths?.sizemax);
  if (
    typeof rawMin === "number" &&
    typeof rawMax === "number" &&
    rawMax < rawMin
  ) {
    writeNumberByPath(rootVM, linearPaths.sizemax, rawMin);
  }
}

function buildRawSnapshot(rootVM, linearPaths) {
  return {
    sliders: {
      density: readNumberByPath(rootVM, linearPaths.density),
      speed: readNumberByPath(rootVM, linearPaths.speed),
      longevity: readNumberByPath(rootVM, linearPaths.longevity),
      sizemin: readNumberByPath(rootVM, linearPaths.sizemin),
      sizemax: readNumberByPath(rootVM, linearPaths.sizemax),
      maxparticles: readNumberByPath(rootVM, linearPaths.maxparticles),
    },
    circleAngle: readNumberByPath(rootVM, PATHS_KNOWN.circleAngle),
    heartColorARGB: getColorARGB(rootVM, "heartColor"),
    heartColorSecondaryARGB: getColorARGB(rootVM, "heartColorSecondary"),
  };
}

function buildPayload(rootVM, linearPaths) {
  const p = {};

  const rawDensity = readNumberByPath(rootVM, linearPaths.density);
  if (rawDensity != null) p.density = remap(rawDensity, UI_IN_MIN, UI_IN_MAX, 0, 25);

  const rawSpeed = readNumberByPath(rootVM, linearPaths.speed);
  if (rawSpeed != null) p.speed = remap(rawSpeed, UI_IN_MIN, UI_IN_MAX, 20, 500);

  const rawLongevity = readNumberByPath(rootVM, linearPaths.longevity);
  if (rawLongevity != null) p.longevity = remap(rawLongevity, UI_IN_MIN, UI_IN_MAX, 0.5, 10);

  const rawMin = readNumberByPath(rootVM, linearPaths.sizemin);
  if (rawMin != null) p.sizeMin = remap(rawMin, UI_IN_MIN, UI_IN_MAX, 10, 200);

  const rawMax = readNumberByPath(rootVM, linearPaths.sizemax);
  if (rawMax != null) p.sizeMax = remap(rawMax, UI_IN_MIN, UI_IN_MAX, 10, 200);

  const rawCap = readNumberByPath(rootVM, linearPaths.maxparticles);
  if (rawCap != null) p.maxParticles = Math.round(remap(rawCap, UI_IN_MIN, UI_IN_MAX, 10, 400));

  if (p.sizeMax != null && p.sizeMin != null && p.sizeMax < p.sizeMin) {
    p.sizeMax = p.sizeMin;
  }

  const angle = readNumberByPath(rootVM, PATHS_KNOWN.circleAngle);
  if (angle != null) p.direction = angle;

  const c1 = getColorARGB(rootVM, "heartColor");
  const c2 = getColorARGB(rootVM, "heartColorSecondary");
  if (c1 != null) p.heartColorARGB = c1;
  if (c2 != null) p.heartColorSecondaryARGB = c2;
  if (c1 != null) p.colorHex = argbToHexRGB(c1); 

  try {
    const it = rootVM.boolean && rootVM.boolean("isTexture");
    if (it) p.isTexture = !!it.value;
  } catch {}

  return p;
}

function ensureColorPanel() {
  let panel = document.getElementById("vday-color-panel");
  if (panel) return panel;

  const style = document.createElement("style");
  style.textContent = `
    #vday-color-panel{
      position:fixed;
      z-index:2147483647;
      display:none;
      width:360px;
      padding:12px;
      border-radius:14px;
      border:1px solid rgba(186,215,233,0.25);
      background:rgba(43,52,103,0.96);
      box-shadow:0 18px 50px rgba(0,0,0,0.45);
      backdrop-filter:blur(10px);
      color:#FCFFE7;
      font:13px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      box-sizing:border-box;
    }

    #vday-color-panel *{
      box-sizing:border-box;
    }

    #vday-color-panel .cpHeader{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      margin-bottom:10px;
    }

    #vday-color-panel .cpTitle{
      font-size:13px;
      color:rgba(252,255,231,0.70);
      font-weight:800;
    }

    #vday-color-panel .cpClose{
      height:30px;
      padding:0 10px;
      border-radius:10px;
      border:1px solid rgba(186,215,233,0.25);
      background:rgba(0,0,0,0.18);
      color:#FCFFE7;
      cursor:pointer;
      font-weight:800;
    }

    #vday-color-panel .cpRow{
      display:flex;
      gap:10px;
      align-items:stretch;
    }

    #vday-color-panel .cpSV,
    #vday-color-panel .cpHue{
      display:block;
      border-radius:12px;
      background:rgba(0,0,0,0.12);
      border:1px solid rgba(255,255,255,0.10);
      touch-action:none;
      user-select:none;
    }

    #vday-color-panel .cpSV{
      cursor:crosshair;
      flex:1 1 auto;
      width:300px;
      height:210px;
    }

    #vday-color-panel .cpHue{
      cursor:ns-resize;
      flex:0 0 auto;
      width:26px;
      height:210px;
    }

    #vday-color-panel .cpBottom{
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:10px;
      margin-top:10px;
    }

    #vday-color-panel .cpSwatch{
      width:72px;
      height:38px;
      border-radius:10px;
      border:1px solid rgba(186,215,233,0.25);
      background:#ffffff;
      margin-right:auto;
    }

    #vday-color-panel .cpHex{
      width:130px;
      height:38px;
      border-radius:10px;
      border:1px solid rgba(186,215,233,0.25);
      background:rgba(0,0,0,0.18);
      color:#FCFFE7;
      padding:0 10px;
      font-size:14px;
      font-weight:800;
      letter-spacing:.5px;
      outline:none;
      text-transform:uppercase;
      font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
    }

    #vday-color-panel .hiddenColorInput{
      display:none;
    }
  `;
  document.head.appendChild(style);

  panel = document.createElement("div");
  panel.id = "vday-color-panel";
  panel.innerHTML = `
    <div class="cpHeader">
      <div class="cpTitle" id="vdayCpTitle">Primary color</div>
      <button type="button" class="cpClose" id="vdayCpClose">Close</button>
    </div>

    <div class="cpRow">
      <canvas class="cpSV" id="vdayCpSV" width="300" height="210"></canvas>
      <canvas class="cpHue" id="vdayCpHue" width="26" height="210"></canvas>
    </div>

    <div class="cpBottom">
      <div class="cpSwatch" id="vdayCpSwatch"></div>
      <input class="cpHex" id="vdayCpHex" inputmode="text" autocomplete="off" spellcheck="false" />
    </div>

    <input id="vdaySysColorPrimary" class="hiddenColorInput" type="text" value="#e85a5a">
    <input id="vdaySysColorSecondary" class="hiddenColorInput" type="text" value="#8a2e2e">
  `;
  document.body.appendChild(panel);

  const title = panel.querySelector("#vdayCpTitle");
  const close = panel.querySelector("#vdayCpClose");
  const cpSV = panel.querySelector("#vdayCpSV");
  const cpHue = panel.querySelector("#vdayCpHue");
  const cpSwatch = panel.querySelector("#vdayCpSwatch");
  const cpHex = panel.querySelector("#vdayCpHex");

  const primaryInput = panel.querySelector("#vdaySysColorPrimary");
  const secondaryInput = panel.querySelector("#vdaySysColorSecondary");

  const svCtx = cpSV.getContext("2d");
  const hueCtx = cpHue.getContext("2d");

  let targetInput = primaryInput;
  let H = 0;
  let S = 1;
  let V = 1;

  function clamp01Local(x) {
    x = Number(x);
    if (!Number.isFinite(x)) return 0;
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 1) + 1) % 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255),
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;

    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }

    return {
      h: ((h % 1) + 1) % 1,
      s: mx === 0 ? 0 : d / mx,
      v: mx,
    };
  }

  function rgbToHex6(r, g, b) {
    return [r, g, b].map((n) => {
      n = Math.max(0, Math.min(255, Number(n) | 0));
      return n.toString(16).padStart(2, "0").toUpperCase();
    }).join("");
  }

  function hex6ToRgb(hex) {
    let h = String(hex || "").trim().replace(/^#/, "").toUpperCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9A-F]{6}$/.test(h)) h = "000000";

    const n = parseInt(h, 16);
    return {
      r: (n >> 16) & 255,
      g: (n >> 8) & 255,
      b: n & 255,
      hex: h,
    };
  }

  function setTargetHex6(hex6) {
    if (!targetInput) return;

    targetInput.value = "#" + hex6;

    try {
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
    } catch {}

    try {
      targetInput.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {}
  }

  function renderHue() {
    const w = cpHue.width;
    const h = cpHue.height;

    const g = hueCtx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.00, "#FF0000");
    g.addColorStop(1 / 6, "#FFFF00");
    g.addColorStop(2 / 6, "#00FF00");
    g.addColorStop(3 / 6, "#00FFFF");
    g.addColorStop(4 / 6, "#0000FF");
    g.addColorStop(5 / 6, "#FF00FF");
    g.addColorStop(1.00, "#FF0000");

    hueCtx.clearRect(0, 0, w, h);
    hueCtx.fillStyle = g;
    hueCtx.fillRect(0, 0, w, h);

    const y = Math.round((1 - H) * h);

    hueCtx.save();
    hueCtx.strokeStyle = "rgba(255,255,255,.92)";
    hueCtx.lineWidth = 2;
    hueCtx.beginPath();
    hueCtx.rect(1, y - 3, w - 2, 6);
    hueCtx.stroke();
    hueCtx.restore();
  }

  function renderSV() {
    const w = cpSV.width;
    const h = cpSV.height;
    const base = hsvToRgb(H, 1, 1);

    svCtx.clearRect(0, 0, w, h);
    svCtx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
    svCtx.fillRect(0, 0, w, h);

    const white = svCtx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    svCtx.fillStyle = white;
    svCtx.fillRect(0, 0, w, h);

    const black = svCtx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    svCtx.fillStyle = black;
    svCtx.fillRect(0, 0, w, h);

    const x = Math.round(S * w);
    const y = Math.round((1 - V) * h);

    svCtx.save();
    svCtx.strokeStyle = "rgba(255,255,255,.95)";
    svCtx.lineWidth = 2;
    svCtx.beginPath();
    svCtx.arc(x, y, 8, 0, Math.PI * 2);
    svCtx.stroke();
    svCtx.restore();
  }

  function emit() {
    const rgb = hsvToRgb(H, S, V);
    const hex6 = rgbToHex6(rgb.r, rgb.g, rgb.b);

    cpSwatch.style.background = "#" + hex6;
    cpHex.value = hex6;

    setTargetHex6(hex6);
  }

  function rerender(write = true) {
    renderHue();
    renderSV();

    if (write) emit();
    else {
      const rgb = hsvToRgb(H, S, V);
      const hex6 = rgbToHex6(rgb.r, rgb.g, rgb.b);
      cpSwatch.style.background = "#" + hex6;
      cpHex.value = hex6;
    }
  }

  function syncFromInput(inputEl) {
    const rgb = hex6ToRgb(inputEl && inputEl.value);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

    H = hsv.h;
    S = hsv.s;
    V = hsv.v;

    rerender(false);
  }

  function closePanel() {
    panel.style.display = "none";
  }

  function trackPointer(el, onMove) {
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      onMove(x, y, r);
    };

    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };

    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  }

  cpHue.addEventListener("pointerdown", (ev) => {
    const apply = (_x, y, r) => {
      H = clamp01Local(1 - y / r.height);
      rerender(true);
    };

    const r = cpHue.getBoundingClientRect();
    apply(0, ev.clientY - r.top, r);
    trackPointer(cpHue, apply);
  });

  cpSV.addEventListener("pointerdown", (ev) => {
    const apply = (x, y, r) => {
      S = clamp01Local(x / r.width);
      V = clamp01Local(1 - y / r.height);
      rerender(true);
    };

    const r = cpSV.getBoundingClientRect();
    apply(ev.clientX - r.left, ev.clientY - r.top, r);
    trackPointer(cpSV, apply);
  });

  cpHex.addEventListener("input", () => {
    let v = String(cpHex.value || "").trim().replace(/^#/, "").toUpperCase();
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    if (!/^[0-9A-F]{0,6}$/.test(v)) return;

    cpHex.value = v;

    if (v.length === 6) {
      const rgb = hex6ToRgb(v);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

      H = hsv.h;
      S = hsv.s;
      V = hsv.v;

      rerender(true);
    }
  });

  close.addEventListener("click", closePanel);

  document.addEventListener("mousedown", (ev) => {
    if (panel.style.display !== "block") return;
    if (!panel.contains(ev.target)) closePanel();
  });

  panel.__primaryInput = primaryInput;
  panel.__secondaryInput = secondaryInput;

  panel.__showTarget = function (target) {
    if (target === "secondary") {
      targetInput = secondaryInput;
      title.textContent = "Secondary color";
    } else {
      targetInput = primaryInput;
      title.textContent = "Primary color";
    }

    syncFromInput(targetInput);
  };

  return panel;
}

function bootRive() {
  const riveInstance = new rive.Rive({
    src: RIVE_URL,
    canvas,
    artboard: ARTBOARD,
    stateMachines: STATE_MACHINES,
    autoplay: true,
    autoBind: true,
    layout: new rive.Layout({ fit: "contain", alignment: "center" }),

    onLoad: () => {
      resize(riveInstance);

      const rootVM = riveInstance.viewModelInstance;
      if (!rootVM) {
        console.error("[UI] No viewModelInstance bound on riveInstance.");
        return;
      }

      window.__VDayRootVM = rootVM;
      window.__VDayRiveReady = true;

      const linearPaths = buildLinearSliderPathMap(rootVM);
      restoreUIStateOnce(rootVM, linearPaths);
      const panel = ensureColorPanel();
      const sysColorPrimary = panel.__primaryInput;
      const sysColorSecondary = panel.__secondaryInput;

      let lastMouseX = 16;
      let lastMouseY = 16;
      window.addEventListener("mousemove", (ev) => {
        lastMouseX = ev.clientX;
        lastMouseY = ev.clientY;
      }, { passive: true });
      window.addEventListener("pointermove", (ev) => {
        lastMouseX = ev.clientX;
        lastMouseY = ev.clientY;
      }, { passive: true });

      function positionPanelNearMouse() {
        const pad = 8;
        const vw = window.innerWidth || 1920;
        const vh = window.innerHeight || 1080;
        panel.style.display = "block";
        panel.style.visibility = "hidden";
        const w = panel.offsetWidth || 120;
        const h = panel.offsetHeight || 60;
        let x = lastMouseX + 12;
        let y = lastMouseY + 12;
        if (x + w + pad > vw) x = Math.max(pad, lastMouseX - w - 12);
        if (y + h + pad > vh) y = Math.max(pad, lastMouseY - h - 12);
        panel.style.left = `${Math.round(x)}px`;
        panel.style.top = `${Math.round(y)}px`;
        panel.style.visibility = "visible";
      }

      function seedPickerFromVM(target) {
        if (target === "secondary") {
          const c2 = getColorARGB(rootVM, "heartColorSecondary");
          if (typeof c2 === "number") sysColorSecondary.value = argbToHexRGB(c2);
        } else {
          const c1 = getColorARGB(rootVM, "heartColor");
          if (typeof c1 === "number") sysColorPrimary.value = argbToHexRGB(c1);
        }
      }

      function openColorPanel(target) {
        panel.__showTarget(target);
        seedPickerFromVM(target);
        positionPanelNearMouse();
      }


      function hookTrigger(name, target) {
        try {
          const t = rootVM.trigger && rootVM.trigger(name);
          if (!t || !t.on) return;
          t.on(() => openColorPanel(target));
        } catch {}
      }

      hookTrigger("colorTrigger", "primary");
      hookTrigger("colorTriggerSecondary", "secondary");

      sysColorPrimary.addEventListener("input", () => {
        const argb = hexRGBToARGB(sysColorPrimary.value);
        if (argb == null) return;
        setColorARGB(rootVM, "heartColor", argb);

        const payload = buildPayload(rootVM, linearPaths);
        bc.postMessage({ type: "config", payload });
        saveRawState(buildRawSnapshot(rootVM, linearPaths));
      });

      sysColorSecondary.addEventListener("input", () => {
        const argb = hexRGBToARGB(sysColorSecondary.value);
        if (argb == null) return;
        setColorARGB(rootVM, "heartColorSecondary", argb);

        const payload = buildPayload(rootVM, linearPaths);
        bc.postMessage({ type: "config", payload });
        saveRawState(buildRawSnapshot(rootVM, linearPaths));
      });

      let lastSend = 0;
      let lastSave = 0;

      function tick(now) {
        if (now - lastSend >= 40) {
          clampSizeRaw(rootVM, linearPaths);
          const payload = buildPayload(rootVM, linearPaths);
          bc.postMessage({ type: "config", payload });
          lastSend = now;
        }

        if (now - lastSave >= 200) {
          saveRawState(buildRawSnapshot(rootVM, linearPaths));
          lastSave = now;
        }

        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    },

    onLoadError: (e) => console.error("[UI] Rive load error:", e),
  });

  window.addEventListener("resize", () => resize(riveInstance));
}

window.addEventListener("DOMContentLoaded", bootRive);
