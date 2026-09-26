/* Мотокросс Захара 3D — открытый мир в духе GTA.
   Всё (рельеф, модели, текстуры) генерируется кодом, внешних ассетов нет. */
'use strict';
(() => {
const T = THREE;

// =====================================================================
//  Утилиты
// =====================================================================
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20260926);
const rr = (a, b) => a + R() * (b - a);

const PERM = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (i, j) => PERM[PERM[(ix + i) & 255] + ((iy + j) & 255)] / 255;
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v) * 2 - 1;
}
function fbm(x, y, oct) {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

function catmull(pts, closed, step) {
  const out = [], n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const p0 = closed ? pts[(i - 1 + n) % n] : (i ? pts[i - 1] : p1);
    const p3 = closed ? pts[(i + 2) % n] : (i + 2 < n ? pts[i + 2] : p2);
    const per = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1].slice());
  // длина дуги
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    if (i) s += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
    out[i][2] = s;
  }
  return out;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(w, h, draw, rep) {
  const c = canvas(w, h); draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
function mergeGeos(list) {
  const geos = list.map(g => g.index ? g.toNonIndexed() : g);
  const out = new T.BufferGeometry();
  for (const a of ['position', 'normal', 'color', 'uv']) {
    if (!geos.every(g => g.attributes[a])) continue;
    const arrs = geos.map(g => g.attributes[a].array);
    const buf = new Float32Array(arrs.reduce((s, x) => s + x.length, 0));
    let o = 0; for (const x of arrs) { buf.set(x, o); o += x.length; }
    out.setAttribute(a, new T.BufferAttribute(buf, geos[0].attributes[a].itemSize));
  }
  return out;
}
const matCache = {};
function std(color, rough = 0.7, metal = 0, extra) {
  const key = color + '|' + rough + '|' + metal + (extra ? JSON.stringify(Object.keys(extra)) + Math.random() : '');
  if (!matCache[key]) matCache[key] = new T.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra || {}));
  return matCache[key];
}
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new T.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const box = (w, h, d) => new T.BoxGeometry(w, h, d);
function tube(a, b, r, mat, parent) {
  const va = new T.Vector3(...a), vb = new T.Vector3(...b), len = va.distanceTo(vb);
  const m = mesh(new T.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  parent.add(m);
  return m;
}
// профиль в плоскости (z, y), выдавленный по x на ширину w
function sideExtrude(pts, w, mat, parent, bevel = 0.015) {
  const sh = new T.Shape();
  pts.forEach(([z, y], i) => i ? sh.lineTo(-z, y) : sh.moveTo(-z, y));
  const g = new T.ExtrudeGeometry(sh, { depth: w, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  g.rotateY(Math.PI / 2); g.translate(-w / 2, 0, 0);
  const m = mesh(g, mat); parent.add(m);
  return m;
}

// =====================================================================
//  Карта: дороги, трасса, зоны
// =====================================================================
const HALF = 400, STEP = 2, G = HALF * 2 / STEP + 1;

const ROADS = [
  { kind: 'road', halfW: 3.8, closed: true, pts: catmull([
    [-215, 300], [-215, 150], [-255, 30], [-230, -180], [-60, -300], [150, -290],
    [310, -170], [320, 80], [210, 290], [0, 330], [-120, 340]], true, 1) },
  { kind: 'road', halfW: 3.2, closed: false, pts: catmull([[-255, 30], [-60, 60], [100, 40], [320, 80]], false, 1) },
  { kind: 'track', halfW: 5, closed: true, pts: catmull([
    [120, -20], [60, -80], [80, -180], [170, -215], [250, -160], [240, -70], [180, -30]], true, 1) },
  { kind: 'road', halfW: 3.4, closed: false, pts: catmull([[100, 40], [118, 10], [120, -20]], false, 1) },
];
const TRACK = ROADS[2], LOOP = ROADS[0];
const TRACK_LEN = TRACK.pts[TRACK.pts.length - 1][2] + Math.hypot(TRACK.pts[0][0] - TRACK.pts.at(-1)[0], TRACK.pts[0][1] - TRACK.pts.at(-1)[1]);

// ровные площадки: деревня, стант-парк, ферма, бело-синее здание
const ZONES = [
  { name: 'village', x: -215, z: 225, r0: 58, r1: 95, dirt: 50 },
  { name: 'stunt', x: -110, z: 150, r0: 45, r1: 75, dirt: 38 },
  { name: 'farm', x: 235, z: 222, r0: 22, r1: 45, dirt: 18 },
  { name: 'blue', x: -196, z: 128, r0: 16, r1: 30, dirt: 0 },
];
const VILLAGE = ZONES[0], STUNT = ZONES[1], FARM = ZONES[2];

// трамплины на трассе (столы) и «стиральная доска»
const JUMPS = [0.1, 0.3, 0.52, 0.75].map(f => f * TRACK_LEN);
const WHOOPS = 0.4 * TRACK_LEN;
function trackExtra(s) {
  let h = 0;
  for (const J of JUMPS) {
    const t = s - J;
    if (t > 0 && t < 7) h = Math.max(h, 2.4 * smooth(0, 7, t));
    else if (t >= 7 && t < 13) h = Math.max(h, 2.4);
    else if (t >= 13 && t < 22) h = Math.max(h, 2.4 * (1 - smooth(13, 22, t)));
  }
  const w = s - WHOOPS;
  if (w > 0 && w < 45) h += 0.45 * (0.5 - 0.5 * Math.cos(w / 6 * Math.PI * 2));
  return h;
}

// поле расстояний до дорог
const edge = new Float32Array(G * G).fill(99);
const eRoad = new Int8Array(G * G).fill(-1);
const eS = new Float32Array(G * G);
ROADS.forEach((rd, ri) => {
  const rad = rd.halfW + 16;
  for (const [px, pz, s] of rd.pts) {
    const i0 = Math.max(0, Math.floor((px - rad + HALF) / STEP)), i1 = Math.min(G - 1, Math.ceil((px + rad + HALF) / STEP));
    const j0 = Math.max(0, Math.floor((pz - rad + HALF) / STEP)), j1 = Math.min(G - 1, Math.ceil((pz + rad + HALF) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const e = Math.hypot(x - px, z - pz) - rd.halfW, k = j * G + i;
      if (e < edge[k]) { edge[k] = e; eRoad[k] = ri; eS[k] = s; }
    }
  }
});

const lowH = (x, z) => 9 * fbm(x / 260 + 3.1, z / 260 - 1.7, 2);
function fullH(x, z) {
  let h = lowH(x, z) + 3.6 * fbm(x / 75 + 11, z / 75 - 4, 3) + 0.25 * noise(x / 6, z / 6);
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 310) h += Math.pow(e - 310, 1.5) * 0.06;
  return h;
}
const H = new Float32Array(G * G);
for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
  const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * G + i;
  let h = fullH(x, z);
  const e = edge[k];
  if (e < 16) {
    let rh = lowH(x, z);
    if (ROADS[eRoad[k]].kind === 'track') rh += trackExtra(eS[k]) * (1 - smooth(0, 4, e));
    h = lerp(rh, h, smooth(0.5, 16, e));
  }
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r1) h = lerp(zn.h ?? (zn.h = lowH(zn.x, zn.z)), h, smooth(zn.r0, zn.r1, d));
  }
  H[k] = h;
}
function gridH(x, z) {
  const fx = clamp((x + HALF) / STEP, 0, G - 1.001), fz = clamp((z + HALF) / STEP, 0, G - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * G + i;
  return lerp(lerp(H[k], H[k + 1], u), lerp(H[k + G], H[k + G + 1], u), v);
}
function edgeAt(x, z) {
  const i = clamp(Math.round((x + HALF) / STEP), 0, G - 1), j = clamp(Math.round((z + HALF) / STEP), 0, G - 1);
  return edge[j * G + i];
}

// деревянные трамплины
const RAMPS = [];
function addRamp(x, z, yaw, len = 6, w = 3.6, h = 1.8) { RAMPS.push({ x, z, yaw, len, w, h, fx: Math.sin(yaw), fz: Math.cos(yaw) }); }
{
  const c = STUNT;
  addRamp(c.x - 20, c.z + 8, Math.PI / 2);
  addRamp(c.x + 14, c.z - 12, -Math.PI / 2, 7, 4, 2.3);
  addRamp(c.x - 6, c.z - 22, 0, 5, 3.4, 1.4);
  addRamp(c.x + 4, c.z + 22, Math.PI, 6, 3.6, 1.9);
  addRamp(c.x + 26, c.z + 16, -Math.PI * 0.75, 8, 4.4, 2.8);
  // на дорогах по направлению движения
  for (const [rd, f] of [[ROADS[1], 0.3], [ROADS[1], 0.7], [LOOP, 0.33], [LOOP, 0.62]]) {
    const i = Math.floor(f * rd.pts.length), a = rd.pts[i], b = rd.pts[i + 3];
    addRamp(a[0], a[1], Math.atan2(b[0] - a[0], b[1] - a[1]));
  }
}
function rampH(x, z) {
  let h = 0;
  for (const r of RAMPS) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > 40) continue;
    const u = dx * r.fx + dz * r.fz + r.len / 2, v = dx * r.fz - dz * r.fx;
    if (u > 0 && u < r.len && Math.abs(v) < r.w / 2) h = Math.max(h, r.h * u / r.len);
  }
  return h;
}
const groundH = (x, z) => gridH(x, z) + rampH(x, z);

// лужи
const PUDDLES = [];
for (let tries = 0; PUDDLES.length < 40 && tries < 600; tries++) {
  const rd = R() < 0.75 ? LOOP : ROADS[1 + Math.floor(R() * 3)];
  const p = rd.pts[Math.floor(R() * rd.pts.length)];
  const x = p[0] + rr(-2, 2), z = p[1] + rr(-2, 2);
  if (RAMPS.some(r => Math.hypot(r.x - x, r.z - z) < 14)) continue;
  if (PUDDLES.some(q => Math.hypot(q.x - x, q.z - z) < 12)) continue;
  PUDDLES.push({ x, z, r: rr(1.4, 3.2), sx: rr(0.6, 1), rot: rr(0, 3) });
}
for (const [x, z, r] of [[-213, 250, 3], [-209, 235, 2.2], [-216, 212, 3.5], [-211, 196, 2], [-214, 170, 2.6]]) PUDDLES.push({ x, z, r, sx: 0.55, rot: 0 });
function inPuddle(x, z) {
  for (const p of PUDDLES) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.abs(dx) < p.r && Math.abs(dz) < p.r) {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const u = (dx * c - dz * s) / p.r, v = (dx * s + dz * c) / (p.r * p.sx);
      if (u * u + v * v < 1) return true;
    }
  }
  return false;
}
function surfaceAt(x, z) {
  if (inPuddle(x, z)) return 2;
  if (edgeAt(x, z) < 0.3) return 1;
  for (const zn of ZONES) if (zn.dirt && Math.hypot(x - zn.x, z - zn.z) < zn.dirt) return 1;
  return 0;
}

// =====================================================================
//  Рендер, небо, свет
// =====================================================================
const view = document.getElementById('view');
const LOW = matchMedia('(pointer: coarse)').matches;
const renderer = new T.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1 : 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new T.Scene();
const camera = new T.PerspectiveCamera(65, 1, 0.1, 1600);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const SUN_DIR = new T.Vector3(-0.45, 0.72, -0.53).normalize();
const skyMat = new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec3 vDir; uniform vec3 sunDir;
    void main(){
      vec3 d = normalize(vDir); float h = max(d.y, 0.0);
      vec3 zen = vec3(0.16, 0.38, 0.78), hor = vec3(0.72, 0.84, 0.95);
      vec3 col = mix(hor, zen, pow(h, 0.5));
      if (d.y < 0.0) col = mix(hor, vec3(0.5, 0.58, 0.5), min(-d.y * 5.0, 1.0));
      float s = max(dot(d, sunDir), 0.0);
      col += vec3(1.0, 0.92, 0.75) * pow(s, 900.0) * 6.0 + vec3(1.0, 0.85, 0.6) * pow(s, 10.0) * 0.25;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new T.Mesh(new T.SphereGeometry(1000, 32, 16), skyMat);
sky.renderOrder = -1;
scene.add(sky);
scene.fog = new T.Fog(0xb8d4ec, 160, 820);
{
  const envScene = new T.Scene();
  envScene.add(new T.Mesh(new T.SphereGeometry(10, 32, 16), skyMat));
  const ground = new T.Mesh(new T.CircleGeometry(9, 16).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x55653a }));
  ground.position.y = -1; envScene.add(ground);
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}
const hemi = new T.HemisphereLight(0xcfe4ff, 0x5b6a3a, 0.9);
scene.add(hemi);
const sun = new T.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

