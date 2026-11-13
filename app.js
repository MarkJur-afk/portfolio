/* ============================================================
   Mark — developer in the ruins
   One map, four apocalypses. Pick a technology and the camera
   dives into its location.
   ============================================================ */
'use strict';

const MAP_W = 1484, MAP_H = 1060;   // world map size (px)
const IW = 1536, IH = 1024;         // location image size (px) — effects are drawn in these units
const FX_SCALE = 2;                 // map canvas backing-resolution multiplier
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const T = ms => RM ? ms * 0.2 : ms;  // scale animation durations

/* ---------- zones ---------- */
const ZONES = [
  { id: 'python', name: 'The Quiet City',     lang: 'Python',          x: 0.40, y: 0.64, color: '#c8693a' },
  { id: 'csharp', name: 'Snowbound',          lang: 'C#',              x: 0.17, y: 0.27, color: '#9fd0e6' },
  { id: 'sql',    name: 'The Drowned Quarter', lang: 'SQL',            x: 0.72, y: 0.36, color: '#5fb8a8' },
  { id: 'web',    name: 'The Metro',          lang: 'JS / HTML / CSS', x: 0.82, y: 0.82, color: '#d9a441' },
];

/* what each location looks like + which effects live there
   lamps: [x, y, glowRadius, kind]  (x,y are fractions of the image) */
const SCENES = {
  python: { img: 'assets/scenes/python.jpg', dust: 70, birds: true,  snow: false, rain: true,  mist: false, ripples: false,
            lamps: [[.329, .444, 80], [.105, .33, 60], [.964, .45, 60]] },
  csharp: { img: 'assets/scenes/csharp.jpg', dust: 0,  birds: true,  snow: true,  rain: false, mist: false, ripples: false,
            lamps: [[.273, .366, 80]] },
  sql:    { img: 'assets/scenes/sql.jpg',    dust: 20, birds: true,  snow: false, rain: true,  mist: true,  ripples: true,
            lamps: [[.184, .322, 80]] },
  web:    { img: 'assets/scenes/web.jpg',    dust: 90, birds: false, snow: false, rain: false, mist: false, ripples: false, drips: true,
            alwaysLit: true,
            lamps: [[.869, .227, 110], [.173, .415, 46], [.215, .395, 40], [.84, .566, 60], [.775, .61, 52], [.267, .088, 90]] },
};

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInCubic = u => u * u * u;
const easeOutCubic = u => 1 - Math.pow(1 - u, 3);
const easeInOut = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const wait = ms => new Promise(r => setTimeout(r, ms));
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ============================================================
   WORLD STATE (what Python / UI can change)
   ============================================================ */
const state = { time: 'day', lights: false, rain: false, snow: 0.6, birdTarget: 14, lamp: [255, 205, 120], power: 1, alarm: false };
const TINTS = { day: 'rgb(255,255,255)', dusk: 'rgb(255,178,140)', night: 'rgb(70,86,140)' };
const worldAPI = {
  time(mode) {
    if (!(mode in TINTS)) throw new Error(`time() expects "day", "dusk" or "night", got "${mode}"`);
    state.time = mode; applyTint();
  },
  birds(n) { state.birdTarget = clamp(Math.round(Number(n) || 0), 0, 120); },
  lights(on = true) { state.lights = !!on; },
  rain(on = true) { state.rain = !!on; },
  snow(level) { state.snow = clamp(Number(level), 0, 1); },
  reset() { Object.assign(state, { time: 'day', lights: false, rain: false, snow: 0.6, birdTarget: 14, lamp: [255, 205, 120], power: 1, alarm: false }); applyTint(); },
};
function applyTint() { $('#tint').style.backgroundColor = TINTS[state.time]; }

/* ============================================================
   CAMERA (map view)
   ============================================================ */
const stage = $('#stage'), worldEl = $('#world'), panel = $('#panel');
let vw = innerWidth, vh = innerHeight;
const cam = { x: 0, y: 0, s: 1 };
const tgt = { x: 0, y: 0, s: 1 };
let mode = 'map';      // map | diving | scene | leaving
let busy = false;
let current = null;    // zone currently entered

const coverScale = () => Math.max(vw / MAP_W, vh / MAP_H);
function constrain(c) {
  const min = coverScale();
  c.s = clamp(c.s, min, min * 3.4);
  const w = MAP_W * c.s, h = MAP_H * c.s;
  c.x = w <= vw ? (vw - w) / 2 : clamp(c.x, vw - w, 0);
  c.y = h <= vh ? (vh - h) / 2 : clamp(c.y, vh - h, 0);
}
function overview() {
  tgt.s = coverScale();
  tgt.x = (vw - MAP_W * tgt.s) / 2;
  tgt.y = (vh - MAP_H * tgt.s) / 2;
  constrain(tgt);
}
function resize() {
  vw = innerWidth; vh = innerHeight;
  if (mode === 'map') { constrain(tgt); constrain(cam); }
  sizeScene();
}
addEventListener('resize', resize);

/* scripted camera moves ("pull" into a zone and back out) */
let tw = null;
function tweenCam(zone, toS, toScreen, dur, ease) {
  return new Promise(res => {
    tw = {
      t0: performance.now(), dur, ease, zone, res,
      s0: cam.s, sx0: cam.x + zone.x * MAP_W * cam.s, sy0: cam.y + zone.y * MAP_H * cam.s,
      s1: toS, sx1: toScreen.x, sy1: toScreen.y,
    };
  });
}

/* drag / wheel / pinch (map only) */
let drag = null, moved = 0, pinchStart = null;
const pointers = new Map();
stage.addEventListener('pointerdown', e => {
  if (mode !== 'map') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) { drag = { x: e.clientX, y: e.clientY, tx: tgt.x, ty: tgt.y }; moved = 0; }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), s: tgt.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: tgt.x, ty: tgt.y };
    drag = null;
  }
});
addEventListener('pointermove', e => {
  par.tx = (e.clientX / vw - 0.5) * 2; par.ty = (e.clientY / vh - 0.5) * 2;
  if (!pointers.has(e.pointerId) || mode !== 'map') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchStart && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const k = Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.d;
    const ns = clamp(pinchStart.s * k, coverScale(), coverScale() * 3.4);
    const r = ns / pinchStart.s;
    tgt.s = ns;
    tgt.x = pinchStart.cx - (pinchStart.cx - pinchStart.tx) * r;
    tgt.y = pinchStart.cy - (pinchStart.cy - pinchStart.ty) * r;
    constrain(tgt); moved = 99; return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
  if (moved > 5) stage.classList.add('dragging');
  tgt.x = drag.tx + dx; tgt.y = drag.ty + dy;
  constrain(tgt);
});
const endPtr = e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) { drag = null; stage.classList.remove('dragging'); }
};
addEventListener('pointerup', endPtr);
addEventListener('pointercancel', endPtr);
stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (mode !== 'map') return;
  const k = Math.exp(-e.deltaY * 0.0014);
  const ns = clamp(tgt.s * k, coverScale(), coverScale() * 3.4);
  const r = ns / tgt.s;
  tgt.x = e.clientX - (e.clientX - tgt.x) * r;
  tgt.y = e.clientY - (e.clientY - tgt.y) * r;
  tgt.s = ns; constrain(tgt);
}, { passive: false });
addEventListener('click', e => {
  if (!stage.contains(e.target)) return;
  if (moved > 5) { e.stopPropagation(); e.preventDefault(); }
  moved = 0;
}, true);

/* ============================================================
   MAP FX (birds, snow, rain, dust, lights)
   ============================================================ */
const fx = $('#fx');
fx.width = MAP_W * FX_SCALE; fx.height = MAP_H * FX_SCALE;
const ctx = fx.getContext('2d');

const birds = [];
function spawnBird(edge = true) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const ang = (dir === 1 ? 0 : Math.PI) + rand(-0.35, 0.35);
  const sp = rand(34, 70);
  return {
    x: edge ? (dir === 1 ? -30 : MAP_W + 30) : rand(0, MAP_W),
    y: rand(60, MAP_H - 80),
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.4,
    ph: rand(0, 6.28), fr: rand(7, 11), sz: rand(8, 14),
  };
}
for (let i = 0; i < 14; i++) birds.push(spawnBird(false));

