
const canvas = document.getElementById("rive-canvas");
const RIVE_URL = "../assets/vday_ui.riv";
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

  panel = document.createElement("div");
  panel.id = "vday-color-panel";
  panel.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "display:none",
    "padding:8px",
    "border-radius:10px",
    "background:rgba(15,15,15,0.92)",
    "border:1px solid rgba(255,255,255,0.12)",
    "box-shadow:0 12px 28px rgba(0,0,0,0.35)",
    "backdrop-filter: blur(6px)",
  ].join(";");

  const primaryInput = document.createElement("input");
  primaryInput.type = "color";
  primaryInput.id = "vdaySysColorPrimary";
  primaryInput.setAttribute("aria-label", "Primary color");
  primaryInput.style.cssText = [
    "width:44px",
    "height:28px",
    "display:inline-block",
    "opacity:1",
    "pointer-events:auto",
    "position:static",
    "margin:0",
    "padding:0",
    "border:1px solid rgba(255,255,255,0.25)",
    "border-radius:8px",
    "background:transparent",
    "cursor:pointer",
  ].join(";");

  const secondaryInput = document.createElement("input");
  secondaryInput.type = "color";
  secondaryInput.id = "vdaySysColorSecondary";
  secondaryInput.setAttribute("aria-label", "Secondary color");
  secondaryInput.style.cssText = primaryInput.style.cssText;
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = "×";
  close.style.cssText = [
    "margin-left:8px",
    "width:28px",
    "height:28px",
    "line-height:26px",
    "text-align:center",
    "background:transparent",
    "color:rgba(255,255,255,0.85)",
    "border:1px solid rgba(255,255,255,0.18)",
    "border-radius:8px",
    "padding:0",
    "cursor:pointer",
    "user-select:none",
    "font-size:18px",
  ].join(";");

  close.addEventListener("click", () => {
    panel.style.display = "none";
  });

  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;";

  row.appendChild(primaryInput);
  row.appendChild(secondaryInput);
  row.appendChild(close);
  panel.appendChild(row);
  document.body.appendChild(panel);

  document.addEventListener("mousedown", (ev) => {
    if (panel.style.display !== "block") return;
    if (!panel.contains(ev.target)) panel.style.display = "none";
  });

  panel.__primaryInput = primaryInput;
  panel.__secondaryInput = secondaryInput;
  panel.__showTarget = function (target ) {
    if (target === "secondary") {
      secondaryInput.style.display = "inline-block";
      primaryInput.style.display = "none";
    } else {
      primaryInput.style.display = "inline-block";
      secondaryInput.style.display = "none";
    }
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