// облака
{
  const tex = canvasTex(256, 128, (c, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = rr(50, w - 50), y = rr(50, h - 30), r = rr(20, 48);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  });
  for (let i = 0; i < 38; i++) {
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, fog: false, depthWrite: false, opacity: rr(0.75, 0.95) }));
    const a = rr(0, 6.28), d = rr(150, 700);
    sp.position.set(Math.cos(a) * d, rr(160, 260), Math.sin(a) * d);
    const s = rr(90, 200); sp.scale.set(s, s * 0.5, 1);
    scene.add(sp);
  }
}

// =====================================================================
//  Рельеф
// =====================================================================
const TEXN = 1024;
const colorCanvas = canvas(TEXN, TEXN);
{
  const c = colorCanvas.getContext('2d'), img = c.createImageData(TEXN, TEXN), d = img.data;
  for (let py = 0; py < TEXN; py++) for (let px = 0; px < TEXN; px++) {
    const x = -HALF + (px + 0.5) / TEXN * HALF * 2, z = -HALF + (py + 0.5) / TEXN * HALF * 2;
    const n1 = fbm(x / 35, z / 35, 3), n2 = noise(x / 6, z / 6), dry = smooth(0.1, 0.5, fbm(x / 140 + 7, z / 140, 2));
    let r = 78 + n1 * 18 + n2 * 8 + dry * 40, g = 112 + n1 * 22 + n2 * 10 + dry * 22, b = 44 + n1 * 8 + dry * 8;
    // склоны — камень и сухая трава
    const fx = (px + 0.5) / TEXN * (G - 1), fz = (py + 0.5) / TEXN * (G - 1);
    const i = Math.min(G - 2, Math.floor(fx)), j = Math.min(G - 2, Math.floor(fz)), k = j * G + i;
    const slope = Math.hypot(H[k + 1] - H[k], H[k + G] - H[k]) / STEP;
    const rock = smooth(0.45, 0.9, slope);
    r = lerp(r, 118 + n2 * 12, rock); g = lerp(g, 112 + n2 * 12, rock); b = lerp(b, 100 + n2 * 10, rock);
    // грунт
    const e = lerp(lerp(edge[k], edge[k + 1], fx - i), lerp(edge[k + G], edge[k + G + 1], fx - i), fz - j);
    let dirt = 1 - smooth(-0.6, 1.4, e + n2 * 0.6);
    for (const zn of ZONES) if (zn.dirt) dirt = Math.max(dirt, 1 - smooth(zn.dirt - 4, zn.dirt + 2, Math.hypot(x - zn.x, z - zn.z) + n1 * 5));
    const track = eRoad[k] >= 0 && ROADS[eRoad[k]].kind === 'track';
    const dr = (track ? 120 : 132) + n1 * 22 + n2 * 14, dg = (track ? 92 : 108) + n1 * 18 + n2 * 11, db = (track ? 64 : 80) + n1 * 12 + n2 * 8;
    r = lerp(r, dr, dirt); g = lerp(g, dg, dirt); b = lerp(b, db, dirt);
    const o = (py * TEXN + px) * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}
const terrainCanvas = canvas(2048, 2048);
{
  const c = terrainCanvas.getContext('2d'), k = 2048 / (HALF * 2);
  c.drawImage(colorCanvas, 0, 0, 2048, 2048);
  c.setTransform(k, 0, 0, k, HALF * k, HALF * k);
  // колеи
  c.lineCap = c.lineJoin = 'round';
  for (const rd of ROADS) for (const off of [-1.6, -0.9, 0.9, 1.6]) {
    c.strokeStyle = 'rgba(70,52,36,.35)'; c.lineWidth = 0.35;
    c.beginPath();
    rd.pts.forEach((p, i) => {
      const q = rd.pts[Math.min(i + 1, rd.pts.length - 1)], pp = rd.pts[Math.max(i - 1, 0)];
      const dx = q[0] - pp[0], dz = q[1] - pp[1], l = Math.hypot(dx, dz) || 1;
      const x = p[0] - dz / l * off, z = p[1] + dx / l * off;
      i ? c.lineTo(x, z) : c.moveTo(x, z);
    });
    c.stroke();
  }
  // тёмные края луж
  for (const p of PUDDLES) {
    c.save(); c.translate(p.x, p.z); c.rotate(-p.rot);
    c.fillStyle = 'rgba(60,44,30,.8)';
    c.beginPath(); c.ellipse(0, 0, p.r + 0.6, p.r * p.sx + 0.6, 0, 0, 7); c.fill();
    c.restore();
  }
  // бетонная площадка у гаражей
  c.fillStyle = '#9d988f'; c.fillRect(-228, 203, 6, 44);
}
const terrainTex = new T.CanvasTexture(terrainCanvas);
terrainTex.colorSpace = T.SRGBColorSpace; terrainTex.anisotropy = 8;
const detailTex = (() => {
  const c = canvas(256, 256), x = c.getContext('2d'), im = x.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const px = i % 256, py = Math.floor(i / 256);
    const v = 128 + 70 * noise(px / 4, py / 4) * 0.6 + (R() - 0.5) * 70;
    const w = 128 + 90 * fbm(px / 32, py / 32, 3);
    im.data[i * 4] = v; im.data[i * 4 + 1] = w; im.data[i * 4 + 2] = 128; im.data[i * 4 + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping;
  return t;
})();
{
  const geo = new T.PlaneGeometry(HALF * 2, HALF * 2, G - 1, G - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setY(k, H[k]);
  geo.computeVertexNormals();
  const mat = new T.MeshStandardMaterial({ map: terrainTex, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.detailMap = { value: detailTex };
    sh.fragmentShader = 'uniform sampler2D detailMap;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n diffuseColor.rgb *= (0.62 + 0.76 * texture2D(detailMap, vMapUv * 260.0).r) * (0.8 + 0.4 * texture2D(detailMap, vMapUv * 37.0).g);');
  };
  const terrain = new T.Mesh(geo, mat);
  terrain.receiveShadow = true;
  scene.add(terrain);
}

// лужи — зеркальные, отражают небо (как на фото)
{
  const mat = new T.MeshStandardMaterial({ color: 0x9fbcd4, roughness: 0.06, metalness: 1.0 });
  for (const p of PUDDLES) {
    const g = new T.CircleGeometry(1, 24);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (let k = 0; k < pos.count; k++) {
      const u = pos.getX(k) * p.r, v = pos.getZ(k) * p.r * p.sx;
      const x = p.x + u * c + v * s, z = p.z - u * s + v * c;
      pos.setXYZ(k, x, gridH(x, z) + 0.05, z);
    }
    g.computeVertexNormals();
    const m = new T.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  }
}

// =====================================================================
//  Коллайдеры
// =====================================================================
const CELL = 16, colGrid = new Map();
let qid = 0;
function addCollider(c) {
  const x0 = Math.floor((c.minx ?? c.x - c.r) / CELL), x1 = Math.floor((c.maxx ?? c.x + c.r) / CELL);
  const z0 = Math.floor((c.minz ?? c.z - c.r) / CELL), z1 = Math.floor((c.maxz ?? c.z + c.r) / CELL);
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
    const k = i * 10007 + j;
    if (!colGrid.has(k)) colGrid.set(k, []);
    colGrid.get(k).push(c);
  }
}
const addBoxCol = (cx, cz, w, d, top) => addCollider({ minx: cx - w / 2, maxx: cx + w / 2, minz: cz - d / 2, maxz: cz + d / 2, top });
// выталкивает круг из препятствий; возвращает силу удара
function resolve(o, r, y) {
  let hit = 0; qid++;
  const ci = Math.floor(o.x / CELL), cj = Math.floor(o.z / CELL);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const list = colGrid.get(i * 10007 + j); if (!list) continue;
    for (const c of list) {
      if (c.q === qid) continue; c.q = qid;
      if (c.top !== undefined && y > c.top) continue;
      let nx, nz, depth;
      if (c.r !== undefined) {
        const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d >= m || d < 1e-4) continue;
        nx = dx / d; nz = dz / d; depth = m - d;
      } else {
        const px = clamp(o.x, c.minx, c.maxx), pz = clamp(o.z, c.minz, c.maxz);
        const dx = o.x - px, dz = o.z - pz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; depth = r - d; }
        else { // центр внутри коробки
          const l = o.x - c.minx, rt = c.maxx - o.x, t = o.z - c.minz, b = c.maxz - o.z, m = Math.min(l, rt, t, b);
          nx = m === l ? -1 : m === rt ? 1 : 0; nz = m === t ? -1 : m === b ? 1 : 0; depth = m + r;
        }
      }
      o.x += nx * depth; o.z += nz * depth;
      const vn = o.vx * nx + o.vz * nz;
      if (vn < 0) { o.vx -= vn * nx * 1.3; o.vz -= vn * nz * 1.3; hit = Math.max(hit, -vn); }
    }
  }
  const lim = HALF - 6;
  if (Math.abs(o.x) > lim) { o.x = Math.sign(o.x) * lim; o.vx *= -0.3; }
  if (Math.abs(o.z) > lim) { o.z = Math.sign(o.z) * lim; o.vz *= -0.3; }
  return hit;
}

// =====================================================================
//  Текстуры построек
// =====================================================================
const TX = {
  plaster: canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#d8ceb6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${R() < 0.5 ? '120,105,80' : '255,250,235'},${rr(0.03, 0.12)})`; c.beginPath(); c.arc(rr(0, w), rr(0, h), rr(2, 16), 0, 7); c.fill(); }
    const g = c.createLinearGradient(0, h * 0.7, 0, h); g.addColorStop(0, 'rgba(90,70,50,0)'); g.addColorStop(1, 'rgba(90,70,50,.35)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, [4, 1]),
  garageDoor: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#6e4a30'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { c.fillStyle = x % 16 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.06)'; c.fillRect(x, 0, 4, h); }
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(140,70,30,${rr(0.1, 0.4)})`; c.beginPath(); c.arc(rr(0, w), rr(0, h), rr(1, 6), 0, 7); c.fill(); }
    c.fillStyle = '#2b2b2b'; c.fillRect(w / 2 - 1, 0, 2, h);
  }),
  metal: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#6c7278'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x + 4, 0, 2, h); }
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(120,70,40,${rr(0.05, 0.25)})`; c.fillRect(rr(0, w), rr(0, h), rr(2, 10), rr(6, 30)); }
  }, [6, 2]),
  redRoof: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#c3342c'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 10) { c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(x + 5, 0, 2, h); }
  }, [4, 2]),
  brick: canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#cfc6b8'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 * 16; x < w; x += 32) {
      c.fillStyle = `rgb(${220 + rr(-15, 15)},${212 + rr(-15, 15)},${198 + rr(-15, 15)})`; c.fillRect(x + 1, y + 1, 30, 14);
    }
  }, [3, 1]),
  wood: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#a57c4e'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      c.fillStyle = `rgb(${165 + rr(-20, 20)},${124 + rr(-15, 15)},${78 + rr(-10, 10)})`; c.fillRect(0, y + 1, w, 14);
      c.fillStyle = 'rgba(60,40,20,.5)'; c.fillRect(0, y, w, 1.5);
      for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(90,60,30,.25)'; c.fillRect(rr(0, w), y + rr(2, 12), rr(10, 40), 1); }
    }
  }),
  blueWall: canvasTex(512, 256, (c, w, h) => {
    c.fillStyle = '#eef2f5'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f6fc2'; c.fillRect(0, 0, w, 26); c.fillRect(0, h - 22, w, 22);
    for (let x = 30; x < w - 40; x += 80) { c.fillStyle = '#7f98ad'; c.fillRect(x, 70, 50, 60); c.fillStyle = '#b8d3e8'; c.fillRect(x + 3, 73, 44, 26); c.strokeStyle = '#fff'; c.lineWidth = 3; c.strokeRect(x, 70, 50, 60); }
  }),
  stripes: canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#3fc6d8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#101214';
    for (let k = 0; k < 4; k++) {
      c.beginPath(); const y = 30 + k * 60;
      c.moveTo(0, y); c.lineTo(w * 0.35, y + 18); c.lineTo(w * 0.5, y); c.lineTo(w * 0.65, y + 18); c.lineTo(w, y);
      c.lineTo(w, y + 12); c.lineTo(w * 0.65, y + 30); c.lineTo(w * 0.5, y + 12); c.lineTo(w * 0.35, y + 30); c.lineTo(0, y + 12); c.closePath(); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(0, 0, w, 10);
  }),
};