const SNOW_BOX = { x0: 0, y0: 0, x1: MAP_W * 0.5, y1: MAP_H * 0.66 };
const snowMask = (x, y) => {
  const nx = (x / MAP_W - 0.12) / 0.40, ny = (y / MAP_H - 0.24) / 0.44;
  return clamp(1.25 - Math.hypot(nx, ny), 0, 1);
};
const flakes = Array.from({ length: 320 }, () => ({
  x: rand(SNOW_BOX.x0, SNOW_BOX.x1), y: rand(SNOW_BOX.y0, SNOW_BOX.y1),
  r: rand(0.8, 2.2), v: rand(14, 34), w: rand(0, 6.28), k: Math.random(),
}));
const drops = Array.from({ length: 380 }, () => ({ x: rand(0, MAP_W), y: rand(0, MAP_H), v: rand(520, 800), l: rand(9, 16) }));
const motes = Array.from({ length: 50 }, () => ({ x: rand(MAP_W * 0.22, MAP_W * 0.58), y: rand(MAP_H * 0.45, MAP_H * 0.92), p: rand(0, 6.28), s: rand(0.6, 1.6) }));
const rnd = mulberry(2033);
const windows = Array.from({ length: 22 }, () => ({ x: MAP_W * (0.25 + rnd() * 0.3), y: MAP_H * (0.52 + rnd() * 0.34), r: 9 + rnd() * 9, p: rnd() * 6.28 }));
let lightLevel = 0;

function drawBirdShape(c, b, shadow = true) {
  const f = Math.sin(b.ph), ang = Math.atan2(b.vy, b.vx), s = b.sz;
  c.save();
  c.translate(b.x, b.y); c.rotate(ang);
  const wing = () => {
    c.beginPath();
    c.moveTo(-s * 0.2, -s * 0.9 - f * s * 0.5);
    c.quadraticCurveTo(s * 0.05, -f * s * 0.2 - s * 0.15, s * 0.9, 0);
    c.quadraticCurveTo(s * 0.05, f * s * 0.2 + s * 0.15, -s * 0.2, s * 0.9 + f * s * 0.5);
    c.stroke();
  };
  c.lineCap = 'round';
  if (shadow) { c.strokeStyle = 'rgba(0,0,0,.14)'; c.lineWidth = 1.6; c.save(); c.translate(7, 12); wing(); c.restore(); }
  c.strokeStyle = 'rgba(18,16,14,.88)'; c.lineWidth = Math.max(1.5, s * 0.11); wing();
  c.restore();
}

function updateLight(dt) {
  const want = (state.lights || state.time === 'night') ? 1 : 0;
  lightLevel += (want - lightLevel) * Math.min(1, dt * 1.6);
}
function updateMapFx(t, dt) {
  while (birds.length < state.birdTarget) birds.push(spawnBird(true));
  if (birds.length > state.birdTarget) birds.length = state.birdTarget;
  for (const b of birds) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.ph += b.fr * dt;
    b.vy += Math.sin(t * 0.6 + b.fr) * 6 * dt;
    if (b.x < -60 || b.x > MAP_W + 60 || b.y < -40 || b.y > MAP_H + 40) Object.assign(b, spawnBird(true));
  }
  for (const f of flakes) {
    f.y += f.v * dt; f.w += dt; f.x += Math.sin(f.w * 0.8 + f.k * 6) * 10 * dt + 4 * dt;
    if (f.y > SNOW_BOX.y1 || f.x > SNOW_BOX.x1) { f.y = SNOW_BOX.y0 - 4; f.x = rand(SNOW_BOX.x0, SNOW_BOX.x1); }
  }
  for (const d of drops) { d.y += d.v * dt; d.x -= d.v * 0.18 * dt; if (d.y > MAP_H || d.x < 0) { d.y = -10; d.x = rand(0, MAP_W * 1.1); } }
  for (const m of motes) { m.p += dt * 0.4; m.x += Math.cos(m.p) * 6 * dt; m.y += Math.sin(m.p * 0.7) * 3 * dt - 1.2 * dt; if (m.y < MAP_H * 0.4) m.y = MAP_H * 0.92; }
}
function drawMapFx(t) {
  ctx.setTransform(FX_SCALE, 0, 0, FX_SCALE, 0, 0);
  ctx.clearRect(0, 0, MAP_W, MAP_H);
  ctx.fillStyle = 'rgba(235,215,170,.28)';
  for (const m of motes) { ctx.beginPath(); ctx.arc(m.x, m.y, m.s, 0, 6.28); ctx.fill(); }
  if (state.snow > 0.01) {
    const n = Math.floor(flakes.length * state.snow);
    for (let i = 0; i < n; i++) {
      const f = flakes[i], a = snowMask(f.x, f.y);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.55 * f.k) * Math.min(1, a * 1.6)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill();
    }
  }
  for (const b of birds) drawBirdShape(ctx, b);
  if (lightLevel > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    for (const w of windows) {
      const a = lightLevel * (0.55 + 0.25 * Math.sin(t * 2.4 + w.p));
      const g = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.r);
      g.addColorStop(0, `rgba(255,196,110,${a})`); g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, 6.28); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  if (state.rain) {
    ctx.strokeStyle = 'rgba(190,210,225,.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const d of drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y - d.l); }
    ctx.stroke();
  }
}

/* ============================================================
   LOCATION SCENES (the place you get pulled into)
   ============================================================ */
const sceneEl = $('#scene'), zoomEl = $('#sc-zoom'), innerEl = $('#sc-inner'), imgEl = $('#sc-img'), sfx = $('#sc-fx');
const sctx = sfx.getContext('2d');
const par = { x: 0, y: 0, tx: 0, ty: 0 };
let sceneK = 1;
let S = null;                 // active scene config
let sMotes = [], sFlakes = [], sBirds = [], sRain = [], sRipples = [], sDrops = [], sBlobs = [];

function sizeScene() {
  const W = Math.max(vw, vh * (IW / IH)) * 1.06, H = W / (IW / IH);
  innerEl.style.width = W + 'px'; innerEl.style.height = H + 'px';
  innerEl.style.left = (vw - W) / 2 + 'px'; innerEl.style.top = (vh - H) / 2 + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  sfx.width = Math.round(W * dpr); sfx.height = Math.round(H * dpr);
  sceneK = (W / IW) * dpr;
}

function prepareScene(z) {
  S = SCENES[z.id];
  imgEl.src = S.img; imgEl.alt = `${z.name}, ${z.lang} location`;
  sMotes = Array.from({ length: S.dust }, () => ({ x: rand(0, IW), y: rand(0, IH), p: rand(0, 6.28), s: rand(0.8, 2.2), a: rand(0.15, 0.5) }));
  sFlakes = S.snow ? Array.from({ length: 480 }, () => ({ x: rand(0, IW), y: rand(0, IH), r: rand(1, 3.4), v: rand(30, 85), w: rand(0, 6.28), k: Math.random() })) : [];
  sBirds = []; sRipples = []; sDrops = []; zombies = []; dyingZ = []; sceneShown = false;
  sRain = Array.from({ length: 420 }, () => ({ x: rand(0, IW * 1.1), y: rand(0, IH), v: rand(700, 1100), l: rand(16, 32) }));
  sBlobs = S.mist ? Array.from({ length: 7 }, (_, i) => ({ x: rand(0, IW), y: IH * rand(0.5, 0.72), r: rand(260, 460), v: rand(6, 16) })) : [];
  par.x = par.y = 0;
}
function spawnSceneBird() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  return { x: dir === 1 ? -40 : IW + 40, y: rand(IH * 0.04, IH * 0.36), vx: dir * rand(45, 95), vy: rand(-6, 6), ph: rand(0, 6.28), fr: rand(6, 10), sz: rand(8, 15) };
}

