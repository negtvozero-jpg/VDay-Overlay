const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let width, height;
const TARGET_W = 1920;
const TARGET_H = 1080;

function resize() {

  width = TARGET_W;
  height = TARGET_H;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(TARGET_W * dpr);
  canvas.height = Math.floor(TARGET_H * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

const CONFIG = {
  density: 6,    
  speed: 160,           
  direction: 0,         
  longevity: 3,        
  sizeMin: 90,         
  sizeMax: 170,         
  colorHex: "#ff4da6",
  heartColorARGB: 0xffff4da6,
  heartColorSecondaryARGB: 0xffffffff,
  isPride: false,
  prideValue: 0,
  isTexture: false,
  textureValue: 0,
  directionJitterDeg: 10,  
  maxParticles: 80,
  spawnSpread: 1,
  poolSize: 200
};

function argbToHex(argb) {
  const rgb = (argb >>> 0) & 0x00ffffff;
  return "#" + rgb.toString(16).padStart(6, "0");
}
function getAlertMultipliers(nowMs) {
  const a = window.__vdayAlerts;
  if (a && typeof a.getMultipliers === "function") {
    const m = a.getMultipliers(nowMs) || {};
    const isNum = (v) => (typeof v === "number" && Number.isFinite(v));

    return {
      densityMul: isNum(m.densityMul) ? m.densityMul : 1,
      speedMul: isNum(m.speedMul) ? m.speedMul : 1,
      sizeMul: isNum(m.sizeMul) ? m.sizeMul : (isNum(m.scaleMul) ? m.scaleMul : 1),
    };
  }
  return { densityMul: 1, speedMul: 1, sizeMul: 1 };
}

window.__vdayGetAlertMultipliers = getAlertMultipliers;

const bc = new BroadcastChannel("vday-config");
bc.onmessage = (ev) => {

  const msg = ev.data;
  if (!msg || msg.type !== "config") return;

  const c = msg.payload || {};

  if (typeof c.density === "number") CONFIG.density = c.density;
  if (typeof c.speed === "number") CONFIG.speed = c.speed;
  if (typeof c.direction === "number") CONFIG.direction = c.direction;
  if (typeof c.longevity === "number") CONFIG.longevity = c.longevity;
  if (typeof c.sizeMin === "number") CONFIG.sizeMin = c.sizeMin;
  if (typeof c.sizeMax === "number") CONFIG.sizeMax = c.sizeMax;
  if (typeof c.maxParticles === "number") CONFIG.maxParticles = Math.round(c.maxParticles);
  if (typeof c.spawnSpread === "number") CONFIG.spawnSpread = c.spawnSpread;
  if (typeof c.directionJitterDeg === "number") CONFIG.directionJitterDeg = c.directionJitterDeg;
  if (typeof c.colorHex === "string") CONFIG.colorHex = c.colorHex;
  if (typeof c.heartColorARGB === "number") {
    CONFIG.heartColorARGB = (c.heartColorARGB >>> 0);
    CONFIG.colorHex = argbToHex(CONFIG.heartColorARGB);
  }
  if (typeof c.heartColorSecondaryARGB === "number") CONFIG.heartColorSecondaryARGB = (c.heartColorSecondaryARGB >>> 0);
  if (typeof c.isPride === "boolean") CONFIG.isPride = c.isPride;
  if (typeof c.prideValue === "number") CONFIG.prideValue = c.prideValue >>> 0;
  if (typeof c.isTexture === "boolean") CONFIG.isTexture = c.isTexture;
  if (typeof c.textureValue === "number") CONFIG.textureValue = c.textureValue >>> 0;
  if (CONFIG.sizeMax < CONFIG.sizeMin) CONFIG.sizeMax = CONFIG.sizeMin; 


};

const particles = [];
const pool = [];

for (let i = 0; i < CONFIG.poolSize; i++) pool.push({});

function acquireParticle() {
  return pool.pop() || {};
}

function releaseParticle(p) {
  pool.push(p);
}


window.spawnHeart = function (cfg, init) {
  const p = acquireParticle();
  p.x = init.x;
  p.y = init.y;
  p.vx = init.vx;
  p.vy = init.vy;
  p.size = init.size;
  p.life = init.life;
  p.age = 0;
  p.rotation = init.rotation;
  p.rotationSpeed = init.rotationSpeed;
  return p;
};

window.drawHeart = function (ctx, p, render) {
  ctx.drawImage(
    render.tinted,
    -render.sizeNow / 2,
    -render.sizeNow / 2,
    render.sizeNow,
    render.sizeNow
  );
};

const heartImg = new Image();
heartImg.src = "/assets/default.webp";

heartImg.onload = () => {
  requestAnimationFrame(loop);
};

const degToRad = (d) => (d * Math.PI) / 180;

function directionToAngleRad(directionDeg) {
  const jitter = (Math.random() * 2 - 1) * CONFIG.directionJitterDeg; 
  const d = (360 - directionDeg) % 360;  
  return degToRad(d - 90 + jitter);

}

function pickSpawnPointRay(dirX, dirY, margin, w, h, spreadPx) {
  const minX = -margin, maxX = w + margin;
  const minY = -margin, maxY = h + margin;
  const cx = w * 0.5, cy = h * 0.5;
  const len = Math.hypot(dirX, dirY) || 1;
  const dx = dirX / len, dy = dirY / len;
  const px = -dy, py = dx;
  const u = (Math.random() * 2 - 1) * spreadPx;
  const ox = cx + px * u;
  const oy = cy + py * u;
  const rx = -dx, ry = -dy;
  let tmin = -Infinity, tmax = Infinity;

  if (Math.abs(rx) < 1e-9) {
    if (ox < minX || ox > maxX) return { x: cx, y: h + margin };
  } else {
    const tx1 = (minX - ox) / rx;
    const tx2 = (maxX - ox) / rx;
    tmin = Math.max(tmin, Math.min(tx1, tx2));
    tmax = Math.min(tmax, Math.max(tx1, tx2));
  }

  if (Math.abs(ry) < 1e-9) {
    if (oy < minY || oy > maxY) return { x: cx, y: h + margin };
  } else {
    const ty1 = (minY - oy) / ry;
    const ty2 = (maxY - oy) / ry;
    tmin = Math.max(tmin, Math.min(ty1, ty2));
    tmax = Math.min(tmax, Math.max(ty1, ty2));
  }

  if (tmax < tmin) return { x: cx, y: h + margin };

  const tHit = (tmin >= 0) ? tmin : tmax;

  if (!Number.isFinite(tHit)) return { x: cx, y: h + margin };

  return { x: ox + rx * tHit, y: oy + ry * tHit };

}

let spawnAccumulator = 0;

function spawn(dt) {

  const spreadPx = CONFIG.spawnSpread * Math.min(width, height);
  const spreadNorm = Math.max(0.25, spreadPx / Math.min(width, height));

    const am = getAlertMultipliers(performance.now());

  spawnAccumulator += dt * (CONFIG.density * am.densityMul) * spreadNorm;


    if (particles.length >= CONFIG.maxParticles) {
    spawnAccumulator = 0;
    return;
  }

  const MAX_SPAWNS_PER_FRAME = 12;
  let spawnsThisFrame = 0;

  while (spawnAccumulator >= 1) {
    if (spawnsThisFrame++ >= MAX_SPAWNS_PER_FRAME) {

      spawnAccumulator = 0;
      break;
    }
    spawnAccumulator--;

    if (particles.length >= CONFIG.maxParticles) break;

    const size =
      CONFIG.sizeMin +
      Math.random() * (CONFIG.sizeMax - CONFIG.sizeMin);

    const angle = directionToAngleRad(CONFIG.direction);

        const speed =
      (CONFIG.speed * am.speedMul) * (0.8 + Math.random() * 0.4);

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    const margin = size;

    const spreadPx = CONFIG.spawnSpread * Math.min(width, height);

    const { x, y } = pickSpawnPointRay(dirX, dirY, margin, width, height, spreadPx);

    const p = window.spawnHeart(CONFIG, {
      x,
      y,
      vx: dirX * speed,
      vy: dirY * speed,
      size,
      life: CONFIG.longevity,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 1,
    });

    particles.push(p);

  }
}

function update(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];

    p.age += dt;

    if (p.age >= p.life) {
      const last = particles.pop();
      if (i < particles.length) particles[i] = last;
      releaseParticle(p);
      continue;
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rotation += p.rotationSpeed * dt;
  }
}


const tintCache = new Map();

function getTintedHeart(hex) {
  const key = String(hex || "#ffffff").trim().toLowerCase();
  if (tintCache.has(key)) return tintCache.get(key);

  const w = heartImg.naturalWidth || heartImg.width;
  const h = heartImg.naturalHeight || heartImg.height;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cctx = c.getContext("2d");
  cctx.clearRect(0, 0, w, h);
  cctx.drawImage(heartImg, 0, 0);
  cctx.globalCompositeOperation = "source-atop";
  cctx.fillStyle = key;
  cctx.fillRect(0, 0, w, h);
  cctx.globalCompositeOperation = "source-over";

  tintCache.set(key, c);
  return c;
}

function draw() {
  ctx.clearRect(0, 0, width, height);

  const tinted = getTintedHeart(CONFIG.colorHex);
  const am = getAlertMultipliers(performance.now());

  for (const p of particles) {
    const t = p.age / p.life;          
    const shrink = Math.max(0, 1 - t);  
        const sizeNow = p.size * shrink * am.sizeMul;

    if (sizeNow <= 0.01) continue;

    ctx.save();
    ctx.globalAlpha = 1;          
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);

    window.drawHeart(ctx, p, { tinted, sizeNow });

    ctx.restore();
  }
}

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  spawn(dt);
  update(dt);
  draw();

  requestAnimationFrame(loop);
}