// =====================================================================
//  Деревня (как на фото): гаражи, дом с красной крышей, грузовик, ЛЭП
// =====================================================================
const village = new T.Group(); scene.add(village);
const gy = (x, z) => gridH(x, z);
{
  // гаражи — фасадом к дороге (+x)
  const gx = -232, gz = 225, len = 40, dep = 8, hh = 3.2, base = gy(gx, gz);
  const walls = std(0xffffff, 0.95, 0, { map: TX.plaster });
  mesh(box(dep, hh, len), walls, gx, base + hh / 2, gz, village);
  const roof = std(0xffffff, 0.6, 0.5, { map: TX.metal });
  const r = mesh(box(dep + 1, 0.12, len + 1), roof, gx + 0.3, base + hh + 0.15, gz, village); r.rotation.z = -0.06;
  const door = std(0xffffff, 0.7, 0.3, { map: TX.garageDoor });
  for (let k = 0; k < 5; k++) mesh(box(0.08, 2.4, 3), door, gx + dep / 2 + 0.03, base + 1.2, gz - 15 + k * 7.5, village);
  // навес на стойках
  const post = std(0x555a60, 0.5, 0.6);
  const aw = mesh(box(4, 0.08, 12), roof, gx + dep / 2 + 2, base + 2.9, gz - 10, village); aw.rotation.z = -0.1;
  for (const [dx, dz] of [[3.8, -15.5], [3.8, -4.5]]) mesh(box(0.1, 2.8, 0.1), post, gx + dep / 2 + dx, base + 1.4, gz + dz, village);
  // штабели досок и поддоны
  const wood = std(0xffffff, 0.85, 0, { map: TX.wood });
  mesh(box(1.2, 0.6, 2.4), wood, gx + dep / 2 + 1, base + 0.3, gz + 3, village);
  mesh(box(1.2, 0.4, 2.4), wood, gx + dep / 2 + 1, base + 0.8, gz + 3.2, village);
  mesh(box(1, 1.1, 1), std(0xbfb7a8, 0.9), gx + dep / 2 + 1.3, base + 0.55, gz + 6.5, village);
  addBoxCol(gx, gz, dep, len, base + hh);
  addBoxCol(gx + dep / 2 + 1, gz + 4, 1.4, 5, base + 1.2);

  // дом с красной крышей
  const hx = -240, hz = 182, hw = 9, hd = 8, hH = 3.4, hb = gy(hx, hz);
  mesh(box(hw, hH, hd), std(0xffffff, 0.9, 0, { map: TX.brick }), hx, hb + hH / 2, hz, village);
  const sh = new T.Shape(); sh.moveTo(-hd / 2 - 0.6, 0); sh.lineTo(hd / 2 + 0.6, 0); sh.lineTo(0, 2.4); sh.closePath();
  const rg = new T.ExtrudeGeometry(sh, { depth: hw + 1, bevelEnabled: false });
  rg.rotateY(Math.PI / 2); rg.translate(-(hw + 1) / 2, 0, 0);
  mesh(rg, std(0xffffff, 0.55, 0.4, { map: TX.redRoof }), hx, hb + hH, hz, village);
  for (const s of [-1, 1]) {
    const w = mesh(box(0.06, 1.1, 1.3), std(0x8fb3cf, 0.1, 0.6), hx + hw / 2 * s + 0.02 * s, hb + 1.9, hz - 1.5, village);
    w.rotation.y = 0;
  }
  mesh(box(0.06, 2.1, 1), std(0x5a3a22, 0.7), hx + hw / 2 + 0.03, hb + 1.05, hz + 1.8, village);
  addBoxCol(hx, hz, hw, hd, hb + hH + 2);

  // бело-синее здание вдали
  const bx = -196, bz = 128, bb = gy(bx, bz);
  mesh(box(16, 6, 12), std(0xffffff, 0.8, 0, { map: TX.blueWall }), bx, bb + 3, bz, village);
  mesh(box(16.6, 0.3, 12.6), std(0x3a6db5, 0.5, 0.3), bx, bb + 6.1, bz, village);
  addBoxCol(bx, bz, 16, 12, bb + 6);

  // ЛЭП вдоль дороги, провода провисают
  const pole = std(0x9a9690, 0.9);
  const poles = [];
  for (let z = 292; z >= 140; z -= 30) {
    const x = -221.5, b = gy(x, z);
    mesh(new T.CylinderGeometry(0.12, 0.17, 8.5, 8), pole, x, b + 4.25, z, village);
    mesh(box(1.6, 0.12, 0.12), pole, x, b + 8, z, village);
    poles.push([x, b + 8, z]);
    addCollider({ x, z, r: 0.25 });
  }
  const wireMat = new T.LineBasicMaterial({ color: 0x222222 });
  for (let i = 0; i + 1 < poles.length; i++) for (const off of [-0.7, 0, 0.7]) {
    const a = poles[i], b = poles[i + 1], pts = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      pts.push(new T.Vector3(a[0] + off, lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * 0.7 + 0.1, lerp(a[2], b[2], t)));
    }
    village.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), wireMat));
  }
  // провод через дорогу к гаражам
  {
    const a = poles[1], pts = [];
    for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push(new T.Vector3(lerp(a[0], -228, t), lerp(a[1], base + hh + 0.3, t) - Math.sin(t * Math.PI) * 0.4, lerp(a[2], 236, t))); }
    village.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), wireMat));
  }
}

// грузовик (самосвал, как на фото)
function makeTruck() {
  const g = new T.Group();
  const cab = std(0x4a6377, 0.5, 0.3), bed = std(0x5c5f44, 0.8, 0.2), dark = std(0x1d1d1d, 0.9), glass = std(0x2b3a44, 0.1, 0.8);
  mesh(box(2.3, 0.4, 6.4), dark, 0, 0.8, 0, g);
  mesh(box(2.3, 1.7, 1.8), cab, 0, 1.95, 2.1, g);
  mesh(box(2.1, 1, 1.4), cab, 0, 1.5, 3.55, g);
  mesh(box(2.2, 0.7, 0.05), glass, 0, 2.3, 3.02, g);
  const wood = std(0xffffff, 0.9, 0, { map: TX.wood });
  mesh(box(2.4, 0.15, 3.9), bed, 0, 1.15, -1.2, g);
  for (const [x, z, w, d] of [[-1.15, -1.2, 0.1, 3.9], [1.15, -1.2, 0.1, 3.9], [0, -3.1, 2.4, 0.1], [0, 0.7, 2.4, 0.1]])
    mesh(box(w, 1, d), wood, x, 1.7, z, g);
  const wg = new T.CylinderGeometry(0.5, 0.5, 0.35, 16); wg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1, 2.6], [1, 2.6], [-1, -1.6], [1, -1.6], [-1, -2.6], [1, -2.6]]) mesh(wg, dark, x, 0.5, z, g);
  return g;
}
{
  const t = makeTruck(); const x = -222.3, z = 196;
  t.position.set(x, gy(x, z), z); t.rotation.y = Math.PI; village.add(t);
  addBoxCol(x, z, 2.5, 7.4, gy(x, z) + 2.6);
}

// ферма — пункт доставки
{
  const fx = FARM.x + 6, fz = FARM.z - 4, b = gy(fx, fz);
  const logs = std(0xffffff, 0.9, 0, { map: TX.wood });
  mesh(box(8, 3, 6), logs, fx, b + 1.5, fz, scene);
  const sh = new T.Shape(); sh.moveTo(-3.6, 0); sh.lineTo(3.6, 0); sh.lineTo(0, 2); sh.closePath();
  const rg = new T.ExtrudeGeometry(sh, { depth: 9, bevelEnabled: false }); rg.rotateY(Math.PI / 2); rg.translate(-4.5, 0, 0);
  mesh(rg, std(0x6d7075, 0.6, 0.4), fx, b + 3, fz, scene);
  addBoxCol(fx, fz, 8, 6, b + 5);
  // забор
  const fm = std(0x8a6a44, 0.9);
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    if (Math.abs(wrapA(a - Math.PI)) < 0.35) continue;
    const x = FARM.x + Math.cos(a) * 17, z = FARM.z + Math.sin(a) * 17;
    mesh(box(0.12, 1.1, 0.12), fm, x, gy(x, z) + 0.55, z, scene);
  }
}

// =====================================================================
//  Деревья, кусты, трава
// =====================================================================
const reserved = (x, z, pad) =>
  edgeAt(x, z) < pad || ZONES.some(zn => Math.hypot(x - zn.x, z - zn.z) < zn.r0 + pad * 0.5) ||
  RAMPS.some(r => Math.hypot(r.x - x, r.z - z) < 12 + pad);
{
  const blob = (sx, sy, sz, ox, oy, oz, dark) => {
    const g = new T.IcosahedronGeometry(1, 3), p = g.attributes.position, cols = [], nrm = [];
    for (let k = 0; k < p.count; k++) {
      let x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 1 + 0.22 * noise(x * 2.1 + ox * 3, z * 2.1 + y * 1.7 + oy * 5);
      x *= sx * n; y *= sy * n; z *= sz * n;
      p.setXYZ(k, x + ox, y + oy, z + oz);
      nrm.push(x / sx, y / sy, z / sz);
      const l = (0.55 + 0.45 * smooth(-sy, sy, y)) * (dark ? 0.8 : 1);
      cols.push(0.2 * l, 0.36 * l, 0.12 * l);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    g.normalizeNormals();
    return g;
  };
  const leafy = mergeGeos([blob(1.6, 1.3, 1.6, 0, 3.6, 0), blob(1.2, 1, 1.2, 0.9, 4.5, 0.3, 1), blob(1.1, 1, 1.1, -0.8, 4.3, -0.4), blob(1, 0.9, 1, 0.1, 5.2, -0.2)]);
  const cone = (r, h, y) => {
    const g = new T.ConeGeometry(r, h, 9, 1).toNonIndexed(); g.translate(0, y, 0);
    const p = g.attributes.position, cols = [];
    for (let k = 0; k < p.count; k++) { const l = 0.55 + 0.45 * (p.getY(k) - y + h / 2) / h; cols.push(0.12 * l, 0.28 * l, 0.14 * l); }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  };
  const pine = mergeGeos([cone(1.9, 3, 2.6), cone(1.5, 2.6, 4.1), cone(1.1, 2.2, 5.5), cone(0.6, 1.6, 6.8)]);
  const trunkG = new T.CylinderGeometry(0.16, 0.26, 1, 7); trunkG.translate(0, 0.5, 0);
  const trees = [];
  const place = (x, z, s, kind) => { trees.push({ x, z, s, kind }); addCollider({ x, z, r: 0.35 * s }); };
  // живая изгородь и высокие деревья справа от дороги (как на фото)
  for (let z = 145; z < 300; z += rr(3.5, 6)) place(-204 + rr(-1, 1.5), z, rr(1.1, 1.5), 0);
  for (let z = 150; z < 300; z += rr(5, 8)) place(-197 + rr(-2, 2), z, rr(1.4, 1.9), 0);
  for (let tries = 0; trees.length < 1700 && tries < 30000; tries++) {
    const x = rr(-HALF + 8, HALF - 8), z = rr(-HALF + 8, HALF - 8);
    const clump = fbm(x / 90 + 40, z / 90, 2);
    if (R() > 0.25 + clump * 1.3) continue;
    if (reserved(x, z, 6)) continue;
    const s = rr(0.8, 1.6);
    place(x, z, s, gridH(x, z) > 7 || R() < 0.25 ? 1 : 0);
  }
  const leafM = std(0xffffff, 0.85, 0, { vertexColors: true });
  const trunkM = std(0x5a4330, 0.95);
  const nL = trees.filter(t => !t.kind).length, nP = trees.length - nL;
  const iL = new T.InstancedMesh(leafy, leafM, nL), iP = new T.InstancedMesh(pine, leafM, nP), iT = new T.InstancedMesh(trunkG, trunkM, trees.length);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), col = new T.Color();
  let a = 0, b = 0;
  trees.forEach((t, k) => {
    const y = gridH(t.x, t.z) - 0.2;
    q.setFromAxisAngle(new T.Vector3(0, 1, 0), rr(0, 6.28));
    m4.compose(new T.Vector3(t.x, y, t.z), q, new T.Vector3(t.s, t.s * rr(0.9, 1.2), t.s));
    col.setHSL(rr(0.2, 0.3), rr(0.35, 0.6), rr(0.42, 0.6));
    if (t.kind) { iP.setMatrixAt(b, m4); iP.setColorAt(b++, col); } else { iL.setMatrixAt(a, m4); iL.setColorAt(a++, col); }
    m4.compose(new T.Vector3(t.x, y, t.z), q, new T.Vector3(t.s, t.s * (t.kind ? 2 : 3.2), t.s));
    iT.setMatrixAt(k, m4);
  });
  for (const im of [iL, iP, iT]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }

  // трава
  const gtex = canvasTex(128, 128, (c, w, h) => {
    for (let i = 0; i < 40; i++) {
      const x = rr(8, w - 8), hh = rr(h * 0.4, h * 0.95);
      c.strokeStyle = `rgb(${rr(60, 110)},${rr(110, 160)},${rr(30, 60)})`; c.lineWidth = rr(2, 4);
      c.beginPath(); c.moveTo(x, h); c.quadraticCurveTo(x + rr(-6, 6), h - hh / 2, x + rr(-14, 14), h - hh); c.stroke();
    }
  });
  const gq = (rot) => { const g = new T.PlaneGeometry(1, 0.6); g.translate(0, 0.3, 0); g.rotateY(rot); return g; };
  const gGeo = mergeGeos([0, 1, 2, 3, 4, 5].map(k => gq(k * Math.PI / 3)));
  const nrm = gGeo.attributes.normal; for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
  gtex.generateMipmaps = false; gtex.minFilter = T.LinearFilter;
  const gMat = new T.MeshStandardMaterial({ map: gtex, alphaTest: 0.45, roughness: 1, color: 0xc8d8a0 });
  const NG = LOW ? 12000 : 30000, ig = new T.InstancedMesh(gGeo, gMat, NG);
  let n = 0;
  for (let tries = 0; n < NG && tries < NG * 4; tries++) {
    const near = R() < 0.5;
    const x = near ? rr(-300, 60) : rr(-HALF, HALF), z = near ? rr(-100, 360) : rr(-HALF, HALF);
    if (edgeAt(x, z) < 0.8 || ZONES.some(zn => zn.dirt && Math.hypot(x - zn.x, z - zn.z) < zn.dirt + 1)) continue;
    q.setFromAxisAngle(new T.Vector3(0, 1, 0), rr(0, 6.28));
    const s = rr(0.7, 1.5);
    m4.compose(new T.Vector3(x, gridH(x, z) - 0.03, z), q, new T.Vector3(s, s * rr(0.8, 1.3), s));
    ig.setMatrixAt(n, m4);
    col.setHSL(rr(0.18, 0.26), rr(0.3, 0.5), rr(0.45, 0.65)); ig.setColorAt(n++, col);
  }
  ig.count = n;
  scene.add(ig);
}