function updateScene(t, dt) {
  updateZombies(dt);
  /* dust */
  for (const m of sMotes) { m.p += dt * 0.5; m.x += Math.cos(m.p) * 9 * dt; m.y += Math.sin(m.p * 0.7) * 5 * dt - 3 * dt; if (m.y < -10) { m.y = IH + 10; m.x = rand(0, IW); } if (m.x > IW + 10) m.x = -10; if (m.x < -10) m.x = IW + 10; }
  /* snow */
  for (const f of sFlakes) { f.y += f.v * dt; f.w += dt; f.x += Math.sin(f.w * 0.9 + f.k * 6) * 18 * dt + 22 * dt; if (f.y > IH + 6 || f.x > IW + 10) { f.y = -6; f.x = rand(-40, IW); } }
  /* birds follow world.birds(n) */
  if (S.birds) {
    const want = Math.round(state.birdTarget * 0.6);
    while (sBirds.length < want) { const b = spawnSceneBird(); b.x = rand(0, IW); sBirds.push(b); }
    if (sBirds.length > want) sBirds.length = want;
    for (const b of sBirds) { b.x += b.vx * dt; b.y += b.vy * dt; b.ph += b.fr * dt; b.vy += Math.sin(t * 0.7 + b.fr) * 4 * dt; if (b.x < -60 || b.x > IW + 60 || b.y < 0 || b.y > IH * 0.5) Object.assign(b, spawnSceneBird()); }
  }
  /* rain */
  if (state.rain && S.rain) for (const d of sRain) { d.y += d.v * dt; d.x -= d.v * 0.16 * dt; if (d.y > IH || d.x < -20) { d.y = -20; d.x = rand(0, IW * 1.1); } }
  /* mist */
  for (const b of sBlobs) { b.x += b.v * dt; if (b.x - b.r > IW) b.x = -b.r; }
  /* ripples on water */
  if (S.ripples && Math.random() < dt * 1.4) sRipples.push({ x: rand(IW * 0.1, IW * 0.95), y: rand(IH * 0.68, IH * 0.97), r: 2, life: 1 });
  /* drips in the metro */
  if (S.drips && Math.random() < dt * 1.6) {
    const xs = [0.27, 0.3, 0.45, 0.58, 0.1];
    sDrops.push({ x: IW * (xs[Math.floor(Math.random() * xs.length)] + rand(-0.01, 0.01)), y: IH * rand(0.08, 0.2), fy: IH * rand(0.78, 0.94), v: 0 });
  }
  for (const d of sDrops) { d.v += 900 * dt; d.y += d.v * dt; if (d.y >= d.fy) { d.dead = true; sRipples.push({ x: d.x, y: d.fy, r: 1.5, life: 1 }); } }
  sDrops = sDrops.filter(d => !d.dead);
  for (const r of sRipples) { r.r += (S.drips ? 22 : 30) * dt; r.life -= dt * 0.55; }
  sRipples = sRipples.filter(r => r.life > 0);
}