// трамплины (модели)
{
  const wood = std(0xffffff, 0.85, 0, { map: TX.wood });
  const post = std(0x6b4d2e, 0.9);
  for (const r of RAMPS) {
    const g = new T.Group();
    const sh = new T.Shape(); sh.moveTo(-r.len / 2, 0); sh.lineTo(r.len / 2, r.h); sh.lineTo(r.len / 2, 0); sh.closePath();
    const eg = new T.ExtrudeGeometry(sh, { depth: r.w, bevelEnabled: false });
    eg.rotateY(-Math.PI / 2); eg.translate(r.w / 2, 0, 0);
    mesh(eg, wood, 0, 0, 0, g);
    const stripe = mesh(box(r.w, 0.06, 0.25), std(0xf2d23a, 0.6), 0, r.h + 0.01, r.len / 2 - 0.13, g);
    stripe.castShadow = false;
    for (const s of [-1, 1]) mesh(box(0.15, r.h, 0.15), post, s * (r.w / 2 - 0.1), r.h / 2, r.len / 2 - 0.1, g);
    g.position.set(r.x, gridH(r.x, r.z) - 0.02, r.z); g.rotation.y = r.yaw;
    scene.add(g);
  }
}

// =====================================================================
//  Мотоцикл (белый питбайк, чёрный бак, красная подушка руля)
// =====================================================================
function makeBike(accent = 0xd8262b, plastic = 0xf4f4f2) {
  const g = new T.Group();
  const M = {
    white: std(plastic, 0.35, 0.05), black: std(0x151517, 0.55), tire: std(0x131313, 0.95),
    metal: std(0xb9bfc6, 0.3, 0.85), dark: std(0x3a3e44, 0.5, 0.6), red: std(accent, 0.5), chrome: std(0xe0e3e6, 0.15, 1),
  };
  function wheel(r) {
    const w = new T.Group();
    mesh(new T.TorusGeometry(r - 0.075, 0.075, 10, 30).rotateY(Math.PI / 2), M.tire, 0, 0, 0, w);
    const kg = box(0.15, 0.035, 0.05);
    for (let k = 0; k < 30; k++) {
      const a = k / 30 * Math.PI * 2, kn = mesh(kg, M.tire, 0, Math.cos(a) * r, Math.sin(a) * r, w);
      kn.rotation.x = -a; kn.castShadow = false;
    }
    mesh(new T.TorusGeometry(r - 0.15, 0.018, 6, 30).rotateY(Math.PI / 2), M.black, 0, 0, 0, w);
    mesh(new T.CylinderGeometry(0.05, 0.05, 0.14, 10).rotateZ(Math.PI / 2), M.metal, 0, 0, 0, w);
    mesh(new T.CylinderGeometry(0.09, 0.09, 0.01, 16).rotateZ(Math.PI / 2), M.chrome, 0.06, 0, 0, w);
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, s = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, r - 0.17, 3), M.metal);
      s.position.set(0, Math.cos(a) * (r - 0.17) / 2, Math.sin(a) * (r - 0.17) / 2); s.rotation.x = a; w.add(s);
    }
    return w;
  }
  const rw = wheel(0.36); rw.position.set(0, 0.36, -0.62); g.add(rw);
  const head = new T.Group(); head.position.set(0, 0.98, 0.40); head.rotation.x = -0.366; g.add(head);
  const steer = new T.Group(); head.add(steer);
  const fw = wheel(0.38); fw.position.set(0, -0.643, 0); steer.add(fw);
  for (const s of [-1, 1]) {
    tube([s * 0.085, 0.05, 0], [s * 0.085, -0.3, 0], 0.028, M.chrome, steer);
    tube([s * 0.085, -0.3, 0], [s * 0.085, -0.643, 0], 0.024, M.black, steer);
  }
  mesh(box(0.24, 0.05, 0.08), M.dark, 0, 0.02, 0, steer);
  tube([-0.36, 0.13, -0.05], [0.36, 0.13, -0.05], 0.014, M.metal, steer);
  mesh(box(0.17, 0.055, 0.06), M.red, 0, 0.16, -0.05, steer);
  for (const s of [-1, 1]) tube([s * 0.28, 0.13, -0.05], [s * 0.38, 0.13, -0.05], 0.022, M.black, steer);
  const plate = mesh(box(0.22, 0.24, 0.03), M.white, 0, -0.02, 0.08, steer); plate.rotation.x = 0.1;
  const ff = mesh(box(0.14, 0.03, 0.5), M.white, 0, -0.643 + 0.44, 0.02, steer); ff.rotation.x = 0.05;

  // рама и мотор
  mesh(box(0.22, 0.3, 0.36), M.dark, 0, 0.44, 0.02, g);
  for (let k = 0; k < 4; k++) mesh(box(0.26, 0.02, 0.2), M.metal, 0, 0.62 + k * 0.035, 0.12, g);
  tube([0, 0.95, 0.36], [0, 0.45, 0.22], 0.03, M.metal, g);
  tube([0, 0.95, 0.36], [0, 0.85, -0.25], 0.028, M.metal, g);
  for (const s of [-1, 1]) tube([s * 0.09, 0.36, -0.62], [s * 0.09, 0.45, -0.08], 0.03, M.metal, g);
  tube([0, 0.5, -0.22], [0, 0.86, -0.05], 0.045, M.red, g);
  // выхлоп
  tube([-0.1, 0.5, 0.22], [-0.14, 0.62, -0.18], 0.028, M.chrome, g);
  const muf = mesh(new T.CylinderGeometry(0.055, 0.05, 0.42, 12), M.chrome, -0.15, 0.72, -0.42, g); muf.rotation.x = Math.PI / 2 - 0.25;
  // пластик: заднее крыло/боковины, облицовка радиатора
  sideExtrude([[0.05, 0.9], [0.02, 0.72], [-0.25, 0.64], [-0.62, 0.74], [-0.98, 0.96], [-0.95, 1.0], [-0.55, 0.92], [0.05, 0.93]], 0.24, M.white, g);
  sideExtrude([[0.42, 0.93], [0.42, 0.72], [0.22, 0.58], [0.05, 0.72], [0.08, 0.95]], 0.3, M.white, g);
  // бак
  const tank = mesh(new T.CapsuleGeometry(0.12, 0.2, 6, 12).rotateX(Math.PI / 2), M.black, 0, 0.9, 0.2, g); tank.scale.set(1.05, 0.75, 1);
  // сиденье
  sideExtrude([[0.12, 0.93], [-0.72, 0.94], [-0.74, 0.99], [-0.2, 1.0], [0.12, 1.04]], 0.2, M.black, g, 0.02);
  // подножки
  for (const s of [-1, 1]) tube([s * 0.12, 0.42, -0.02], [s * 0.25, 0.42, -0.02], 0.018, M.black, g);
  // посылка (для миссии доставки)
  const parcel = mesh(box(0.34, 0.26, 0.32), std(0xb58b56, 0.9), 0, 1.13, -0.72, g); parcel.visible = false;
  return { g, rw, fw, steer, parcel };
}

// =====================================================================
//  Захар: бирюзовый шлем, очки, джерси с чёрными полосами,
//  тёмно-синие штаны, наколенники, бежевые кроссовки
// =====================================================================
function makeRider() {
  const M = {
    jersey: std(0xffffff, 0.8, 0, { map: TX.stripes }), turq: std(0x3fc6d8, 0.3, 0.1), turqDark: std(0x2596a8, 0.35, 0.1),
    pants: std(0x1f2d52, 0.85), black: std(0x121316, 0.7), shoe: std(0xd8c8aa, 0.85), sock: std(0xffffff, 0.9),
    skin: std(0xf0c4a2, 0.7), glass: std(0x111111, 0.3, 0.5), yellow: std(0xe8e24a, 0.5),
  };
  const root = new T.Group();
  const hips = new T.Group(); root.add(hips);
  mesh(new T.CapsuleGeometry(0.12, 0.12, 4, 10).rotateZ(Math.PI / 2), M.pants, 0, 0, 0, hips);
  const torso = new T.Group(); hips.add(torso);
  const tm = mesh(new T.CapsuleGeometry(0.15, 0.24, 6, 14), M.jersey, 0, 0.24, 0, torso); tm.scale.set(1.12, 1, 0.82);
  mesh(new T.CylinderGeometry(0.07, 0.08, 0.08, 10), M.black, 0, 0.47, 0, torso);
  // шлем
  const head = new T.Group(); head.position.y = 0.5; torso.add(head);
  const shell = mesh(new T.SphereGeometry(0.165, 22, 16), M.turq, 0, 0.14, 0, head); shell.scale.set(1, 1.05, 1.1);
  const chin = mesh(box(0.2, 0.1, 0.13), M.turq, 0, 0.04, 0.12, head); chin.rotation.x = 0.35;
  mesh(box(0.19, 0.095, 0.06), M.black, 0, 0.14, 0.15, head);
  mesh(box(0.16, 0.08, 0.02), M.skin, 0, 0.14, 0.175, head);
  for (const s of [-1, 1]) {
    mesh(new T.TorusGeometry(0.026, 0.006, 6, 14), M.glass, s * 0.038, 0.145, 0.188, head);
    const lens = mesh(new T.CircleGeometry(0.024, 12), std(0xcfe6ff, 0.05, 0.6, { transparent: true, opacity: 0.45 }), s * 0.038, 0.145, 0.189, head); lens.castShadow = false;
    const logo = mesh(new T.CylinderGeometry(0.045, 0.045, 0.01, 14).rotateZ(Math.PI / 2), M.yellow, s * 0.166, 0.12, -0.02, head); logo.castShadow = false;
  }
  mesh(box(0.012, 0.006, 0.02), M.glass, 0, 0.148, 0.19, head);
  const peak = mesh(box(0.26, 0.015, 0.16), M.turqDark, 0, 0.28, 0.13, head); peak.rotation.x = -0.28;
  const band = mesh(new T.TorusGeometry(0.17, 0.008, 6, 30).rotateX(Math.PI / 2), M.turqDark, 0, 0.1, 0, head); band.scale.set(1, 1, 1.1);

  function limb(parent, x, y, z, l1, l2, r1, r2, m1, m2) {
    const up = new T.Group(); up.position.set(x, y, z); parent.add(up);
    mesh(new T.CapsuleGeometry(r1, l1 - r1 * 2, 4, 10), m1, 0, -l1 / 2, 0, up);
    const low = new T.Group(); low.position.y = -l1; up.add(low);
    mesh(new T.CapsuleGeometry(r2, l2 - r2 * 2, 4, 10), m2, 0, -l2 / 2, 0, low);
    const end = new T.Group(); end.position.y = -l2; low.add(end);
    return { up, low, end };
  }
  const arms = [1, -1].map(s => {
    const a = limb(torso, s * 0.2, 0.38, 0, 0.25, 0.23, 0.058, 0.05, M.jersey, M.jersey);
    mesh(new T.SphereGeometry(0.055, 10, 8), M.black, 0, 0, 0.01, a.end);
    return a;
  });
  const legs = [1, -1].map(s => {
    const l = limb(hips, s * 0.09, -0.02, 0, 0.37, 0.36, 0.075, 0.062, M.pants, M.pants);
    const kp = mesh(box(0.11, 0.14, 0.05), M.black, 0, -0.04, 0.06, l.low); kp.rotation.x = 0.1;
    mesh(new T.CylinderGeometry(0.058, 0.058, 0.05, 10), M.sock, 0, 0.02, 0, l.end);
    mesh(box(0.11, 0.08, 0.24), M.shoe, 0, -0.03, 0.05, l.end);
    mesh(box(0.115, 0.02, 0.25), std(0x8c7a5c, 0.9), 0, -0.07, 0.05, l.end);
    return l;
  });
  return { root, hips, torso, head, arms, legs };
}
function pose(rd, p) {
  rd.hips.position.y = p.hipY ?? 0;
  rd.torso.rotation.set(p.torso ?? 0, 0, p.torsoZ ?? 0);
  rd.head.rotation.set(p.head ?? 0, p.headY ?? 0, 0);
  for (let s = 0; s < 2; s++) {
    const sg = s ? -1 : 1, a = p.arms[s], l = p.legs[s];
    rd.arms[s].up.rotation.set(a[0], a[1] * sg, a[2] * sg);
    rd.arms[s].low.rotation.set(a[3], 0, 0);
    rd.legs[s].up.rotation.set(l[0], l[1] * sg, l[2] * sg);
    rd.legs[s].low.rotation.set(l[3], 0, 0);
    rd.legs[s].end.rotation.set(l[4] ?? 0, 0, 0);
  }
}
const POSE_RIDE = {
  torso: 0.42, head: -0.3,
  arms: [[-1.35, 0, 0.3, -0.5], [-1.35, 0, 0.3, -0.5]],
  legs: [[-1.35, 0, 0.22, 1.55, -0.2], [-1.35, 0, 0.22, 1.55, -0.2]],
};
function walkPose(ph, amt, run) {
  const s = Math.sin(ph) * amt, c = Math.cos(ph) * amt;
  return {
    hipY: Math.abs(c) * 0.04 * (run ? 1.6 : 1), torso: run ? 0.25 * amt : 0.05, head: run ? -0.2 * amt : 0,
    arms: [[s * 0.9, 0, 0.12, -0.35 - (run ? 0.8 : 0.2) * amt], [-s * 0.9, 0, 0.12, -0.35 - (run ? 0.8 : 0.2) * amt]],
    legs: [[-s * 0.75, 0, 0.03, Math.max(0, c) * 1.1 * (run ? 1.3 : 1)], [s * 0.75, 0, 0.03, Math.max(0, -c) * 1.1 * (run ? 1.3 : 1)]],
  };
}