function drawScene(t) {
  sctx.setTransform(sceneK, 0, 0, sceneK, 0, 0);
  sctx.clearRect(0, 0, IW, IH);
  /* mist */
  for (const b of sBlobs) {
    sctx.save(); sctx.translate(b.x, b.y); sctx.scale(1, 0.28);
    const g = sctx.createRadialGradient(0, 0, 0, 0, 0, b.r);
    g.addColorStop(0, 'rgba(210,225,225,.16)'); g.addColorStop(1, 'rgba(210,225,225,0)');
    sctx.fillStyle = g; sctx.beginPath(); sctx.arc(0, 0, b.r, 0, 6.28); sctx.fill(); sctx.restore();
  }
  /* ripples */
  sctx.lineWidth = 1.3;
  for (const r of sRipples) { sctx.strokeStyle = `rgba(220,235,240,${0.4 * r.life})`; sctx.beginPath(); sctx.ellipse(r.x, r.y, r.r, r.r * 0.28, 0, 0, 6.28); sctx.stroke(); }
  drawZombies(t);
  /* dust */
  for (const m of sMotes) { sctx.fillStyle = `rgba(240,225,190,${m.a})`; sctx.beginPath(); sctx.arc(m.x, m.y, m.s, 0, 6.28); sctx.fill(); }
  /* snow */
  if (sFlakes.length) {
    const n = Math.floor(sFlakes.length * clamp(state.snow * 1.25, 0, 1));
    for (let i = 0; i < n; i++) { const f = sFlakes[i]; sctx.fillStyle = `rgba(255,255,255,${0.4 + 0.5 * f.k})`; sctx.beginPath(); sctx.arc(f.x, f.y, f.r, 0, 6.28); sctx.fill(); }
  }
  /* drips */
  sctx.fillStyle = 'rgba(210,225,235,.8)';
  for (const d of sDrops) sctx.fillRect(d.x - 0.8, d.y - 5, 1.6, 6);
  /* birds */
  for (const b of sBirds) drawBirdShape(sctx, b, false);
  /* lamps */
  const lit = S.alwaysLit ? 1 : lightLevel;
  if (lit > 0.01) {
    sctx.globalCompositeOperation = 'lighter';
    S.lamps.forEach(([fx_, fy_, r], i) => {
      let a = lit * state.power * (0.55 + 0.2 * Math.sin(t * 2.6 + i * 1.7));
      if (S.alwaysLit && Math.sin(t * 1.1 + i * 5.3) > 0.965) a *= 0.2;   // failing bulbs
      let [cr, cg, cb] = state.lamp;
      if (state.alarm && S.alwaysLit) { const p = 0.5 + 0.5 * Math.sin(t * 6); cr = 255; cg = 40 + 30 * p; cb = 30; a *= 0.5 + 0.9 * p; }
      const x = fx_ * IW, y = fy_ * IH;
      const g = sctx.createRadialGradient(x, y, 0, x, y, r * (state.alarm && S.alwaysLit ? 1.5 : 1));
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`); g.addColorStop(0.35, `rgba(${cr},${cg * 0.83 | 0},${cb * 0.67 | 0},${a * 0.35})`); g.addColorStop(1, `rgba(${cr},${cg * 0.7 | 0},${cb * 0.4 | 0},0)`);
      sctx.fillStyle = g; sctx.beginPath(); sctx.arc(x, y, r * (state.alarm && S.alwaysLit ? 1.5 : 1), 0, 6.28); sctx.fill();
    });
    sctx.globalCompositeOperation = 'source-over';
  }
  /* rain */
  if (state.rain && S.rain) {
    sctx.strokeStyle = 'rgba(200,218,232,.4)'; sctx.lineWidth = 1.1; sctx.beginPath();
    for (const d of sRain) { sctx.moveTo(d.x, d.y); sctx.lineTo(d.x - d.l * 0.16, d.y - d.l); }
    sctx.stroke();
  }
}

/* ============================================================
   ENTER / LEAVE A LOCATION  (the "pull")
   ============================================================ */
/* ---------- zombies: one sprite per row of the `zombies` table ---------- */
const ZKINDS = [{name:"drifter",frames:16,w:243,h:360}, {name:"lady",frames:16,w:229,h:356}, {name:"cop",frames:16,w:228,h:362}, {name:"builder",frames:16,w:233,h:366}, {name:"soldier",frames:16,w:238,h:359}, {name:"trapper",frames:16,w:232,h:360}, {name:"medic",frames:16,w:231,h:360}, {name:"brute",frames:16,w:264,h:380}, {name:"clerk",frames:16,w:233,h:358}, {name:"kid",frames:16,w:188,h:317}, {name:"walker",frames:16,w:313,h:381}];                              // [{name, frames, w, h}] — sprites live in assets/zombies/<name>_<frame>.webp
const ZREF_H = 342;   // body height of the reference sprite (sprites are cropped tightly, so this keeps the scale)
const zKindByName = Object.fromEntries(ZKINDS.map(k => [k.name, k]));
for (const k of ZKINDS) k.imgs = Array.from({ length: k.frames }, (_, i) => { const im = new Image(); im.src = `assets/zombies/${k.name}_${i}.webp`; return im; });
const ZMAX = 5;                                        // the swamp never holds more than this
const reflC = document.createElement('canvas'), reflX = reflC.getContext('2d');
const bodyC = document.createElement('canvas'), bodyX = bodyC.getContext('2d');
let zombies = [], dyingZ = [], sceneShown = false;
const Z_HORIZON = 0.56, Z_MIN_Y = 0.665, Z_MAX_Y = 0.775;   // they stay in the far part of the flooded street
const zHeight = yf => (yf - Z_HORIZON) * 1.25 * IH;         // perspective: lower on screen = closer = bigger
/* The walkable water of the flooded street (fractions of the image). Everything outside it is
   houses, the boat, mooring posts and the far end of the street — zombies turn around at the edge.
   Open the page with #debug in the URL to see this outline. */
const WALK = [[0.385, 0.655], [0.775, 0.655], [0.80, 0.70], [0.80, 0.785], [0.40, 0.785], [0.37, 0.72]];
const DEBUG = location.hash === '#debug';
function inWalk(x, y) {                                      // x, y in image units
  const px = x / IW, py = y / IH; let c = false;
  for (let i = 0, j = WALK.length - 1; i < WALK.length; j = i++) {
    const [xi, yi] = WALK[i], [xj, yj] = WALK[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const kindOf = z => zKindByName[z.kind] || ZKINDS[z.id % ZKINDS.length];
function zUnits(z) { const k = kindOf(z), h = zHeight(z.y) * k.h / ZREF_H; return { k, h, w: h * k.w / k.h }; }

/* scatter = already standing somewhere in the water; otherwise it rises out of the water at the far end of the street */
function makeZombie(row, scatter) {
  const z = { id: row.id, name: row.name, kind: row.kind, speed: row.speed, dir: Math.random() < 0.5 ? 1 : -1,
    x: 0, y: 0, phase: Math.random(), hl: 0, sink: 0, rise: 0, pause: 0, turn: false, ty: rand(Z_MIN_Y, Z_MAX_Y), wt: rand(2, 6) };
  if (scatter) {
    const xs = WALK.map(p => p[0]), x0 = Math.min(...xs) * IW, x1 = Math.max(...xs) * IW;
    for (let tries = 0; tries < 40; tries++) {
      z.x = x0 + (((row.id * 0.618) + tries * 0.137) % 1) * (x1 - x0); z.y = rand(Z_MIN_Y, Z_MAX_Y);
      if (inWalk(z.x, z.y * IH) && inWalk(z.x - 40, z.y * IH) && inWalk(z.x + 40, z.y * IH)) break;
    }
  } else {
    z.x = rand(0.5, 0.66) * IW; z.y = Z_MIN_Y + 0.01; z.rise = 1;
    for (const dx of [0, 14]) sRipples.push({ x: z.x + dx, y: z.y * IH, r: 2 + dx, life: 1 });
  }
  return z;
}
/* make the sprites match the table (spawn new rows, drown deleted ones, refresh speed / skin) */
function syncZombies(rows) {
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const z of zombies) {
    const r = byId.get(z.id);
    if (r) { z.speed = r.speed; z.name = r.name; z.kind = r.kind; } else { z.dying = true; dyingZ.push(z); }
  }
  zombies = zombies.filter(z => !z.dying);
  const have = new Set(zombies.map(z => z.id));
  const initial = have.size === 0;                       // first fill: they're already standing in the water; later ones rise out of it
  for (const r of rows) if (!have.has(r.id)) zombies.push(makeZombie(r, initial || !sceneShown));
}
function updateZombies(dt) {
  for (const z of zombies) {
    const pace = z.speed * 16, { h, w } = zUnits(z);
    z.hl = Math.max(0, z.hl - dt);
    z.rise = Math.max(0, z.rise - dt * 0.5);
    if (z.pause > 0) {                                    // stopped at a barrier: stand for a moment, then turn around
      z.pause -= dt;
      if (z.pause <= 0 && z.turn) { z.dir *= -1; z.turn = false; z.ty = rand(Z_MIN_Y, Z_MAX_Y); }
      continue;
    }
    if (pace <= 0 || z.rise > 0.6) continue;
    /* drift slowly in depth, and keep apart from neighbours */
    z.wt -= dt; if (z.wt <= 0) { z.ty = rand(Z_MIN_Y, Z_MAX_Y); z.wt = rand(4, 9); }
    for (const o of zombies) if (o !== z && Math.abs(o.x - z.x) < w * 0.55 && Math.abs(o.y - z.y) < 0.025) z.ty = clamp(z.y + (z.y >= o.y ? 0.05 : -0.05), Z_MIN_Y, Z_MAX_Y);
    const ny = z.y + clamp(z.ty - z.y, -0.012 * dt, 0.012 * dt);
    const nx = z.x + z.dir * pace * dt, look = nx + z.dir * w * 0.22;   // look ahead so the body stays off the walls
    let moved = 0;
    if (inWalk(look, ny * IH) && inWalk(nx, ny * IH)) { moved = Math.abs(nx - z.x); z.x = nx; z.y = ny; }
    else if (inWalk(look, z.y * IH) && inWalk(nx, z.y * IH)) { moved = Math.abs(nx - z.x); z.x = nx; }
    else { z.pause = rand(0.6, 1.1); z.turn = true; continue; }
    const before = z.phase; z.phase += moved / (h * 0.55);   // animation follows distance walked, so feet don't skate
    if (Math.floor(z.phase * 2) !== Math.floor(before * 2) && sRipples.length < 90)
      sRipples.push({ x: z.x - z.dir * h * 0.1, y: z.y * IH - h * 0.27, r: 2, life: 0.9 });   // a wake ring with every step
  }
  for (const z of dyingZ) { z.sink += dt * 0.7; z.phase += dt * 0.3; }
  dyingZ = dyingZ.filter(z => z.sink < 1);
}
/* a faint, rippling mirror image just under the waterline */
function drawReflection(img, w, h, cut, t, z) {
  const iw = img.width, ih = img.height, band = Math.round(ih * 0.42), wl = ih * 0.73;
  if (reflC.width !== iw || reflC.height !== band) { reflC.width = iw; reflC.height = band; }
  reflX.globalCompositeOperation = 'source-over'; reflX.setTransform(1, 0, 0, 1, 0, 0); reflX.clearRect(0, 0, iw, band);
  reflX.setTransform(1, 0, 0, -1, 0, wl); reflX.drawImage(img, 0, 0); reflX.setTransform(1, 0, 0, 1, 0, 0);
  reflX.globalCompositeOperation = 'destination-in';
  const g = reflX.createLinearGradient(0, 0, 0, band); g.addColorStop(0, 'rgba(0,0,0,.34)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  reflX.fillStyle = g; reflX.fillRect(0, 0, iw, band);
  const bandH = band / ih * h, N = 12, sh = bandH / N, sn = band / N;
  for (let s = 0; s < N; s++) {
    const dx = Math.sin(t * 2.2 + s * 0.8 + z.id) * w * 0.012 * (1 + s * 0.3);
    sctx.drawImage(reflC, 0, s * sn, iw, sn, -w / 2 + dx, -cut + s * sh, w, sh + 0.6);
  }
}
function drawZombies(t) {
  const list = [...zombies, ...dyingZ].sort((a, b) => a.y - b.y);
  for (const z of list) {
    const { k, h, w } = zUnits(z), n = k.frames;
    if (!k.imgs[0].complete || !k.imgs[0].naturalWidth) continue;
    const moving = ((z.speed > 0 && z.pause <= 0 && z.rise < 0.6) || z.dying);
    const p = moving ? (((z.phase % 1) + 1) % 1) * n : 0;
    const i = Math.floor(p) % n, f = p - Math.floor(p);
    const img = k.imgs[i], img2 = k.imgs[(i + 1) % n];
    const feetY = z.y * IH + Math.max(z.sink, z.rise) * h * 0.3;
    const bob = moving ? -(0.5 - 0.5 * Math.cos(z.phase * 4 * Math.PI)) * h * 0.014 : Math.sin(t * 1.3 + z.id) * h * 0.004;
    const sway = moving ? Math.sin(z.phase * 2 * Math.PI) * 0.018 : Math.sin(t * 0.9 + z.id) * 0.008;
    const cut = h * 0.27;                               // knee-deep in the water
    const alpha = z.dying ? Math.max(0, 1 - z.sink * 1.1) : 1 - z.rise * 0.85;
    sctx.save();
    sctx.globalAlpha = alpha;
    /* compose the sprite off-screen: cross-fade into the next frame (smoother steps) + a damp, cold tint so it sits in the scene's light */
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (bodyC.width !== iw || bodyC.height !== ih) { bodyC.width = iw; bodyC.height = ih; }
    bodyX.globalCompositeOperation = 'source-over'; bodyX.globalAlpha = 1; bodyX.clearRect(0, 0, iw, ih);
    bodyX.drawImage(img, 0, 0);
    if (moving && f > 0.03 && n < 8) { bodyX.globalAlpha = f; bodyX.drawImage(img2, 0, 0); bodyX.globalAlpha = 1; }
    bodyX.globalCompositeOperation = 'source-atop';
    const tg = bodyX.createLinearGradient(0, 0, 0, ih); tg.addColorStop(0, 'rgba(20,42,55,.2)'); tg.addColorStop(1, 'rgba(8,38,48,.5)');
    bodyX.fillStyle = tg; bodyX.fillRect(0, 0, iw, ih);

    sctx.translate(z.x, feetY + bob);
    if (z.dir < 0) sctx.scale(-1, 1);
    drawReflection(bodyC, w, h, cut, t, z);
    /* the body above the waterline */
    sctx.beginPath(); sctx.rect(-w, -h * 1.15, w * 2, h * 1.15 - cut); sctx.clip();
    sctx.rotate(sway);
    if (z.hl > 0) { sctx.shadowColor = 'rgba(140,255,150,.95)'; sctx.shadowBlur = 16 + 8 * Math.sin(t * 8); }
    sctx.drawImage(bodyC, -w / 2, -h, w, h);
    sctx.shadowBlur = 0;
    sctx.restore();
    /* ring at the waterline + label */
    const wy = feetY + bob - cut, rx = w * (0.24 + 0.02 * Math.sin(t * 2 + z.id));
    sctx.strokeStyle = `rgba(215,238,238,${0.3 * alpha})`; sctx.lineWidth = 1.3;
    sctx.beginPath(); sctx.ellipse(z.x, wy, rx, rx * 0.2, 0, 0, 6.28); sctx.stroke();
    if (!z.dying) {
      const fs = 11 + h * 0.03;
      sctx.font = `500 ${fs}px "IBM Plex Mono",monospace`; sctx.textAlign = 'center';
      const label = `#${z.id} ${z.name}`;
      const tw_ = sctx.measureText(label).width + 12;
      const ly = feetY + bob - h * 0.97 - 6;
      sctx.fillStyle = z.hl > 0 ? 'rgba(20,60,25,.88)' : 'rgba(8,10,9,.7)';
      sctx.fillRect(z.x - tw_ / 2, ly - fs - 3, tw_, fs + 8);
      sctx.fillStyle = z.hl > 0 ? '#9dff9d' : '#d6d0be';
      sctx.fillText(label, z.x, ly);
    }
  }
  if (DEBUG) {                                          // outline of the walkable water
    sctx.strokeStyle = 'rgba(255,60,60,.9)'; sctx.lineWidth = 2; sctx.beginPath();
    WALK.forEach(([x, y], i) => (i ? sctx.lineTo(x * IW, y * IH) : sctx.moveTo(x * IW, y * IH))); sctx.closePath(); sctx.stroke();
  }
}

const enteringEl = $('#entering'), backBtn = $('#back'), infoBtn = $('#info-toggle');
const maxR = () => Math.hypot(vw, vh) / 2 * 1.05;
const clipAnim = (from, to, dur, easing) => sceneEl.animate(
  [{ clipPath: `circle(${from}px at 50% 50%)` }, { clipPath: `circle(${to}px at 50% 50%)` }],
  { duration: dur, easing, fill: 'both' });

function preload() { for (const z of ZONES) { const i = new Image(); i.src = SCENES[z.id].img; } }
const sceneDecoded = async () => { try { await imgEl.decode(); } catch (_) { } };

async function enterZone(id) {
  if (busy) return;
  const z = ZONES.find(z => z.id === id);
  busy = true;
  hidePanel();
  if (mode === 'scene') { await leaveZone(true); busy = true; }
  current = z; mode = 'diving';
  prepareScene(z); sizeScene();
  document.body.classList.add('diving');
  enteringEl.querySelector('small').textContent = z.lang;
  enteringEl.querySelector('b').textContent = z.name;
  setTimeout(() => enteringEl.classList.add('on'), T(250));

  /* the dive: keep the zone under a fixed point and zoom in with acceleration */
  const diveDur = T(1900);
  const dive = tweenCam(z, coverScale() * 7, { x: vw / 2, y: vh / 2 }, diveDur, easeInCubic);

  /* image decodes while we fall */
  await sceneDecoded();
  await wait(diveDur * 0.68 - 0);
  sceneEl.style.display = 'block';
  const reveal = clipAnim(0, maxR(), T(1100), 'cubic-bezier(.35,.05,.15,1)');
  reveal.finished.then(() => reveal.cancel());
  zoomEl.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: T(1800), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
  enteringEl.classList.remove('on');
  await dive;
  await wait(T(500));

  mode = 'scene'; sceneShown = true;
  document.body.classList.add('in-scene');
  backBtn.hidden = false; infoBtn.hidden = false;
  openPanel(ZONE_HTML[z.id](z), z.color);
  ZONE_INIT[z.id] && ZONE_INIT[z.id]();
  busy = false;
}

async function leaveZone(quick = false) {
  if (mode !== 'scene' && !quick) return;
  busy = true; mode = 'leaving';
  hidePanel(); if (zoneCleanup) { zoneCleanup(); zoneCleanup = null; }
  backBtn.hidden = true; infoBtn.hidden = true;
  document.body.classList.remove('in-scene', 'immersive');
  const z = current;
  /* scene collapses back into a point while the camera pulls out */
  const clip = clipAnim(maxR(), 0, T(quick ? 600 : 1000), 'cubic-bezier(.5,0,.8,.4)');
  overview();
  const to = { x: tgt.x + z.x * MAP_W * tgt.s, y: tgt.y + z.y * MAP_H * tgt.s };
  const back = tweenCam(z, tgt.s, to, T(quick ? 900 : 1500), easeOutCubic);
  document.body.classList.remove('diving');
  await clip.finished;
  sceneEl.style.display = 'none'; clip.cancel();
  await back;
  mode = 'map'; current = null; busy = false;
  cam.x = tgt.x; cam.y = tgt.y; cam.s = tgt.s;
}

/* ============================================================
   MARKERS + MAIN LOOP
   ============================================================ */
const markersEl = $('#markers');
for (const z of ZONES) {
  const b = document.createElement('button');
  b.className = 'marker'; b.style.left = z.x * 100 + '%'; b.style.top = z.y * 100 + '%'; b.style.setProperty('--c', z.color);
  b.innerHTML = `<span class="pin"></span><span class="tag">${z.lang}</span>`;
  b.setAttribute('aria-label', `${z.name} — ${z.lang}`);
  b.addEventListener('click', () => enterZone(z.id));
  markersEl.append(b);
}
const chips = $('#chips');
for (const z of ZONES) {
  const c = document.createElement('button');
  c.className = 'chip'; c.style.setProperty('--c', z.color);
  c.innerHTML = `<i></i>${z.lang}`;
  c.addEventListener('click', () => enterZone(z.id));
  chips.append(c);
}
backBtn.addEventListener('click', () => leaveZone());

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  updateLight(dt);

  if (tw) {
    const u = clamp((now - tw.t0) / tw.dur, 0, 1), e = tw.ease(u);
    const s = tw.s0 * Math.pow(tw.s1 / tw.s0, e);
    const sx = lerp(tw.sx0, tw.sx1, e), sy = lerp(tw.sy0, tw.sy1, e);
    cam.s = s; cam.x = sx - tw.zone.x * MAP_W * s; cam.y = sy - tw.zone.y * MAP_H * s;
    if (u >= 1) { const r = tw.res; tw = null; r(); }
  } else if (mode === 'map') {
    const k = 1 - Math.pow(0.0008, dt);
    cam.x += (tgt.x - cam.x) * k; cam.y += (tgt.y - cam.y) * k; cam.s += (tgt.s - cam.s) * k;
  }

  if (mode !== 'scene') {
    worldEl.style.transform = `translate3d(${cam.x}px,${cam.y}px,0) scale(${cam.s})`;
    const inv = (1 / cam.s).toFixed(4);
    markersEl.style.setProperty('--inv', inv);
    updateMapFx(t, dt); drawMapFx(t);
  }
  if (sceneEl.style.display === 'block') {
    par.x += (par.tx - par.x) * Math.min(1, dt * 2.5); par.y += (par.ty - par.y) * Math.min(1, dt * 2.5);
    const breathe = 1.012 + 0.01 * Math.sin(t * 0.25);
    innerEl.style.transform = `translate3d(${(-par.x * 16).toFixed(2)}px,${(-par.y * 10).toFixed(2)}px,0) scale(${breathe.toFixed(4)})`;
    updateScene(t, dt); drawScene(t);
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   PANELS
   ============================================================ */
const body = $('#panel-body');
function openPanel(html, color) {
  body.innerHTML = html;
  panel.style.setProperty('--c', color || '#c8693a');
  panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  panel.scrollTop = 0;
  syncInfoBtn();
}
function hidePanel() {
  panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on'));
  syncInfoBtn();
}
/* inside a location the panel can be tucked away to enjoy the scene */
function syncInfoBtn() {
  const open = panel.classList.contains('open');
  document.body.classList.toggle('immersive', mode === 'scene' && !open);
  infoBtn.textContent = open ? 'Hide panel  ✕' : 'Show info  ⓘ';
  infoBtn.setAttribute('aria-expanded', String(open));
}
function togglePanel() {
  if (mode !== 'scene') return;
  if (panel.classList.contains('open')) hidePanel();
  else { panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); syncInfoBtn(); }
}
infoBtn.addEventListener('click', togglePanel);
function closePanel() { if (mode === 'scene') togglePanel(); else hidePanel(); }
$('#close').addEventListener('click', closePanel);
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (mode === 'scene') { if (panel.classList.contains('open')) hidePanel(); else leaveZone(); }
  else if (panel.classList.contains('open')) hidePanel();
});

const SECTIONS = {
  about: () => `
    <p class="kicker">About</p><h2>Hi, I'm Mark.</h2>
    <p>I started programming because I love to create things and see the result come alive. For two years now I've been building small projects, from web apps to APIs, and every one of them taught me something new.</p>
    <p class="note">I'm at the beginning of the road, and I know it. What I bring is curiosity, patience and the habit of finishing what I start, and I'm always ready to learn.</p>
    <h3>How to read this site</h3>
    <p>Four apocalypses, four languages. Pick a marker on the map and the camera pulls you into that place. Each one lets you try the tech yourself, right here in the browser.</p>`,
  projects: () => `
    <p class="kicker">Projects</p><h2>Artifacts found</h2>
    <p>Every project is an object left behind somewhere in the world. Open one to see the code.</p>
    <div class="cards">
      <a class="card" href="https://github.com/MarkJur-afk/FunktsUurimine" target="_blank" rel="noopener"><b>FunktsUurimine</b><p>A web app that investigates a mathematical function: type a formula like <code>x^2-6*x+9</code> and get its derivative, zeros, extrema and a plotted graph.</p><small>C# · ASP.NET Core MVC (.NET 8) · SQLite</small></a>
      <a class="card" href="https://github.com/MarkJur-afk/JWT-Mini-API" target="_blank" rel="noopener"><b>JWT Mini-API</b><p>A small learning API that shows how token authentication works: log in, get a signed token, reach protected endpoints, and see 401 and 403 for the wrong visitors.</p><small>Python · Flask · PyJWT</small></a>
      <a class="card" href="https://github.com/MarkJur-afk/CityExplorer" target="_blank" rel="noopener"><b>CityExplorer</b><p>A project about exploring a city. The full story lives in the repository.</p><small>GitHub</small></a>
    </div>`,
  skills: () => `
    <p class="kicker">Skills &amp; experience</p><h2>Territories</h2>
    <p>Two years of hands-on practice, learning fastest by building. Tap a region to be pulled in.</p>
    <div class="stack">${ZONES.map(z => `<button data-zone="${z.id}">${z.lang}</button>`).join('')}</div>
    <h3>Where I'm at</h3>
    <ul>
      <li><b>Python</b> — Flask, JWT authentication, small APIs.</li>
      <li><b>C#</b> — ASP.NET Core MVC on .NET 8, working with a database.</li>
      <li><b>SQL</b> — SQLite: tables, queries, migrations.</li>
      <li><b>JS / HTML / CSS</b> — this very site.</li>
    </ul>
    <p class="note">Beginner level, honestly. Always ready to learn, and to get better with every project.</p>`,
  contact: () => `
    <p class="kicker">Contact</p><h2>Send a signal</h2>
    <p>Radio's on. I read everything.</p>
    <ul>
      <li>Email — <a href="mailto:markjurgennn@gmail.com">markjurgennn@gmail.com</a></li>
      <li>GitHub — <a href="https://github.com/MarkJur-afk" target="_blank" rel="noopener">github.com/MarkJur-afk</a></li>
    </ul>`,
};
$('#nav').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b || busy) return;
  if (mode === 'scene') await leaveZone();
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  openPanel(SECTIONS[b.dataset.section](), '#c8693a');
});
body.addEventListener('click', e => { const b = e.target.closest('[data-zone]'); if (b) enterZone(b.dataset.zone); });