// =====================================================================
//  Игрок
// =====================================================================
const bikeM = makeBike();
const bikeRoot = new T.Group(), leanG = new T.Group(), pitchG = new T.Group();
bikeRoot.add(leanG); leanG.add(pitchG); pitchG.add(bikeM.g); scene.add(bikeRoot);
const seat = new T.Group(); seat.position.set(0, 0.97, -0.14); pitchG.add(seat);
const rider = makeRider();
rider.root.traverse(o => { if (o.isMesh) o.castShadow = true; });

const START = { x: -214, z: 262, yaw: Math.PI };
const B = { x: START.x, z: START.z, y: 0, yaw: START.yaw, vx: 0, vz: 0, vy: 0, fwd: 0, steer: 0, lean: 0, pitch: 0,
  onGround: true, air: 0, flip: 0, wheel: 0, surface: 1 };
const P = { mode: 'foot', x: START.x - 1.3, z: START.z + 0.6, y: 0, yaw: Math.PI, vx: 0, vz: 0, vy: 0, onGround: true, phase: 0, speed: 0 };
B.y = groundH(B.x, B.z); P.y = groundH(P.x, P.z);
scene.add(rider.root);

// припаркованный красно-белый мотоцикл у гаражей (как на фото)
{
  const pb = makeBike(0xe23a2a, 0xf2f2f2);
  const x = -225.5, z = 236;
  pb.g.position.set(x, gy(x, z), z); pb.g.rotation.set(0, 0.4, 0.14);
  scene.add(pb.g); addCollider({ x, z, r: 0.6 });
}

// =====================================================================
//  Машины на дорогах
// =====================================================================
function makeCar(color) {
  const g = new T.Group();
  const body = std(color, 0.35, 0.4), glass = std(0x22303a, 0.05, 0.9), dark = std(0x151515, 0.9), chrome = std(0xdddddd, 0.2, 1);
  mesh(box(1.66, 0.62, 4.1), body, 0, 0.62, 0, g);
  mesh(box(1.5, 0.55, 2.1), body, 0, 1.18, -0.25, g);
  mesh(box(1.52, 0.46, 2.0), glass, 0, 1.18, -0.25, g);
  mesh(box(1.4, 0.08, 1.9), body, 0, 1.48, -0.25, g);
  for (const s of [-1, 1]) { mesh(box(0.28, 0.16, 0.05), std(0xfff6d0, 0.2, 0, { emissive: 0x665e40 }), s * 0.58, 0.7, 2.06, g); mesh(box(0.3, 0.14, 0.05), std(0xaa1111, 0.4), s * 0.58, 0.72, -2.06, g); }
  mesh(box(1.7, 0.14, 0.12), chrome, 0, 0.42, 2.08, g);
  const wg = new T.CylinderGeometry(0.33, 0.33, 0.24, 14); wg.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.78, 1.3], [0.78, 1.3], [-0.78, -1.3], [0.78, -1.3]]) mesh(wg, dark, x, 0.33, z, g);
  return g;
}
const cars = [0xe9e9e4, 0xb3261e, 0x2e6b3a, 0x2a4f8f, 0xd9a520, 0x777b80].map((col, i) => {
  const g = makeCar(col); scene.add(g);
  const dir = i % 2 ? 1 : -1;
  return { g, s: i / 6 * LOOP.pts.length, dir, v: rr(9, 12), vmax: rr(9, 12), x: 0, z: 0, yaw: 0 };
});
function samplePath(pts, s) {
  const n = pts.length, i = ((Math.floor(s) % n) + n) % n, j = (i + 1) % n, t = s - Math.floor(s);
  return [lerp(pts[i][0], pts[j][0], t), lerp(pts[i][1], pts[j][1], t), pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]];
}
function updateCars(dt) {
  const px = P.mode === 'bike' ? B.x : P.x, pz = P.mode === 'bike' ? B.z : P.z;
  for (const c of cars) {
    const [x, z, dx0, dz0] = samplePath(LOOP.pts, c.s);
    const dx = dx0 * c.dir, dz = dz0 * c.dir, l = Math.hypot(dx, dz) || 1;
    const fx = dx / l, fz = dz / l;
    // правая полоса
    c.x = x - fz * 1.9; c.z = z + fx * 1.9;
    const rx = c.x - px, rz = c.z - pz;
    const ahead = -(rx * fx + rz * fz), side = Math.abs(-rx * fz + rz * fx);
    const blocked = ahead > 0 && ahead < 11 && side < 2.6;
    c.v = damp(c.v, blocked ? 0 : c.vmax, blocked ? 5 : 1, dt);
    c.s += c.dir * c.v * dt / (l || 1);
    c.yaw = Math.atan2(fx, fz);
    const y = gridH(c.x, c.z);
    c.g.position.set(c.x, y, c.z);
    c.g.rotation.set(-Math.atan2(gridH(c.x + fx * 1.5, c.z + fz * 1.5) - gridH(c.x - fx * 1.5, c.z - fz * 1.5), 3), c.yaw, 0, 'YXZ');
    c.fx = fx; c.fz = fz;
    if (blocked && c.v < 1 && !c.honked) { c.honked = true; beep(420, 0.25, 'square', 0.05); beep(520, 0.25, 'square', 0.04); }
    if (!blocked) c.honked = false;
  }
}
function carHit(o, r) {
  let hit = 0;
  for (const c of cars) for (const k of [-1.1, 1.1]) {
    const cx = c.x + c.fx * k, cz = c.z + c.fz * k, dx = o.x - cx, dz = o.z - cz, d = Math.hypot(dx, dz), m = r + 1.1;
    if (d < m && d > 1e-4) {
      const nx = dx / d, nz = dz / d; o.x += nx * (m - d); o.z += nz * (m - d);
      const rv = (o.vx - c.fx * c.v) * nx + (o.vz - c.fz * c.v) * nz;
      if (rv < 0) { o.vx -= rv * nx * 1.3; o.vz -= rv * nz * 1.3; hit = Math.max(hit, -rv); }
    }
  }
  return hit;
}

// =====================================================================
//  Звёзды, маркеры миссий, чекпоинты
// =====================================================================
const starGeo = (() => {
  const s = new T.Shape();
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * Math.PI * 2 + Math.PI / 2, r = k % 2 ? 0.28 : 0.62;
    k ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new T.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
  g.center(); return g;
})();
const starMat = std(0xffc81a, 0.25, 0.8, { emissive: 0x6a4a00 });
const STARS = [];
function addStar(x, z, up = 1.2) {
  const m = mesh(starGeo, starMat); const y = groundH(x, z) + up;
  m.position.set(x, y, z); scene.add(m);
  STARS.push({ m, x, y, z, got: false });
}
{
  for (let k = 0; k < 8; k++) { const p = LOOP.pts[Math.floor((k + 0.5) / 8 * LOOP.pts.length)]; addStar(p[0], p[1]); }
  for (let k = 0; k < 4; k++) { const p = TRACK.pts[Math.floor((k * 0.25 + 0.2) * TRACK.pts.length)]; addStar(p[0], p[1]); }
  // над трамплинами — надо прыгнуть
  for (const r of RAMPS.slice(0, 5)) addStar(r.x + r.fx * (r.len / 2 + 5), r.z + r.fz * (r.len / 2 + 5), 3.4);
  for (const J of JUMPS.slice(0, 2)) { const i = TRACK.pts.findIndex(p => p[2] >= J + 11); const p = TRACK.pts[i]; addStar(p[0], p[1], 4.2); }
  // на вершинах холмов и в деревне
  let hills = 0;
  for (let tries = 0; hills < 5 && tries < 4000; tries++) {
    const x = rr(-280, 280), z = rr(-280, 280), h = gridH(x, z);
    if (h < 8 || reserved(x, z, 4) || STARS.some(s => Math.hypot(s.x - x, s.z - z) < 90)) continue;
    addStar(x, z); hills++;
  }
  addStar(-224, 216); addStar(-212, 180);
}
const TOTAL_STARS = STARS.length;

function beamTex() {
  return canvasTex(8, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}
const BEAM = beamTex();
function makeMarker(color, h = 2.4, r = 1.4) {
  const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 28, 1, true),
    new T.MeshBasicMaterial({ color, map: BEAM, transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false }));
  m.geometry.translate(0, h / 2, 0);
  scene.add(m);
  return m;
}
function labelSprite(text, color = '#ffd21f') {
  const t = canvasTex(256, 64, (c, w, h) => {
    c.font = 'bold 34px "Russo One", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(text, w / 2, h / 2); c.fillStyle = color; c.fillText(text, w / 2, h / 2);
  });
  const s = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1); s.renderOrder = 5; scene.add(s);
  return s;
}

// =====================================================================
//  Миссии
// =====================================================================
const TP = TRACK.pts;
const raceStart = (() => { const p = TP[0], q = TP[4], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); return { x: p[0] + dz / l * 8, z: p[1] - dx / l * 8 }; })();
const MISSIONS = [
  { id: 'race', name: 'ГОНКА', title: 'Гонка по трассе', x: raceStart.x, z: raceStart.z, color: 0xffd21f },
  { id: 'stunt', name: 'КАСКАДЁР', title: 'Каскадёр', x: STUNT.x, z: STUNT.z + 30, color: 0x3fd8ff },
  { id: 'deliver', name: 'ДОСТАВКА', title: 'Срочная посылка', x: -224.5, z: 172, color: 0x6fd66b },
];
for (const m of MISSIONS) {
  m.marker = makeMarker(m.color);
  m.label = labelSprite(m.name, '#' + m.color.toString(16).padStart(6, '0'));
  const y = groundH(m.x, m.z);
  m.marker.position.set(m.x, y, m.z); m.label.position.set(m.x, y + 3.4, m.z);
}
const ringGeo = new T.TorusGeometry(5.2, 0.3, 10, 40);
const ringMat = new T.MeshStandardMaterial({ color: 0xffd21f, emissive: 0x806000, roughness: 0.4, transparent: true, opacity: 0.85 });
const ring = new T.Mesh(ringGeo, ringMat), ring2 = new T.Mesh(ringGeo, ringMat.clone());
ring2.material.opacity = 0.3; ring.visible = ring2.visible = false; scene.add(ring, ring2);
const destBeam = makeMarker(0xffd21f, 60, 2.2); destBeam.visible = false;