const ZONE_HTML = {
  python: z => `
    <p class="kicker">${z.lang} · ${z.name}</p>
    <h2>The city where everything has settled</h2>
    <p>Nobody's been here for years. The weather is mild, the streets are quiet. <code>world</code> is a module you can import — and it controls the sky, the lights and the weather around you.</p>
    <div class="term">
      <div class="term-bar"><span>quiet_city.py</span><span id="py-status">loading Python…</span></div>
      <textarea id="py-code" spellcheck="false" aria-label="Python code">import world

world.time("dusk")      # "day", "dusk" or "night"
world.birds(40)         # how many birds fly over the city
world.lights(True)      # lanterns and windows light up

for n in range(3):
    print("signal", n, "— the city is listening")</textarea>
      <pre id="py-out" aria-live="polite">Run the code (Ctrl/Cmd + Enter).</pre>
    </div>
    <div class="row">
      <button class="btn" id="py-run" disabled>▶ Run</button>
      <button class="btn ghost" id="py-reset">Reset world</button>
    </div>
    <h3>The <code>world</code> module</h3>
    <ul>
      <li><code>world.time("day" | "dusk" | "night")</code></li>
      <li><code>world.birds(n)</code> — 0 to 120</li>
      <li><code>world.lights(True)</code></li>
      <li><code>world.rain(True)</code></li>
    </ul>
    <p class="note">This is real CPython running in your browser (Pyodide / WebAssembly). Nothing is sent to a server.</p>`,

  csharp: z => `
    <p class="kicker">${z.lang} · ${z.name}</p>
    <h2>Everything is buried in snow</h2>
    <p>A quiet, endless snowfall. The lantern is dark and waiting for someone to write the code that lights it.</p>
    <div class="slider"><span>Snowfall</span><input id="snow-range" type="range" min="0" max="100" value="${Math.round(state.snow * 100)}" aria-label="Snowfall intensity"><span id="snow-val">${Math.round(state.snow * 100)}%</span></div>
    <div class="term">
      <div class="term-bar"><span>Lantern.cs</span><span id="cs-status">ready</span></div>
      <textarea id="cs-code" spellcheck="false" aria-label="C# code"></textarea>
      <pre id="cs-out" aria-live="polite">Run the code (Ctrl/Cmd + Enter).</pre>
    </div>
    <div class="row"><button class="btn" id="cs-run">▶ Run</button><button class="btn ghost" id="cs-reset">Reset code</button><button class="btn ghost" id="cs-world">Reset world</button></div>
    <h3>What it understands</h3>
    <p>Classes, methods, properties, <code>List&lt;T&gt;</code>, arrays, loops, <code>$"interpolation"</code>, <code>try/catch</code>, <code>Console</code>, <code>Math</code>, <code>Random</code>. The village is yours through <code>World</code>:</p>
    <ul>
      <li><code>World.Lights(true)</code> lights the lantern</li>
      <li><code>World.Time("night")</code> day, dusk or night</li>
      <li><code>World.Snow(0.8)</code> snowfall 0 to 1</li>
      <li><code>World.Birds(10)</code>, <code>World.Rain(true)</code></li>
    </ul>
    <p class="note">Honest note: this is a small C# interpreter written for this site, not the full .NET runtime. No LINQ or <code>Dictionary</code>, and integer division works like in JavaScript.</p>`,

  web: z => `
    <p class="kicker">${z.lang} · ${z.name}</p>
    <h2>The metro, long after the last train</h2>
    <p>Emergency lamps flicker in the tunnels. Here the "language" is the page itself: HTML for the structure, CSS for the light, JavaScript for the movement.</p>
    <div class="term">
      <div class="term-bar"><span id="mt-tabs"><button class="mt-tab on" data-t="html">HTML</button><button class="mt-tab" data-t="css">CSS</button><button class="mt-tab" data-t="js">JS</button></span><span id="mt-status">live</span></div>
      <textarea id="mt-code" spellcheck="false" aria-label="Code editor"></textarea>
      <iframe id="mt-frame" sandbox="allow-scripts" title="Live preview" style="width:100%;height:190px;border:0;border-top:1px solid var(--line);background:#0b0d0c"></iframe>
    </div>
    <div class="row"><button class="btn ghost" id="mt-reset">Reset code</button></div>
    <h3>What you can control</h3>
    <p>Your code runs in an isolated sandbox. It can talk to the tunnel through <code>metro</code>:</p>
    <ul>
      <li><code>metro.color("#7fd1ff")</code> sets the lamp colour</li>
      <li><code>metro.power(0.2)</code> dims or boosts the lamps (0 to 1.5)</li>
      <li><code>metro.alarm(true)</code> starts the red alarm</li>
    </ul>
    <p class="note">Edit anything: the preview updates as you type, and the real tunnel behind this panel reacts.</p>`,

  sql: z => `
    <p class="kicker">${z.lang} · ${z.name}</p>
    <h2>They're not dead. They're rows.</h2>
    <p>Every figure wading through the flood is a row in the <code>zombies</code> table. A <code>SELECT</code> finds them, an <code>UPDATE</code> changes them, a <code>DELETE</code> is decisive.</p>
    <div class="term">
      <div class="term-bar"><span>swamp.sql</span><span id="sql-status">loading SQLite…</span></div>
      <textarea id="sql-code" spellcheck="false" aria-label="SQL query">SELECT * FROM zombies WHERE speed > 3;</textarea>
      <div id="sql-out" class="sql-out" aria-live="polite">Run a query (Ctrl/Cmd + Enter).</div>
      <div class="zcount"><label for="zcount">Zombies in the swamp</label><input id="zcount" type="range" min="0" max="${ZMAX}" step="1" value="3" disabled aria-label="Number of zombies, 0 to ${ZMAX}"><b id="zcount-val">3</b></div>
    </div>
    <div class="row">
      <button class="btn" id="sql-run" disabled>▶ Run</button>
      <button class="btn ghost" id="sql-reset" disabled>Reset swamp</button>
    </div>
    <h3>Try</h3>
    <div class="stack" id="sql-examples">
      <button data-q="SELECT * FROM zombies WHERE speed > 3;">Find the fast ones</button>
      <button data-q="UPDATE zombies SET speed = 1;">Slow them all</button>
      <button data-q="UPDATE zombies SET speed = 0 WHERE hp < 40;">Freeze the weak</button>
      <button data-q="UPDATE zombies SET kind = 'cop' WHERE id = 1;">Change a skin</button>
      <button data-q="DELETE FROM zombies WHERE speed > 3;">Cull the fast</button>
      <button data-q="INSERT INTO zombies (name, speed, hp) VALUES ('Mark', 4, 100);">Summon one</button>
    </div>
    <h3>Schema</h3>
    <p><code>zombies (id, name, kind, speed, hp)</code></p>
    <p>The swamp holds at most ${ZMAX} zombies. <code>kind</code> picks the look: ${ZKINDS.map(k => `<code>${k.name}</code>`).join(' ')}.</p>
    <p class="note">Real SQLite running in your browser (WebAssembly). The sprites on the left are rebuilt from the table after every query.</p>`,
};

let zoneCleanup = null;
const ZONE_INIT = {
  python() {
    const run = $('#py-run'), status = $('#py-status'), out = $('#py-out'), code = $('#py-code');
    const write = (s, cls) => { const sp = document.createElement('span'); if (cls) sp.className = cls; sp.textContent = s + '\n'; out.append(sp); out.scrollTop = out.scrollHeight; };
    code.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); const s = code.selectionStart; code.setRangeText('    ', s, code.selectionEnd, 'end'); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run.click(); }
    });
    $('#py-reset').addEventListener('click', () => worldAPI.reset());
    loadPyodideOnce().then(py => {
      status.textContent = 'Python ready';
      run.disabled = false;
      run.onclick = async () => {
        run.disabled = true; out.textContent = '';
        py.setStdout({ batched: s => write(s) });
        py.setStderr({ batched: s => write(s, 'err') });
        try { await py.runPythonAsync(code.value); }
        catch (err) { write(String(err.message || err).split('\n').slice(-4).join('\n'), 'err'); }
        run.disabled = false;
      };
    }).catch(() => {
      status.textContent = 'failed to load';
      out.textContent = 'Could not load the Python runtime (assets/vendor/pyodide failed to load).';
    });
  },
  web() {
    const START = {
      html: `<div class="panel">\n  <div class="lamp" id="lamp"></div>\n  <p id="msg">Tunnel 7 \u2014 power nominal</p>\n  <button id="alarm">Trigger alarm</button>\n  <input id="hue" type="range" min="0" max="360" value="35">\n</div>`,
      css: `body { margin: 0; display: grid; place-items: center; height: 100vh;\n       background: #0b0d0c; color: #cfc9b7; font: 14px monospace; }\n.panel { text-align: center; }\n.lamp { width: 54px; height: 54px; margin: 0 auto 10px; border-radius: 50%;\n        background: var(--c, #ffcd78); box-shadow: 0 0 30px var(--c, #ffcd78); }\nbutton { background: none; color: inherit; border: 1px solid #777; padding: 6px 14px; cursor: pointer; }\ninput { display: block; margin: 12px auto 0; width: 70%; }`,
      js: `let on = false;\nconst lamp = document.getElementById('lamp');\nfunction setHue(h) {\n  const c = 'hsl(' + h + ' 90% 65%)';\n  lamp.style.setProperty('--c', c);\n  metro.color(c);               // the tunnel lamps follow\n}\ndocument.getElementById('hue').oninput = e => setHue(e.target.value);\ndocument.getElementById('alarm').onclick = () => {\n  on = !on;\n  metro.alarm(on);              // red alarm in the real tunnel\n  document.getElementById('msg').textContent = on ? 'ALARM \u2014 evacuate' : 'Tunnel 7 \u2014 power nominal';\n};`,
    };
    let src = { ...START }, tab = 'html';
    const ta = $('#mt-code'), fr = $('#mt-frame'), stat = $('#mt-status');
    const BRIDGE = `<script>const metro={color:c=>parent.postMessage({metro:'color',v:String(c)},'*'),power:p=>parent.postMessage({metro:'power',v:+p},'*'),alarm:a=>parent.postMessage({metro:'alarm',v:!!a},'*')};window.onerror=m=>parent.postMessage({metro:'error',v:String(m)},'*');<\/script>`;
    const build = () => {
      stat.textContent = 'live'; worldAPI.reset(); state.lights = true;
      fr.srcdoc = `<!doctype html><meta charset="utf-8"><style>${src.css}</style>${src.html}${BRIDGE}<script>try{${src.js}\n}catch(e){parent.postMessage({metro:'error',v:String(e)},'*')}<\/script>`;
    };
    const show = () => { ta.value = src[tab]; document.querySelectorAll('.mt-tab').forEach(b => b.classList.toggle('on', b.dataset.t === tab)); };
    let timer = 0;
    ta.addEventListener('input', () => { src[tab] = ta.value; clearTimeout(timer); timer = setTimeout(build, 350); });
    ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); } });
    $('#mt-tabs').addEventListener('click', e => { if (e.target.dataset.t) { tab = e.target.dataset.t; show(); } });
    $('#mt-reset').addEventListener('click', () => { src = { ...START }; show(); build(); });
    const onMsg = e => {
      if (e.source !== fr.contentWindow || !e.data || typeof e.data !== 'object') return;
      const { metro: k, v } = e.data;
      if (k === 'color') {                                  // resolve any CSS colour through a canvas
        const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#ffcd78'; c.fillStyle = v; c.fillRect(0, 0, 1, 1);
        const d = c.getImageData(0, 0, 1, 1).data; state.lamp = [d[0], d[1], d[2]];
      } else if (k === 'power') state.power = clamp(Number(v) || 0, 0, 1.5);
      else if (k === 'alarm') state.alarm = !!v;
      else if (k === 'error') stat.textContent = 'error: ' + String(v).slice(0, 80);
    };
    window.addEventListener('message', onMsg);
    state.lights = true; show(); build();
    zoneCleanup = () => { window.removeEventListener('message', onMsg); worldAPI.reset(); };
  },
  csharp() {
    const r = $('#snow-range'), v = $('#snow-val');
    r.addEventListener('input', () => { state.snow = r.value / 100; v.textContent = r.value + '%'; });
    const START = `using System;

class Lantern
{
    static void Main()
    {
        Console.WriteLine("The lantern is dark...");
        for (int i = 1; i <= 3; i++)
        {
            Console.WriteLine($"Spark {i}");
        }
        World.Lights(true);
        World.Time("dusk");
        Console.WriteLine("Lantern lit.");
    }
}`;
    const ta = $('#cs-code'), out = $('#cs-out'), run = $('#cs-run'), stat = $('#cs-status');
    ta.value = START;
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end'); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run.click(); }
    });
    const write = (s, cls) => { const sp = document.createElement('span'); if (cls) sp.className = cls; sp.textContent = s + '\n'; out.append(sp); out.scrollTop = out.scrollHeight; };
    let worker = null, timer = 0;
    const stop = () => { clearTimeout(timer); if (worker) { worker.terminate(); worker = null; } run.disabled = false; };
    zoneCleanup = stop;
    run.onclick = () => {
      stop(); out.textContent = '';
      const c = CSharp.compile(ta.value);
      if (c.error) { write(c.error, 'err'); stat.textContent = 'compile error'; return; }
      stat.textContent = 'running…'; run.disabled = true;
      const url = URL.createObjectURL(new Blob([CSharp.RUNTIME + '\ntry {\n' + c.js + '\n} catch (e) { postMessage({ t: "err", s: (e && e.name ? e.name + ": " : "") + (e && e.message || e) }); }\nif (__line) __out(__line);\npostMessage({ t: "done" });'], { type: 'text/javascript' }));
      worker = new Worker(url); URL.revokeObjectURL(url);
      worker.onmessage = e => {
        const m = e.data;
        if (m.t === 'out') write(m.s);
        else if (m.t === 'err') write(m.s, 'err');
        else if (m.t === 'world') { try { if (typeof worldAPI[String(m.fn).toLowerCase()] !== 'function') throw new Error('World has no ' + m.fn + '()'); worldAPI[String(m.fn).toLowerCase()](...m.args); } catch (err) { write(String(err.message), 'err'); } }
        else if (m.t === 'done') { stat.textContent = 'finished'; stop(); }
      };
      worker.onerror = e => { write('Runtime error: ' + e.message, 'err'); stat.textContent = 'error'; stop(); };
      timer = setTimeout(() => { write('Stopped: the program ran longer than 4 seconds (infinite loop?).', 'err'); stat.textContent = 'timed out'; stop(); }, 4000);
    };
    $('#cs-reset').onclick = () => { ta.value = START; };
    $('#cs-world').onclick = () => { worldAPI.reset(); r.value = state.snow * 100; v.textContent = Math.round(state.snow * 100) + '%'; };
  },

  sql() {
    const run = $('#sql-run'), reset = $('#sql-reset'), status = $('#sql-status'), out = $('#sql-out'), code = $('#sql-code');
    code.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run.click(); } });
    $('#sql-examples').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) { code.value = b.dataset.q; code.focus(); } });
    const showError = msg => { out.textContent = ''; const s = document.createElement('span'); s.className = 'err'; s.textContent = msg; out.append(s); };
    const showResult = (res, changed) => {
      out.textContent = '';
      if (!res.length) { out.textContent = changed ? `OK — ${changed} row${changed === 1 ? '' : 's'} changed.` : 'OK.'; return; }
      const r = res[res.length - 1], tbl = document.createElement('table');
      const hr = tbl.insertRow(); r.columns.forEach(c => { const th = document.createElement('th'); th.textContent = c; hr.append(th); });
      r.values.slice(0, 60).forEach(v => { const tr = tbl.insertRow(); v.forEach(x => { tr.insertCell().textContent = x === null ? 'NULL' : x; }); });
      out.append(tbl);
      const cap = document.createElement('div'); cap.className = 'cap';
      cap.textContent = `${r.values.length} row${r.values.length === 1 ? '' : 's'}`; out.append(cap);
    };
    loadSqlJs().then(() => {
      if (!db) resetDb();
      syncFromDb();
      status.textContent = 'SQLite ready'; run.disabled = reset.disabled = false;
      const zc = $('#zcount'); zc.disabled = false;
      zc.addEventListener('input', () => { setZombieCount(+zc.value); $('#zcount-val').textContent = zc.value; });
      run.onclick = () => {
        try {
          const res = db.exec(code.value), changed = db.getRowsModified();
          showResult(res, changed);
          /* any result that contains ids lights those zombies up */
          const ids = new Set();
          for (const r of res) { const i = r.columns.indexOf('id'); if (i >= 0) r.values.forEach(v => ids.add(v[0])); }
          syncFromDb();
          for (const z of zombies) if (ids.has(z.id)) z.hl = 4;
        } catch (err) { showError(String(err.message || err)); syncFromDb(); }
      };
      reset.onclick = () => { resetDb(); zombies = []; dyingZ = []; syncFromDb(); showResult([], 0); out.textContent = 'The swamp has been reset.'; };
    }).catch(() => { status.textContent = 'failed to load'; showError('Could not load the SQLite runtime.'); });
  },
};