const state = { playing: false, money: 0, stars: 0, mission: null, bestRace: null };
try {
  state.money = parseInt(localStorage.getItem('zakhar3d_money')) || 0;
  state.bestRace = parseFloat(localStorage.getItem('zakhar3d_best_race')) || null;
} catch (e) { /* хранилище недоступно */ }
function addMoney(v) {
  state.money += v;
  try { localStorage.setItem('zakhar3d_money', String(state.money)); } catch (e) { /* */ }
}
let raceCps = [];
function startMission(m) {
  const ms = { m, t: 0, cp: 0, air: 0 };
  state.mission = ms;
  for (const x of MISSIONS) { x.marker.visible = x.label.visible = false; }
  if (m.id === 'race') {
    raceCps = [];
    for (let s = 40; s < TRACK_LEN - 10; s += 45) raceCps.push(TP.find(p => p[2] >= s));
    raceCps.push(TP[2]);
    // поставить на старт
    const p = TP[0], q = TP[3];
    Object.assign(B, { x: p[0], z: p[1], yaw: Math.atan2(q[0] - p[0], q[1] - p[1]), vx: 0, vz: 0, fwd: 0 });
    B.y = groundH(B.x, B.z);
    ms.count = 3;
    bigMsg('ГОНКА ПО ТРАССЕ', 'Проедь все кольца как можно быстрее', 2.5);
  } else if (m.id === 'stunt') {
    ms.limit = 90;
    bigMsg('КАСКАДЁР', 'Набери 8 секунд в воздухе за 90 секунд', 2.5);
  } else if (m.id === 'deliver') {
    ms.limit = 95; bikeM.parcel.visible = true;
    bigMsg('СРОЧНАЯ ПОСЫЛКА', 'Отвези посылку на ферму', 2.5);
    destBeam.position.set(FARM.x, groundH(FARM.x, FARM.z), FARM.z); destBeam.visible = true;
  }
  beep(440, 0.2, 'square', 0.08); setTimeout(() => beep(660, 0.3, 'square', 0.08), 180);
}
function endMission(ok, sub) {
  const m = state.mission; if (!m) return;
  state.mission = null; ring.visible = ring2.visible = false; destBeam.visible = false; bikeM.parcel.visible = false;
  if (ok) {
    bigMsg('МИССИЯ ВЫПОЛНЕНА', sub, 4);
    beep(523, 0.18, 'square', 0.1); setTimeout(() => beep(659, 0.18, 'square', 0.1), 170); setTimeout(() => beep(784, 0.45, 'square', 0.1), 340);
  } else {
    bigMsg('МИССИЯ ПРОВАЛЕНА', sub, 3.5, '#ff4a3a');
    beep(300, 0.4, 'sawtooth', 0.08, 120);
  }
  setTimeout(() => { for (const x of MISSIONS) x.marker.visible = x.label.visible = true; }, 3000);
}
function updateMission(dt) {
  const ms = state.mission;
  const px = P.mode === 'bike' ? B.x : P.x, pz = P.mode === 'bike' ? B.z : P.z;
  if (!ms) {
    let near = null;
    for (const m of MISSIONS) if (m.marker.visible && Math.hypot(m.x - px, m.z - pz) < 2.6) near = m;
    if (near) {
      if (P.mode === 'bike') startMission(near);
      else help('Садись на мотоцикл, чтобы начать миссию <b>' + near.title + '</b>');
    }
    return;
  }
  const m = ms.m;
  if (m.id === 'race') {
    if (ms.count > 0) {
      const before = Math.ceil(ms.count);
      ms.count -= dt;
      B.vx = B.vz = B.fwd = 0;
      if (Math.ceil(ms.count) !== before && ms.count > 0) beep(440, 0.15, 'square', 0.08);
      if (ms.count <= 0) { popup('ВПЕРЁД!'); beep(880, 0.4, 'square', 0.09); }
      if (ms.count > 0 && ms.count < 3) bigMsg(String(Math.ceil(ms.count)), '', 0.3);
      objective('');
    } else {
      ms.t += dt;
      const c = raceCps[ms.cp];
      if (Math.hypot(c[0] - px, c[1] - pz) < 7.5) {
        ms.cp++; beep(990, 0.1, 'triangle', 0.08);
        if (ms.cp >= raceCps.length) {
          const t = ms.t, reward = Math.max(300, Math.round((2200 - t * 12) / 10) * 10);
          let sub = 'Время ' + fmtT(t) + '   +$' + reward;
          if (!state.bestRace || t < state.bestRace) {
            state.bestRace = t; sub += '   РЕКОРД!';
            try { localStorage.setItem('zakhar3d_best_race', String(t)); } catch (e) { /* */ }
          }
          addMoney(reward); endMission(true, sub); return;
        }
      }
      if (ms.t > 240) { endMission(false, 'Слишком долго'); return; }
      objective('Проедь через <em>кольца</em>: ' + ms.cp + ' / ' + raceCps.length);
    }
    const c = raceCps[Math.min(ms.cp, raceCps.length - 1)], n = raceCps[Math.min(ms.cp + 1, raceCps.length - 1)];
    placeRing(ring, c); placeRing(ring2, n); ring2.visible = ms.cp + 1 < raceCps.length;
    ring.visible = true;
    timer(fmtT(ms.t) + (state.bestRace ? '<br><small>рекорд ' + fmtT(state.bestRace) + '</small>' : ''));
  } else if (m.id === 'stunt') {
    ms.t += dt;
    const left = ms.limit - ms.t;
    objective('Время в воздухе: <em>' + ms.air.toFixed(1) + ' / 8.0 с</em>');
    timer(fmtT(Math.max(0, left)));
    if (ms.air >= 8) { addMoney(1000); endMission(true, '+$1000'); }
    else if (left <= 0) endMission(false, 'Время вышло');
  } else if (m.id === 'deliver') {
    ms.t += dt;
    const left = ms.limit - ms.t, d = Math.hypot(FARM.x - px, FARM.z - pz);
    objective('Отвези посылку на <em>ферму</em> — ' + Math.round(d) + ' м');
    timer(fmtT(Math.max(0, left)));
    if (P.mode !== 'bike' && d > 30) help('Вернись на мотоцикл — посылка на нём!');
    if (d < 9 && P.mode === 'bike') { const rw = 400 + Math.round(left * 6); addMoney(rw); endMission(true, 'Посылка доставлена   +$' + rw); }
    else if (left <= 0) endMission(false, 'Посылка опоздала');
  }
}
function placeRing(r, p) {
  const i = TP.indexOf(p), q = TP[(i + 3) % TP.length];
  r.position.set(p[0], groundH(p[0], p[1]) + 4.2, p[1]);
  r.rotation.set(0, Math.atan2(q[0] - p[0], q[1] - p[1]), 0);
}

// =====================================================================
//  Эффекты: пыль, брызги
// =====================================================================
const dustTex = canvasTex(64, 64, (c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});
const dust = [];
for (let i = 0; i < 70; i++) {
  const s = new T.Sprite(new T.SpriteMaterial({ map: dustTex, color: 0xb59c7c, transparent: true, depthWrite: false, opacity: 0 }));
  s.visible = false; scene.add(s); dust.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, grow: 1 });
}
let dustI = 0;
function puff(x, y, z, vx, vy, vz, size, life, color = 0xb59c7c, grow = 2) {
  const d = dust[dustI++ % dust.length];
  Object.assign(d, { life, max: life, vx, vy, vz, grow, size });
  d.s.position.set(x, y, z); d.s.material.color.setHex(color); d.s.scale.setScalar(size); d.s.visible = true;
}
const NDROP = 300, dropPos = new Float32Array(NDROP * 3).fill(-999), dropVel = new Float32Array(NDROP * 3), dropLife = new Float32Array(NDROP);
const dropGeo = new T.BufferGeometry(); dropGeo.setAttribute('position', new T.BufferAttribute(dropPos, 3));
const drops = new T.Points(dropGeo, new T.PointsMaterial({ color: 0x6e5238, size: 0.09 }));
drops.frustumCulled = false; scene.add(drops);
let dropI = 0;
function splash(x, y, z, vx, vy, vz) {
  const i = dropI++ % NDROP;
  dropPos.set([x, y, z], i * 3); dropVel.set([vx, vy, vz], i * 3); dropLife[i] = 1.2;
}
function updateFx(dt) {
  for (const d of dust) {
    if (!d.s.visible) continue;
    d.life -= dt;
    if (d.life <= 0) { d.s.visible = false; continue; }
    const k = d.life / d.max;
    d.s.position.x += d.vx * dt; d.s.position.y += d.vy * dt; d.s.position.z += d.vz * dt;
    d.vx *= 0.97; d.vz *= 0.97;
    d.s.scale.setScalar(d.size * (1 + (1 - k) * d.grow));
    d.s.material.opacity = k * 0.55;
  }
  for (let i = 0; i < NDROP; i++) {
    if (dropLife[i] <= 0) continue;
    dropLife[i] -= dt;
    const o = i * 3;
    dropVel[o + 1] -= 9.8 * dt;
    dropPos[o] += dropVel[o] * dt; dropPos[o + 1] += dropVel[o + 1] * dt; dropPos[o + 2] += dropVel[o + 2] * dt;
    if (dropLife[i] <= 0 || dropPos[o + 1] < gridH(dropPos[o], dropPos[o + 2])) { dropPos[o + 1] = -999; dropLife[i] = 0; }
  }
  dropGeo.attributes.position.needsUpdate = true;
}

// =====================================================================
//  Звук
// =====================================================================
let audio = null, engine = null, muted = false;
function initAudio() {
  if (audio) return;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    const o1 = audio.createOscillator(), o2 = audio.createOscillator(), f = audio.createBiquadFilter(), g = audio.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 800; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(audio.destination); o1.start(); o2.start();
    engine = { o1, o2, f, g };
  } catch (e) { audio = null; }
}
function beep(freq, dur, type = 'sine', vol = 0.1, to = null) {
  if (!audio || muted) return;
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur, vol) {
  if (!audio || muted) return;
  const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = audio.createBufferSource(), g = audio.createGain(); g.gain.value = vol;
  s.buffer = buf; s.connect(g); g.connect(audio.destination); s.start();
}
function toggleSound() { muted = !muted; document.getElementById('bSound').textContent = muted ? '🔇' : '🔊'; }