/* ---------- SQLite (sql.js, bundled in assets/vendor) ---------- */
let sqlPromise = null, SQLmod = null, db = null;
function loadSqlJs() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/sql-wasm.js'; s.onload = res; s.onerror = rej; document.head.append(s);
  }).then(() => initSqlJs({ locateFile: f => 'assets/vendor/' + f })).then(m => (SQLmod = m));
  sqlPromise.catch(() => { sqlPromise = null; });
  return sqlPromise;
}
const ZNAMES = ['Gary', 'Dmitri', 'Nora', 'Pavel', 'Ines', 'Kolya', 'Mara', 'Otto', 'Vera', 'Lenny', 'Sasha', 'Bruno', 'Tanya', 'Misha', 'Olga', 'Yuri'];
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function resetDb() {
  if (db) db.close();
  db = new SQLmod.Database();
  /* a new row without an explicit `kind` gets a random look; a trigger keeps the swamp at <= ZMAX zombies */
  const randomKind = `CASE abs(random()) % ${ZKINDS.length} ${ZKINDS.map((k, i) => `WHEN ${i} THEN '${k.name}'`).join(' ')} END`;
  db.run(`CREATE TABLE zombies (id INTEGER PRIMARY KEY, name TEXT, kind TEXT DEFAULT (${randomKind}), speed INTEGER, hp INTEGER);`);
  db.run(`CREATE TRIGGER swamp_limit BEFORE INSERT ON zombies WHEN (SELECT COUNT(*) FROM zombies) >= ${ZMAX}
          BEGIN SELECT RAISE(ABORT, 'The swamp is full (max ${ZMAX} zombies)'); END;`);
  setZombieCount(3);
}
/* the slider: grow or shrink the table to n rows (0..ZMAX) */
function setZombieCount(n) {
  n = Math.max(0, Math.min(ZMAX, n | 0));
  const have = db.exec('SELECT COUNT(*) FROM zombies')[0].values[0][0];
  if (n > have) {
    const names = new Set(db.exec('SELECT name FROM zombies')[0]?.values.map(v => v[0]) || []);
    const kinds = new Set(db.exec('SELECT kind FROM zombies')[0]?.values.map(v => v[0]) || []);
    for (let i = have; i < n; i++) {
      const name = pick(ZNAMES.filter(x => !names.has(x))), kind = pick(ZKINDS.map(k => k.name).filter(x => !kinds.has(x)));
      names.add(name); kinds.add(kind);
      db.run('INSERT INTO zombies (name, kind, speed, hp) VALUES (?, ?, ?, ?)', [name, kind, 1 + Math.floor(Math.random() * 5), 20 + Math.floor(Math.random() * 81)]);
    }
  } else if (n < have) {
    db.run('DELETE FROM zombies WHERE id IN (SELECT id FROM zombies ORDER BY id DESC LIMIT ?)', [have - n]);
  }
  syncFromDb();
}
function syncFromDb() {
  let rows = [];
  try {
    const r = db.exec('SELECT id, name, kind, speed FROM zombies');
    if (r.length) rows = r[0].values.map(([id, name, kind, speed]) => ({ id, name: String(name), kind: String(kind), speed: Number(speed) || 0 }));
  } catch (_) { /* table dropped or altered: the swamp is empty */ }
  syncZombies(rows);
  const zc = $('#zcount'); if (zc) { zc.value = Math.min(ZMAX, rows.length); $('#zcount-val').textContent = rows.length; }
}

let pyPromise = null;
function loadPyodideOnce() {
  if (pyPromise) return pyPromise;
  const base = new URL('assets/vendor/pyodide/', location.href).href;   // Pyodide 0.26.4, vendored: no CDN needed
  pyPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = base + 'pyodide.js'; s.onload = res; s.onerror = rej;
    document.head.append(s);
  }).then(async () => {
    const py = await loadPyodide({ indexURL: base });
    py.registerJsModule('world', worldAPI);
    return py;
  });
  pyPromise.catch(() => { pyPromise = null; });
  return pyPromise;
}

/* ============================================================
   BOOT
   ============================================================ */
resize(); overview();
cam.x = tgt.x; cam.y = tgt.y; cam.s = tgt.s;
applyTint();
requestAnimationFrame(frame);
setTimeout(preload, 1200);