// =====================================================================
//  Ввод
// =====================================================================
const keys = {};
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run', Space: 'jump', KeyE: 'use', KeyF: 'use', Enter: 'use' };
const pressed = new Set();
addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { if (!keys[k]) pressed.add(k); keys[k] = true; e.preventDefault(); }
  if (e.code === 'KeyM') toggleSound();
  if (e.code === 'KeyR' && state.playing) resetBike();
});
addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const touch = { x: 0, y: 0, gas: false, brake: false, jump: false, use: false };
const isTouch = matchMedia('(pointer: coarse)').matches;
let camYaw = Math.PI, camPitch = 0.28, lastLook = -99;
{
  const stick = document.getElementById('stick'), knob = document.getElementById('knob');
  let sid = null;
  const move = e => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    touch.x = dx; touch.y = dy; knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`;
  };
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) move(e); });
  const end = e => { if (e.pointerId !== sid) return; sid = null; touch.x = touch.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  document.querySelectorAll('.tb').forEach(el => {
    const k = el.dataset.k;
    el.addEventListener('pointerdown', e => { e.preventDefault(); if (!touch[k]) pressed.add(k); touch[k] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) { /* */ } });
    const off = () => { touch[k] = false; el.classList.remove('on'); };
    el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
  });
  // камера: мышь (pointer lock) или перетаскивание
  let drag = null;
  view.addEventListener('pointerdown', e => {
    if (!state.playing) return;
    if (e.pointerType === 'mouse' && !document.pointerLockElement) {
      try { const p = view.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* */ }
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  addEventListener('pointermove', e => {
    if (document.pointerLockElement === view) { look(e.movementX, e.movementY); return; }
    if (drag && e.pointerId === drag.id) { look((e.clientX - drag.x) * 1.6, (e.clientY - drag.y) * 1.6); drag.x = e.clientX; drag.y = e.clientY; }
  });
  addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) drag = null; });
}
function look(dx, dy) {
  camYaw -= dx * 0.0028; camPitch = clamp(camPitch + dy * 0.002, -0.15, 1.2);
  lastLook = performance.now() / 1000;
}
function readInput() {
  const up = keys.up || touch.gas || touch.y < -0.35, down = keys.down || touch.brake || touch.y > 0.45;
  const steer = clamp((keys.right ? 1 : 0) - (keys.left ? 1 : 0) + (Math.abs(touch.x) > 0.15 ? touch.x : 0), -1, 1);
  const mvF = (keys.up ? 1 : 0) - (keys.down ? 1 : 0) - touch.y, mvR = (keys.right ? 1 : 0) - (keys.left ? 1 : 0) + touch.x;
  const inp = { up, down, steer, mvF: clamp(mvF, -1, 1), mvR: clamp(mvR, -1, 1), run: keys.run || Math.hypot(touch.x, touch.y) > 0.9,
    jump: pressed.has('jump'), use: pressed.has('use'), jumpHeld: keys.jump || touch.jump };
  pressed.clear();
  return inp;
}

// =====================================================================
//  HUD
// =====================================================================
const $ = id => document.getElementById(id);
const fmtT = s => { const m = Math.floor(s / 60), x = s - m * 60; return m + ':' + (x < 10 ? '0' : '') + x.toFixed(2); };
let helpT = 0, bigT = 0, popT = 0;
function help(html) { $('help').innerHTML = html; $('help').classList.remove('hidden'); helpT = 0.25; }
function objective(html) { $('objective').innerHTML = html; }
function timer(html) { $('timer').innerHTML = html; }
function bigMsg(t, s, dur, color) {
  $('big').querySelector('.t').textContent = t; $('big').querySelector('.t').style.color = color || '';
  $('big').querySelector('.s').textContent = s || ''; $('big').classList.remove('hidden'); bigT = dur;
}
function popup(html, dur = 1.8) { $('popup').innerHTML = html; $('popup').classList.remove('hidden'); popT = dur; }
const radar = $('radar'), rctx = radar.getContext('2d');
function drawRadar() {
  const W = radar.width, c = rctx, px = P.mode === 'bike' ? B.x : P.x, pz = P.mode === 'bike' ? B.z : P.z;
  const range = 130, k = W / 2 / range, mapK = TEXN / (HALF * 2);
  c.save();
  c.fillStyle = '#3b5a2a'; c.fillRect(0, 0, W, W);
  c.translate(W / 2, W / 2);
  c.rotate(camYaw - Math.PI);
  c.scale(-1, 1); c.rotate(0);
  // карта: мир x → вправо (зеркально, т.к. смотрим вдоль -z), z → вниз
  c.save(); c.scale(k, k); c.translate(-px, -pz);
  c.globalAlpha = 0.9;
  c.drawImage(colorCanvas, (px - range * 1.5 + HALF) * mapK, (pz - range * 1.5 + HALF) * mapK, range * 3 * mapK, range * 3 * mapK,
    px - range * 1.5, pz - range * 1.5, range * 3, range * 3);
  c.globalAlpha = 1;
  c.restore();
  const blip = (x, z, col, r, sq) => {
    let dx = (x - px) * k, dz = (z - pz) * k; const l = Math.hypot(dx, dz), lim = W / 2 - 8;
    if (l > lim) { dx *= lim / l; dz *= lim / l; }
    c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); sq ? c.rect(dx - r, dz - r, r * 2, r * 2) : c.arc(dx, dz, r, 0, 7); c.fill(); c.stroke();
  };
  for (const s of STARS) if (!s.got && Math.hypot(s.x - px, s.z - pz) < range) blip(s.x, s.z, '#ffd21f', 3);
  if (!state.mission) for (const m of MISSIONS) if (m.marker.visible) blip(m.x, m.z, '#' + m.color.toString(16).padStart(6, '0'), 6, true);
  if (state.mission?.m.id === 'race' && raceCps.length) { const p = raceCps[Math.min(state.mission.cp, raceCps.length - 1)]; blip(p[0], p[1], '#ffd21f', 6); }
  if (state.mission?.m.id === 'deliver') blip(FARM.x, FARM.z, '#ffd21f', 7);
  if (P.mode !== 'bike') blip(B.x, B.z, '#3fc6d8', 4, true);
  c.restore();
  // игрок — стрелка
  const yaw = P.mode === 'bike' ? B.yaw : P.yaw;
  c.save(); c.translate(W / 2, W / 2); c.rotate(-(yaw - camYaw));
  c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
  c.restore();
}

// =====================================================================
//  Логика игрока
// =====================================================================
const G_ACC = 9.8;
const tmp = new T.Vector3();
function resetBike() {
  if (P.mode === 'crash') return;
  const px = P.mode === 'bike' ? B.x : P.x, pz = P.mode === 'bike' ? B.z : P.z;
  Object.assign(B, { x: px, z: pz, vx: 0, vz: 0, fwd: 0, vy: 0, lean: 0, pitch: 0, air: 0, flip: 0, onGround: true });
  B.y = groundH(B.x, B.z);
  if (P.mode === 'foot') { B.x = P.x + Math.sin(P.yaw) * 2; B.z = P.z + Math.cos(P.yaw) * 2; B.y = groundH(B.x, B.z); B.yaw = P.yaw; }
  popup('Мотоцикл на месте');
}
function mount() {
  P.mode = 'bike'; seat.add(rider.root); rider.root.position.set(0, 0, 0); rider.root.rotation.set(0, 0, 0);
  pose(rider, POSE_RIDE); beep(120, 0.3, 'sawtooth', 0.06, 200);
}
function dismount() {
  P.mode = 'foot'; scene.add(rider.root);
  const lx = Math.cos(B.yaw), lz = -Math.sin(B.yaw);
  P.x = B.x + lx * 0.9; P.z = B.z + lz * 0.9; P.y = groundH(P.x, P.z); P.yaw = B.yaw; P.vx = P.vz = P.vy = 0;
  B.vx = B.vz = B.fwd = 0;
}
let crashT = 0;
const rag = { vx: 0, vy: 0, vz: 0, sx: 0, sz: 0 };
function crash(msg) {
  if (P.mode !== 'bike') return;
  (window.__crashLog = window.__crashLog || []).push(msg + ' @' + Math.round(B.x) + ',' + Math.round(B.z) + ' v' + B.fwd.toFixed(1) + ' p' + B.pitch.toFixed(2) + ' air' + B.air.toFixed(2));
  P.mode = 'crash'; crashT = 2.6;
  rider.root.getWorldPosition(tmp);
  scene.add(rider.root); rider.root.position.copy(tmp); rider.root.rotation.set(0, B.yaw, 0);
  rag.vx = B.vx * 0.8; rag.vz = B.vz * 0.8; rag.vy = 3 + Math.abs(B.fwd) * 0.12; rag.sx = rr(4, 8); rag.sz = rr(-4, 4);
  B.fwd *= 0.3;
  popup('<span style="color:#ff8a5c">' + msg + '</span>', 2);
  noiseBurst(0.4, 0.25); beep(90, 0.3, 'square', 0.1, 40);
  if (state.mission?.m.id === 'race') { /* гонка продолжается после подъёма */ }
}
function updateCrash(dt) {
  crashT -= dt;
  const r = rider.root;
  rag.vy -= G_ACC * dt;
  r.position.x += rag.vx * dt; r.position.y += rag.vy * dt; r.position.z += rag.vz * dt;
  const g = groundH(r.position.x, r.position.z) + 0.25;
  if (r.position.y < g) { r.position.y = g; rag.vy = Math.abs(rag.vy) * 0.3; rag.vx *= 0.55; rag.vz *= 0.55; rag.sx *= 0.6; rag.sz *= 0.6; }
  r.rotation.x += rag.sx * dt; r.rotation.z += rag.sz * dt;
  if (Math.hypot(rag.vx, rag.vz) < 0.5 && r.position.y - g < 0.05) { r.rotation.x = damp(r.rotation.x, -Math.PI / 2, 4, dt); r.rotation.z = damp(r.rotation.z, 0, 4, dt); }
  pose(rider, { torso: 0.2, head: 0.3, arms: [[-2.6, 0, 1.0, -0.3], [-2.6, 0, 1.0, -0.3]], legs: [[-0.6, 0, 0.3, 0.8], [0.2, 0, 0.3, 0.3]] });
  // мотоцикл падает на бок
  B.lean = damp(B.lean, 1.35, 4, dt); B.fwd = damp(B.fwd, 0, 2, dt);
  B.vx = Math.sin(B.yaw) * B.fwd; B.vz = Math.cos(B.yaw) * B.fwd;
  B.x += B.vx * dt; B.z += B.vz * dt; B.y = groundH(B.x, B.z) + 0.15;
  B.pitch = damp(B.pitch, 0, 4, dt);
  if (crashT <= 0) {
    Object.assign(B, { lean: 0, pitch: 0, vx: 0, vz: 0, fwd: 0, vy: 0, air: 0, flip: 0, onGround: true });
    B.y = groundH(B.x, B.z);
    mount();
  }
}

function updateFoot(dt, inp) {
  const f = inp.mvF, r = inp.mvR, mag = Math.min(1, Math.hypot(f, r));
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
  let dx = fx * f + rx * r, dz = fz * f + rz * r; const l = Math.hypot(dx, dz);
  const spd = inp.run ? 6 : 2.6;
  if (l > 0.01) { dx /= l; dz /= l; P.yaw += wrapA(Math.atan2(dx, dz) - P.yaw) * Math.min(1, dt * 12); }
  const tvx = dx * spd * mag, tvz = dz * spd * mag;
  P.vx = damp(P.vx, tvx, 10, dt); P.vz = damp(P.vz, tvz, 10, dt);
  P.x += P.vx * dt; P.z += P.vz * dt;
  resolve(P, 0.3, P.y + 0.3); carHit(P, 0.3);
  const g = groundH(P.x, P.z);
  if (P.onGround && inp.jump) { P.vy = 4.6; P.onGround = false; }
  P.vy -= G_ACC * dt; P.y += P.vy * dt;
  if (P.y <= g) { P.y = g; P.vy = 0; P.onGround = true; } else if (P.y - g > 0.2) P.onGround = false;
  P.speed = Math.hypot(P.vx, P.vz);
  P.phase += dt * P.speed * (inp.run ? 1.9 : 3.1);
  const amt = clamp(P.speed / 2.6, 0, 1);
  const wp = walkPose(P.phase, amt, P.speed > 3.5);
  if (!P.onGround) { wp.legs[0][0] = -0.6; wp.legs[0][3] = 0.9; wp.legs[1][0] = 0.2; wp.legs[1][3] = 0.4; wp.arms[0][2] = 0.6; wp.arms[1][2] = 0.6; }
  pose(rider, wp);
  rider.root.position.set(P.x, P.y + 0.78, P.z);
  rider.root.rotation.set(0, P.yaw, 0);
  // рядом с мотоциклом
  if (Math.hypot(B.x - P.x, B.z - P.z) < 2.6) {
    help('Нажми <b>' + (isTouch ? 'E' : 'E') + '</b>, чтобы сесть на мотоцикл');
    if (inp.use) mount();
  }
}

function updateBike(dt, inp) {
  const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
  let fwd = B.vx * fx + B.vz * fz, lat = -B.vx * fz + B.vz * fx;
  const s = surfaceAt(B.x, B.z); B.surface = s;
  const locked = state.mission?.m.id === 'race' && state.mission.count > 0;
  B.steer = damp(B.steer, inp.steer, 9, dt);
  const gOld = groundH(B.x, B.z);
  let yawRate = 0;
  if (B.onGround) {
    const grip = s === 2 ? 0.35 : s === 0 ? 0.75 : 1;
    const maxS = s === 2 ? 17 : s === 0 ? 20 : 27, acc = s === 0 ? 7.5 : 9.5;
    if (inp.up && !locked) fwd += acc * dt;
    if (inp.down) { if (fwd > 0.5) fwd -= 16 * dt; else fwd = Math.max(fwd - 5 * dt, -4); }
    fwd -= fwd * (acc / maxS) * dt * (inp.up ? 1 : 0.6);
    if (!inp.up && !inp.down && Math.abs(fwd) < 0.3) fwd = 0;
    const hf = groundH(B.x + fx * 0.7, B.z + fz * 0.7), hb = groundH(B.x - fx * 0.7, B.z - fz * 0.7), slope = (hf - hb) / 1.4;
    fwd -= G_ACC * slope * 0.5 * dt;
    if (slope > 0.8 && fwd > 0) fwd *= 0.85;
    const maxSteer = 0.45 / (1 + Math.abs(fwd) / 6);
    yawRate = fwd / 1.3 * Math.tan(B.steer * maxSteer);
    B.yaw -= yawRate * dt;
    lat *= Math.exp(-grip * 7 * dt);
    B.pitch = damp(B.pitch, -Math.atan(slope), 12, dt);
    if (inp.jump) { B.vy = 4.2; B.onGround = false; B.y += 0.05; beep(200, 0.15, 'triangle', 0.06, 380); }
    // пыль / брызги
    const sp = Math.abs(fwd), rx = B.x - fx * 0.6, rz = B.z - fz * 0.6;
    if (s === 2 && sp > 3) {
      for (let k = 0; k < 4; k++) { const sd = R() < 0.5 ? -1 : 1; splash(rx, B.y + 0.1, rz, -fx * sp * 0.3 - fz * sd * rr(1, 3), rr(1.5, 4), -fz * sp * 0.3 + fx * sd * rr(1, 3)); }
      if (R() < 0.3) puff(rx, B.y + 0.3, rz, -fx * 2, 0.5, -fz * 2, 0.6, 0.5, 0xc8dcea, 1.5);
    } else if (s === 1 && sp > 6 && R() < 0.45) {
      puff(rx + rr(-0.3, 0.3), B.y + 0.25, rz + rr(-0.3, 0.3), -fx * sp * 0.15, rr(0.3, 1), -fz * sp * 0.15, rr(0.5, 0.9), rr(0.9, 1.6));
    }
    if (s !== 2 && sp > 4 && Math.abs(B.steer) > 0.6 && R() < 0.5) splash(rx, B.y + 0.1, rz, -fx * 2 + rr(-1, 1), rr(1, 2.5), -fz * 2 + rr(-1, 1));
  } else {
    B.yaw -= B.steer * 1.2 * dt;
    // в воздухе: держи S (тормоз) — сальто назад; иначе мотоцикл сам выравнивается
    let dp;
    if (inp.down) dp = -4.6 * dt;
    else {
      const base = B.pitch - wrapA(B.pitch);
      const target = base + (inp.up ? 0.2 : 0) - Math.atan2(B.vy, Math.max(4, Math.abs(fwd))) * 0.5;
      dp = (target - B.pitch) * Math.min(1, dt * 4);
    }
    B.pitch += dp; B.flip += dp;
    B.air += dt;
    if (state.mission?.m.id === 'stunt' && B.air > 0.25) state.mission.air += dt;
  }
  const lean = clamp(Math.atan(yawRate * fwd / G_ACC), -0.75, 0.75);
  B.lean = damp(B.lean, B.onGround ? lean : B.lean * 0.9, 8, dt);

  B.vx = fx * fwd - fz * lat; B.vz = fz * fwd + fx * lat; B.fwd = fwd;
  B.x += B.vx * dt; B.z += B.vz * dt;

  // столкновения
  const pre = Math.hypot(B.vx, B.vz);
  const hit = Math.max(resolve(B, 0.55, B.y + 0.4), carHit(B, 0.55));
  if (hit > 3) {
    const post = Math.hypot(B.vx, B.vz);
    B.shake = Math.min(1, hit / 12);
    if (hit > 9) { crash(hit > 14 ? 'БАБАХ! Упал!' : 'Ой, упал!'); return; }
    beep(80, 0.15, 'square', 0.08, 50);
    if (post > pre) { B.vx *= pre / post; B.vz *= pre / post; }
  }

  // вертикаль
  const gNew = groundH(B.x, B.z);
  const wasAir = !B.onGround;
  B.vy -= G_ACC * dt; B.y += B.vy * dt;
  if (B.y <= gNew) {
    const tv = clamp((gNew - gOld) / dt, -12, 12);
    if (wasAir && B.air > 0.3) land(gNew);
    if (P.mode !== 'bike') return;
    B.y = gNew; B.vy = tv; B.onGround = true; B.air = 0; B.flip = 0;
  } else if (B.y - gNew > 0.3) {
    B.onGround = false;
  }
  B.wheel += fwd * dt / 0.37;
}
function land(g) {
  const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
  const slope = (groundH(B.x + fx * 0.7, B.z + fz * 0.7) - groundH(B.x - fx * 0.7, B.z - fz * 0.7)) / 1.4;
  const diff = Math.abs(wrapA(B.pitch + Math.atan(slope)));
  const flips = Math.round(Math.abs(B.flip) / (Math.PI * 2));
  if (diff > 1.0) { crash('Неудачное приземление!'); return; }
  B.pitch = -Math.atan(slope);
  for (let k = 0; k < 10; k++) puff(B.x + rr(-0.8, 0.8), g + 0.2, B.z + rr(-0.8, 0.8), rr(-2, 2), rr(0.2, 1), rr(-2, 2), 0.8, 1.2);
  noiseBurst(0.12, 0.12);
  if (flips > 0) {
    const m = 500 * flips; addMoney(m);
    popup((flips > 1 ? flips + '× САЛЬТО!' : 'САЛЬТО!') + ' <span class="m">+$' + m + '</span>', 2.2);
    beep(660, 0.12, 'square', 0.08); setTimeout(() => beep(990, 0.25, 'square', 0.08), 120);
  } else if (B.air > 0.9) {
    const m = Math.round(B.air * 60 / 10) * 10; addMoney(m);
    popup('ПРЫЖОК ' + B.air.toFixed(1) + ' с <span class="m">+$' + m + '</span>');
  }
  B.shake = 0.4;
}

function updateStars(dt, t) {
  const px = P.mode === 'bike' ? B.x : P.x, pz = P.mode === 'bike' ? B.z : P.z, py = (P.mode === 'bike' ? B.y : P.y) + 1;
  for (const s of STARS) {
    if (s.got) continue;
    s.m.rotation.y = t * 2 + s.x;
    s.m.position.y = s.y + Math.sin(t * 2.5 + s.z) * 0.15;
    if (Math.abs(s.x - px) < 2.2 && Math.abs(s.z - pz) < 2.2 && Math.hypot(s.x - px, s.z - pz, s.y - py) < 2.4) {
      s.got = true; s.m.visible = false; state.stars++;
      addMoney(100);
      popup('★ ЗВЕЗДА ' + state.stars + '/' + TOTAL_STARS + ' <span class="m">+$100</span>');
      beep(880, 0.12, 'sine', 0.1, 1760); setTimeout(() => beep(1320, 0.2, 'sine', 0.08, 2000), 90);
      for (let k = 0; k < 12; k++) puff(s.x, s.y, s.z, rr(-3, 3), rr(-1, 3), rr(-3, 3), 0.35, 0.7, 0xffd21f, 1);
      if (state.stars === TOTAL_STARS) { addMoney(5000); bigMsg('ВСЕ ЗВЁЗДЫ СОБРАНЫ!', '+$5000', 4); }
    }
  }
}

// =====================================================================
//  Камера
// =====================================================================
const camPos = new T.Vector3(), camLook = new T.Vector3();
let camInit = false, shakeAmt = 0;
function updateCamera(dt, now) {
  let tx, ty, tz, dist, height;
  if (P.mode === 'bike') {
    tx = B.x; ty = B.y + 1.3; tz = B.z; dist = 5.6 + Math.abs(B.fwd) * 0.05; height = 1.1;
    if (now - lastLook > 1.2) camYaw += wrapA(B.yaw - camYaw) * Math.min(1, dt * (2 + Math.abs(B.fwd) * 0.08));
    if (now - lastLook > 1.2) camPitch = damp(camPitch, 0.22, 2, dt);
  } else if (P.mode === 'crash') {
    const p = rider.root.position; tx = p.x; ty = p.y + 0.8; tz = p.z; dist = 6.5; height = 1.5;
  } else {
    tx = P.x; ty = P.y + 1.55; tz = P.z; dist = 4.2; height = 0.6;
  }
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  let cx = tx - Math.sin(camYaw) * cp * dist, cz = tz - Math.cos(camYaw) * cp * dist, cy = ty + sp * dist + height * 0.3;
  cy = Math.max(cy, gridH(cx, cz) + 0.5);
  if (!camInit) { camPos.set(cx, cy, cz); camLook.set(tx, ty, tz); camInit = true; }
  const k = 1 - Math.exp(-dt * (P.mode === 'bike' ? 10 : 12));
  camPos.x += (cx - camPos.x) * k; camPos.y += (cy - camPos.y) * k; camPos.z += (cz - camPos.z) * k;
  camLook.x += (tx - camLook.x) * Math.min(1, k * 1.5); camLook.y += (ty - camLook.y) * Math.min(1, k * 1.5); camLook.z += (tz - camLook.z) * Math.min(1, k * 1.5);
  shakeAmt = Math.max(shakeAmt, B.shake || 0); B.shake = 0; shakeAmt = Math.max(0, shakeAmt - dt * 2);
  camera.position.copy(camPos);
  camera.position.x += (Math.random() - 0.5) * shakeAmt * 0.3; camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.3;
  camera.lookAt(camLook);
  const fov = 62 + (P.mode === 'bike' ? clamp(Math.abs(B.fwd) - 8, 0, 20) * 0.6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 3, dt); camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
  sun.position.set(tx + SUN_DIR.x * 200, ty + SUN_DIR.y * 200, tz + SUN_DIR.z * 200);
  sun.target.position.set(tx, ty, tz);
}

function syncBike() {
  bikeRoot.position.set(B.x, B.y, B.z);
  bikeRoot.rotation.set(0, B.yaw, 0);
  leanG.rotation.z = B.lean;
  pitchG.position.y = P.mode === 'foot' ? 0 : 0;
  pitchG.rotation.x = B.pitch;
  bikeM.rw.rotation.x = B.wheel; bikeM.fw.rotation.x = B.wheel;
  bikeM.steer.rotation.y = -B.steer * (P.mode === 'bike' ? 0.5 / (1 + Math.abs(B.fwd) / 8) : 0.4);
  if (P.mode === 'foot') { leanG.rotation.z = damp(leanG.rotation.z, -0.16, 3, 1 / 60); B.lean = leanG.rotation.z; }
  if (P.mode === 'bike') {
    // лёгкое движение гонщика: наклон в повороте, стойка в воздухе
    const air = !B.onGround;
    rider.torso.rotation.z = -B.steer * 0.12;
    rider.hips.position.y = air ? 0.12 : 0;
    rider.torso.rotation.x = air ? 0.55 : 0.42 + Math.min(0.2, Math.abs(B.fwd) * 0.008);
  }
}

// =====================================================================
//  Главный цикл
// =====================================================================
let lastTs = performance.now(), titleT = 0;
let simNow = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000); lastTs = ts;
  if (!window.__pause) tick(dt, ts / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function tick(dt, now) {
  if (state.playing) {
    const inp = readInput();
    if (P.mode === 'bike') {
      updateBike(dt, inp);
      if (P.mode === 'bike' && inp.use) {
        if (Math.abs(B.fwd) < 4) dismount(); else crash('Спрыгнул на ходу!');
      }
      if (P.mode === 'bike' && Math.abs(B.fwd) < 0.5 && !state.mission) help('Нажми <b>E</b>, чтобы слезть. В прыжке держи <b>S</b> — сальто назад!');
    } else if (P.mode === 'crash') updateCrash(dt);
    else updateFoot(dt, inp);
    updateCars(dt);
    updateStars(dt, now);
    updateMission(dt);
    updateFx(dt);
    syncBike();
    updateCamera(dt, now);
    updateEngine(inp);
    hudTick(dt);
  } else {
    // заставка — камера облетает Захара
    titleT += dt;
    updateCars(dt); updateStars(dt, now); syncBike();
    pose(rider, walkPose(0, 0, false));
    rider.root.position.set(P.x, P.y + 0.78, P.z); rider.root.rotation.set(0, P.yaw + 0.5, 0);
    const a = Math.PI * 0.85 + Math.sin(titleT * 0.15) * 0.6;
    camera.position.set(P.x + Math.sin(a) * 5.5, P.y + 2, P.z + Math.cos(a) * 5.5);
    camera.lookAt(P.x - 0.4, P.y + 1.1, P.z);
    sky.position.copy(camera.position);
    sun.position.set(P.x + SUN_DIR.x * 200, P.y + SUN_DIR.y * 200, P.z + SUN_DIR.z * 200); sun.target.position.set(P.x, P.y, P.z);
  }
  for (const m of MISSIONS) if (m.marker.visible) m.marker.material.opacity = 0.7 + Math.sin(now * 4) * 0.2;
}
// отладка: прогнать симуляцию без отрисовки
function sim(sec, ctl) {
  for (let i = 0; i < sec * 60; i++) { simNow += 1 / 60; if (ctl) ctl(i / 60); tick(1 / 60, 1000 + simNow); }
}
function updateEngine(inp) {
  if (!engine) return;
  const t = audio.currentTime, on = P.mode === 'bike';
  const spd = Math.abs(B.fwd), gas = on && inp.up;
  const f = 42 + spd * 3.2 + (gas ? 18 : 0) + (!B.onGround && gas ? 35 : 0);
  engine.o1.frequency.setTargetAtTime(f, t, 0.06); engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
  engine.f.frequency.setTargetAtTime(400 + spd * 45 + (gas ? 500 : 0), t, 0.06);
  engine.g.gain.setTargetAtTime(muted ? 0 : on ? 0.03 + (gas ? 0.025 : 0) : 0.012, t, 0.1);
}
function hudTick(dt) {
  $('money').textContent = '$' + state.money.toLocaleString('ru-RU');
  $('starsHud').textContent = '★ ' + state.stars + '/' + TOTAL_STARS;
  $('speed').innerHTML = P.mode === 'bike' ? Math.round(Math.abs(B.fwd) * 3.6) + '<small>км/ч</small>' : '';
  if (!state.mission) { objective(''); timer(''); }
  helpT -= dt; if (helpT <= 0) $('help').classList.add('hidden');
  bigT -= dt; if (bigT <= 0) $('big').classList.add('hidden');
  popT -= dt; if (popT <= 0) $('popup').classList.add('hidden');
  drawRadar();
}

// =====================================================================
//  Старт
// =====================================================================
syncBike();
function start() {
  if (state.playing) return;
  state.playing = true;
  $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); $('btns').classList.remove('hidden');
  if (isTouch) { $('touch').classList.remove('hidden'); document.body.classList.add('touch'); }
  initAudio(); if (audio && audio.state === 'suspended') audio.resume();
  camYaw = P.yaw; camPitch = 0.25;
  bigMsg('МОТОКРОСС ЗАХАРА', 'Садись на мотоцикл и найди жёлтые маркеры миссий', 3.5);
}
$('play').addEventListener('click', start);
$('bSound').addEventListener('click', toggleSound);
$('bReset').addEventListener('click', () => resetBike());
$('play').disabled = false; $('play').textContent = 'Играть';

window.__game = { renderer, scene, rider, syncBike, updateCamera, sim, tick, B, P, state, keys, touch, start, mount, cars, ZONES, LOOP, PUDDLES, STARS, MISSIONS, RAMPS, TRACK, groundH, startMission, camera };
requestAnimationFrame(frame);
})();
