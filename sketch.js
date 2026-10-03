// sketch.js - Packet Galaxy v4 (realistic planets, motion, zoom)
// Sun = your laptop. Planets = servers (size = packets).
// Rocky worlds = TCP, gas giants = UDP. Rings = top 3 talkers. Moons = server used 2+ ports.
// Asteroid belt = DNS lookups (red = suspicious). Comets = port scans.

let galaxy;
let maxPackets = 1;
let time = 0;
let planets = [];
let asteroids = [];
let comets = [];
let stars = [];
let nebula;
let skyLayer;
let sunCanvas;

// Controls: speed of time, camera zoom and focus
const SPEEDS = [0, 0.25, 0.5, 1, 2, 4, 8];
let speedIndex = 3;
let zoom = 1, zoomTarget = 1, camX = 0, camY = 0;
let focus = null;

const ORBIT_SPEED = 0.01;                  // turn this up or down to change how fast planets orbit
const TILT = 0.42;                          // how much the orbit plane is squashed (camera height)
const COS_TILT = Math.sqrt(1 - TILT * TILT);
const TEX_W = 192, TEX_H = 96;               // size of each planet's surface map

// Surface styles. TCP servers become rocky worlds, UDP servers become gas giants.
const ROCKY_TYPES = ["earth", "mars", "ice", "venus", "moon"];
const GAS_PALETTES = [
  [[235, 200, 255], [170, 110, 230], [110, 60, 170]],   // violet giant
  [[255, 215, 235], [220, 120, 190], [140, 60, 130]],   // pink giant
  [[215, 220, 255], [140, 130, 235], [70, 60, 160]]     // indigo giant
];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);     // draw 1 pixel per screen pixel: much less work on high-DPI laptops
  frameRate(30);       // a steady 30 fps records more smoothly than an uneven 60
  // Use your own galaxy.json if it exists, otherwise the safe sample data (for GitHub Pages)
  loadJSON("galaxy.json", gotData, () => loadJSON("sample_galaxy.json", gotData));
}

function gotData(data) {
  for (const s of data.stars) maxPackets = max(maxPackets, s.packets);

  data.stars.forEach((s, i) => {
    const h = hashIP(s.ip);
    const isGas = s.protocol === "UDP";
    const type = isGas ? "gas" : ROCKY_TYPES[h % ROCKY_TYPES.length];
    const palette = GAS_PALETTES[h % GAS_PALETTES.length];
    planets.push({
      info: s,
      type,
      palette,
      tex: makeTexture(type, palette, h % 1000),
      clouds: type === "earth" ? makeClouds(h % 1000) : null,
      axis: type === "earth" ? 0.41 : type === "gas" ? 0.05 : ((h % 9) - 4) * 0.08,   // axial tilt
      rank: i + 1,
      size: map(log(s.packets + 1), 0, log(maxPackets + 1), 9, 42),
      orbit: i,                                   // list position = distance from the sun
      start: i * 2.39996,                         // golden angle: spreads planets evenly around the sun
      spin: 0.008 + (h % 7) * 0.002,              // how fast it rotates on its axis
      ringed: i < 3,                              // top 3 talkers get rings
      moons: s.ports.length >= 2 ? min(s.ports.length, 4) : 0,
      canvas: document.createElement("canvas")
    });
  });

  const dns = data.dns || [];
  dns.forEach((q, i) => {
    const shape = [];
    for (let k = 0; k < 8; k++) shape.push(random(0.6, 1.1));
    asteroids.push({ info: q, angle: (TWO_PI * i) / max(dns.length, 1), wobble: random(-16, 16),
                     size: q.odd ? 11 : random(3, 6.5), shape });
  });

  for (const a of data.alerts || []) comets.push(new Comet(a));
  sunCanvas = document.createElement("canvas");
  buildBackground();
  galaxy = data;
}

function draw() {
  background(2, 2, 10);
  if (!galaxy) return;
  time += SPEEDS[speedIndex];

  image(skyLayer, 0, 0);          // pre-drawn nebula + stars (drawn once, reused every frame)
  drawStars();                     // only the bright stars twinkle live

  // Smooth camera: follow the focused planet, or drift back to the sun
  const tx = focus ? focus.x : 0, ty = focus ? focus.y : 0;
  camX += (tx - camX) * 0.08;
  camY += (ty - camY) * 0.08;
  zoom += (zoomTarget - zoom) * 0.08;

  translate(width / 2, height / 2);
  scale(zoom);
  translate(-camX, -camY);
  const edge = min(width / 2 - 60, (height / 2 - 50) / TILT);

  drawOrbits(edge);

  // Position every planet for this frame
  const n = planets.length;
  for (const p of planets) {
    p.r = map(p.orbit, 0, max(n - 1, 1), 150, edge * 0.85);
    const a = p.start + time * ORBIT_SPEED / Math.sqrt(p.r / 100); // inner planets a bit faster
    p.X = p.r * cos(a);                                        // across the screen
    p.Z = p.r * sin(a);                                        // + = towards you, - = behind the sun
    p.x = p.X;
    p.y = p.Z * TILT;
    p.depth = sin(a);
    p.d = p.size * (1 + 0.15 * p.depth);
    p.a = a;
  }

  for (const p of planets) drawTrail(p);

  const behind = planets.filter(p => p.depth < 0).sort((a, b) => a.depth - b.depth);
  const front = planets.filter(p => p.depth >= 0).sort((a, b) => a.depth - b.depth);

  drawAsteroids(edge, true);
  for (const p of behind) drawPlanet(p);
  drawSun();
  for (const p of front) drawPlanet(p);
  drawAsteroids(edge, false);

  for (const c of comets) { c.update(); c.show(); }

  // Hover labels (mouse position converted into the zoomed world)
  let hovered = null;
  const mx = (mouseX - width / 2) / zoom + camX, my = (mouseY - height / 2) / zoom + camY;
  for (const p of planets) {
    if (dist(mx, my, p.x, p.y) < max(p.d / 2, 6)) {
      hovered = { x: p.x, y: p.y, lines: [p.info.ip, p.info.protocol + " · " + p.info.packets + " packets",
                  "ports: " + p.info.ports.join(", ")] };
    }
  }
  for (const s of asteroids) {
    if (s.x !== undefined && dist(mx, my, s.x, s.y) < 8) {
      hovered = { x: s.x, y: s.y, lines: [s.info.name, s.info.count + " lookups" + (s.info.odd ? " · SUSPICIOUS" : "")] };
    }
  }
  if (hovered && !focus) drawLabel(hovered);
  drawLegend();
  if (focus) drawInfoCard(focus);
  drawControls();
}

// =====================================================================
// PLANET SURFACES: each planet gets its own map, painted once with noise
// =====================================================================
function sphereNoise(lon, lat, scale, off) {
  // Sample noise on a sphere so the map has no seam where it wraps around
  const cl = Math.cos(lat);
  return noise(cl * Math.cos(lon) * scale + off, cl * Math.sin(lon) * scale + off * 1.7, Math.sin(lat) * scale + off * 0.3);
}

function makeTexture(type, palette, seed) {
  const tex = new Float32Array(TEX_W * TEX_H * 3);
  const off = seed * 3.1;
  for (let j = 0; j < TEX_H; j++) {
    const lat = (0.5 - (j + 0.5) / TEX_H) * Math.PI;
    for (let i = 0; i < TEX_W; i++) {
      const lon = (i / TEX_W) * Math.PI * 2;
      const h = sphereNoise(lon, lat, 1.8, off);
      let c;

      if (type === "earth") {
        if (h > 0.52) c = blend3([60, 120, 50], [150, 130, 80], (h - 0.52) * 5);      // land: green to brown
        else c = blend3([10, 30, 90], [30, 90, 160], h * 1.8);                          // ocean: deep to shallow
        if (Math.abs(lat) > 1.15 + 0.2 * h) c = [235, 240, 250];                     // polar ice
      } else if (type === "mars") {
        c = blend3([120, 50, 25], [215, 120, 70], h);
        if (sphereNoise(lon, lat, 4, off + 9) < 0.35) c = blend3(c, [80, 35, 20], 0.5);  // dark plains
        if (Math.abs(lat) > 1.35) c = [240, 235, 230];                               // small ice cap
      } else if (type === "ice") {
        c = blend3([150, 190, 225], [235, 245, 255], h);
        if (Math.abs(sphereNoise(lon, lat, 3, off + 20) - 0.5) < 0.018) c = [90, 130, 180]; // cracks
      } else if (type === "venus") {
        const swirl = sphereNoise(lon, lat * 2.5, 2.2, off + 30);
        c = blend3([200, 160, 90], [250, 225, 170], Math.sin(lat * 6 + swirl * 8) * 0.5 + 0.5);
      } else if (type === "moon") {
        c = blend3([90, 90, 95], [185, 185, 190], h);
        const crater = sphereNoise(lon, lat, 7, off + 70);
        if (crater < 0.32) c = blend3(c, [60, 60, 65], 0.6);                            // craters
        if (crater > 0.3 && crater < 0.33) c = [215, 215, 220];                      // bright crater rims
      } else {
        // Gas giant: turbulent bands plus one big storm
        const turb = sphereNoise(lon, lat, 2.5, off + 40);
        const b = Math.sin(lat * 9 + turb * 7) * 0.5 + 0.5;
        c = b < 0.5 ? blend3(palette[2], palette[1], b * 2) : blend3(palette[1], palette[0], (b - 0.5) * 2);
        const dLon = Math.atan2(Math.sin(lon - 1.2), Math.cos(lon - 1.2));
        const storm = (dLon * dLon) / 0.08 + ((lat + 0.35) * (lat + 0.35)) / 0.012;
        if (storm < 1) c = blend3(c, [255, 160, 150], 0.7 * (1 - storm));
      }
      const k = (j * TEX_W + i) * 3;
      tex[k] = c[0]; tex[k + 1] = c[1]; tex[k + 2] = c[2];
    }
  }
  return tex;
}

// Earth's clouds live on their own layer so they can drift over the ground
function makeClouds(seed) {
  const cl = new Float32Array(TEX_W * TEX_H);
  for (let j = 0; j < TEX_H; j++) {
    const lat = (0.5 - (j + 0.5) / TEX_H) * Math.PI;
    for (let i = 0; i < TEX_W; i++) {
      const lon = (i / TEX_W) * Math.PI * 2;
      const c = sphereNoise(lon, lat * 1.3, 3.2, seed * 3.1 + 50);
      cl[j * TEX_W + i] = Math.max(0, Math.min((c - 0.54) * 5, 0.9));
    }
  }
  return cl;
}

// Smooth (bilinear) lookup in a surface map, so close-ups are not blocky
function sampleTex(tex, u, v, out) {
  const x = u * TEX_W - 0.5, y = Math.max(0, Math.min(TEX_H - 1.001, v * TEX_H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const xa = ((x0 % TEX_W) + TEX_W) % TEX_W, xb = (xa + 1) % TEX_W, yb = y0 + 1;
  const i00 = (y0 * TEX_W + xa) * 3, i10 = (y0 * TEX_W + xb) * 3, i01 = (yb * TEX_W + xa) * 3, i11 = (yb * TEX_W + xb) * 3;
  for (let c = 0; c < 3; c++) {
    const top = tex[i00 + c] + (tex[i10 + c] - tex[i00 + c]) * fx;
    const bot = tex[i01 + c] + (tex[i11 + c] - tex[i01 + c]) * fx;
    out[c] = top + (bot - top) * fy;
  }
}

function sampleClouds(cl, u, v) {
  const x = u * TEX_W - 0.5, y = Math.max(0, Math.min(TEX_H - 1.001, v * TEX_H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const xa = ((x0 % TEX_W) + TEX_W) % TEX_W, xb = (xa + 1) % TEX_W;
  const top = cl[y0 * TEX_W + xa] + (cl[y0 * TEX_W + xb] - cl[y0 * TEX_W + xa]) * fx;
  const bot = cl[(y0 + 1) * TEX_W + xa] + (cl[(y0 + 1) * TEX_W + xb] - cl[(y0 + 1) * TEX_W + xa]) * fx;
  return top + (bot - top) * fy;
}

function blend3(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// =====================================================================
// DRAWING A PLANET: wrap its map around a sphere, light it from the sun
// =====================================================================
function drawPlanet(p) {
  const ctx = drawingContext;
  const d = p.d;

  // Direction from the planet to the sun, in the camera's view
  let lx = -p.X, ly = -p.Z * TILT, lz = -p.Z * COS_TILT;
  let ll = Math.hypot(lx, ly, lz) || 1;
  lx /= ll; ly /= ll; lz /= ll;
  lz += 0.55;                                   // a little extra light from the camera side (artistic)
  ll = Math.hypot(lx, ly, lz) || 1;
  lx /= ll; ly /= ll; lz /= ll;

  if (p.ringed) drawRing(p, true);
  drawMoons(p, true);

  // Faint atmosphere halo so night-side planets are still visible
  const [hr, hg, hb] = p.type === "gas" ? p.palette[1] : haloColour(p.type);
  const glow = ctx.createRadialGradient(p.x, p.y, d * 0.45, p.x, p.y, d * 0.85);
  glow.addColorStop(0, `rgba(${hr}, ${hg}, ${hb}, 0.28)`);
  glow.addColorStop(1, `rgba(${hr}, ${hg}, ${hb}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(p.x, p.y, d * 0.85, 0, TWO_PI); ctx.fill();

  // Skip the expensive painting if the planet is off screen
  const sx = (p.x - camX) * zoom + width / 2, sy = (p.y - camY) * zoom + height / 2, sr = d * zoom;
  if (sx < -sr || sx > width + sr || sy < -sr || sy > height + sr) return;

  // Paint the sphere pixel by pixel into the planet's own small canvas
  // (more pixels when zoomed in, so close-ups stay sharp)
  const pd = pixelDensity();
  const cap = p === focus ? 280 : 100;
  const D = max(4, Math.min(cap, Math.round(d * pd * zoom)));
  // Repaint only every other frame (planets turn slowly, so nobody can tell)
  const repaint = p.canvas.width !== D || p === focus || (frameCount + p.orbit) % 2 === 0;
  if (!repaint) {
    ctx.drawImage(p.canvas, p.x - d / 2, p.y - d / 2, d, d);
    drawMoons(p, false);
    if (p.ringed) drawRing(p, false);
    return;
  }
  if (p.canvas.width !== D) { p.canvas.width = D; p.canvas.height = D; p.img = null; }
  const pctx = p.canvas.getContext("2d");
  if (!p.img) p.img = pctx.createImageData(D, D);
  const px = p.img.data;
  const R = D / 2, rot = time * p.spin;
  const ca = Math.cos(p.axis), sa = Math.sin(p.axis);
  const rgb = [0, 0, 0];
  const atm = p.type === "earth" || p.type === "venus" || p.type === "gas";

  for (let j = 0; j < D; j++) {
    const ny = (j + 0.5 - R) / R;
    for (let i = 0; i < D; i++) {
      const nx = (i + 0.5 - R) / R;
      const r2 = nx * nx + ny * ny;
      const k = (j * D + i) * 4;
      if (r2 > 1) { px[k + 3] = 0; continue; }
      const nz = Math.sqrt(1 - r2);

      // Which point of the surface map is under this pixel? (tilted axis, spinning)
      const tx2 = nx * ca - ny * sa, ty2 = nx * sa + ny * ca;
      const lat = Math.asin(Math.max(-1, Math.min(1, -ty2)));
      const lon = Math.atan2(tx2, nz);
      let u = (lon + rot) / (Math.PI * 2);
      u = u - Math.floor(u);
      const v = 0.5 - lat / Math.PI;
      sampleTex(p.tex, u, v, rgb);

      // Sunlight: bright where the surface faces the sun, dark on the night side
      const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
      const light = 0.12 + 1.1 * diffuse * (0.75 + 0.25 * nz);
      let r = rgb[0], g = rgb[1], b = rgb[2];

      // Earth's clouds drift a little faster than the ground below them
      if (p.clouds) {
        let cu = (lon + rot * 1.35) / (Math.PI * 2);
        cu = cu - Math.floor(cu);
        const cov = sampleClouds(p.clouds, cu, v);
        r += (255 - r) * cov; g += (255 - g) * cov; b += (255 - b) * cov;
      }
      r *= light; g *= light; b *= light;

      // Thin glowing atmosphere at the edge of the lit side
      if (atm) {
        const rim = Math.pow(1 - nz, 3) * Math.max(0, diffuse + 0.25);
        r += hr * rim; g += hg * rim; b += hb * rim;
      }
      px[k] = r; px[k + 1] = g; px[k + 2] = b;
      px[k + 3] = Math.min(1, (1 - Math.sqrt(r2)) * R) * 255;   // smooth edge
    }
  }
  pctx.putImageData(p.img, 0, 0);
  ctx.drawImage(p.canvas, p.x - d / 2, p.y - d / 2, d, d);

  drawMoons(p, false);
  if (p.ringed) drawRing(p, false);
}

// Fading trail behind each planet so you can see it travelling round the sun
function drawTrail(p) {
  const [r, g, b] = p.type === "gas" ? p.palette[1] : haloColour(p.type);
  const len = min(0.9, 140 / p.r);            // about 140 pixels of orbit
  const steps = 14;
  noFill();
  for (let k = 0; k < steps; k++) {
    const a1 = p.a - (len * k) / steps, a2 = p.a - (len * (k + 1)) / steps;
    stroke(r, g, b, 120 * (1 - k / steps));
    strokeWeight(((1 + p.size * 0.08) * (1 - k / steps) + 0.3) / zoom);
    line(p.r * cos(a1), p.r * sin(a1) * TILT, p.r * cos(a2), p.r * sin(a2) * TILT);
  }
  noStroke();
}

function typeName(p) {
  return { earth: "Earth-like world", mars: "Desert world", ice: "Ice world", venus: "Cloudy world",
           moon: "Cratered world", gas: "Gas giant" }[p.type];
}

// Info card for the planet you clicked
function drawInfoCard(p) {
  resetMatrix();
  const lines = [
    [typeName(p), 16, [255, 255, 255]],
    ["Server " + p.info.ip, 13, [200, 210, 240]],
    ["#" + p.rank + " busiest connection", 13, [200, 210, 240]],
    [p.info.protocol + " · " + p.info.packets + " packets · " + nf(p.info.bytes / 1024, 0, 1) + " KB", 13, [200, 210, 240]],
    ["Ports: " + p.info.ports.join(", "), 13, [200, 210, 240]],
    [p.moons ? p.moons + " moons (several ports used)" : "No moons (one port)", 13, [200, 210, 240]],
    ["Click empty space to zoom back out", 11, [150, 160, 190]]
  ];
  const w = 300, x = width - w - 24, y = 24;
  fill(8, 10, 28, 215); stroke(120, 150, 255, 120);
  rect(x, y, w, 30 + lines.length * 22, 10);
  noStroke();
  lines.forEach(([t, sz, c], i) => { textSize(sz); fill(c); text(t, x + 18, y + 32 + i * 22); });
}

function drawControls() {
  resetMatrix();
  noStroke();
  textSize(11); fill(160, 170, 200);
  const sp = SPEEDS[speedIndex];
  text("Click a planet to fly to it · scroll to zoom · SPACE pause · + / - speed (" +
       (sp === 0 ? "paused" : sp + "x") + ") · R reset", 24, height - 20);
}

function keyPressed() {
  if (key === " ") speedIndex = speedIndex === 0 ? 3 : 0;
  else if (key === "+" || key === "=") speedIndex = min(speedIndex + 1, SPEEDS.length - 1);
  else if (key === "-" || key === "_") speedIndex = max(speedIndex - 1, 1);
  else if (key === "r" || key === "R") { focus = null; zoomTarget = 1; speedIndex = 3; time = 0; }  // time = 0 re-spreads the planets
  else return true;          // let other keys (like F11 fullscreen) work normally
  return false;
}

function mouseWheel(event) {
  zoomTarget = constrain(zoomTarget * (event.delta > 0 ? 0.9 : 1.1), 0.6, 10);
  return false;
}

function mousePressed() {
  if (!galaxy) return;
  const mx = (mouseX - width / 2) / zoom + camX, my = (mouseY - height / 2) / zoom + camY;
  let hit = null;
  for (const p of planets) if (dist(mx, my, p.x, p.y) < max(p.d / 2, 8)) hit = p;
  if (hit) {
    focus = hit;
    zoomTarget = constrain(min(width, height) * 0.35 / hit.size, 2, 10);   // planet fills about a third of the screen
  } else {
    focus = null;
    zoomTarget = 1;
  }
}

function haloColour(type) {
  return { earth: [100, 170, 255], mars: [230, 140, 90], ice: [180, 220, 255],
           venus: [250, 220, 160], moon: [180, 180, 190] }[type];
}

function drawRing(p, backHalf) {
  const ctx = drawingContext;
  const base = p.type === "gas" ? p.palette[0] : [225, 215, 195];
  const bands = [[1.3, 0.35], [1.45, 0.6], [1.6, 0.25], [1.75, 0.55], [1.95, 0.3], [2.1, 0.15]];
  const shade = p.depth > 0.3 ? 0.55 : 1;      // rings look darker when we see their shadowed side
  ctx.save();
  ctx.lineCap = "butt";                         // no round blobs at the ends of each ring band
  ctx.lineWidth = max(1, p.d * 0.07);
  for (const [scale, alpha] of bands) {
    ctx.strokeStyle = `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha * shade})`;
    ctx.beginPath();
    const rx = (p.d / 2) * scale, ry = rx * 0.3;
    if (backHalf) ctx.ellipse(p.x, p.y, rx, ry, -0.25, PI, TWO_PI);
    else ctx.ellipse(p.x, p.y, rx, ry, -0.25, 0, PI);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoons(p, backHalf) {
  const ctx = drawingContext;
  for (let k = 0; k < p.moons; k++) {
    const a = time * (0.025 + 0.012 * k) + k * 2.4 + p.start;   // each moon has its own speed and start
    if ((sin(a) < 0) !== backHalf) continue;
    const orbit = p.d * (0.8 + 0.3 * k);
    const mx = p.x + cos(a) * orbit, my = p.y + sin(a) * orbit * 0.5;
    const md = max(3, p.d * 0.16);
    const g = ctx.createRadialGradient(mx - md * 0.2, my - md * 0.2, 0.5, mx, my, md / 2);
    g.addColorStop(0, "rgb(230, 230, 235)");
    g.addColorStop(1, "rgb(70, 70, 80)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(mx, my, md / 2, 0, TWO_PI); ctx.fill();
  }
}

function drawOrbits(edge) {
  noFill();
  const n = planets.length;
  for (let i = 0; i < n; i++) {
    const r = map(i, 0, max(n - 1, 1), 150, edge * 0.85);
    stroke(120, 140, 200, 12);
    strokeWeight(1 / zoom);
    ellipse(0, 0, r * 2, r * 2 * TILT);
  }
  noStroke();
}

// =====================================================================
// THE SUN: boiling surface, darker edges, sunspots and a streaming corona
// =====================================================================
function drawSun() {
  const ctx = drawingContext;
  const R0 = 38;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // Wide soft glow
  let g = ctx.createRadialGradient(0, 0, R0 * 0.8, 0, 0, R0 * 5);
  g.addColorStop(0, "rgba(255, 190, 90, 0.45)");
  g.addColorStop(0.35, "rgba(255, 130, 40, 0.12)");
  g.addColorStop(1, "rgba(255, 100, 20, 0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R0 * 5, 0, TWO_PI); ctx.fill();

  // Corona streamers that slowly change length
  for (let i = 0; i < 24; i++) {
    const a = (TWO_PI * i) / 24 + 0.05 * sin(time * 0.01 + i);
    const len = R0 * (1.6 + 1.8 * noise(i * 0.7, time * 0.006));
    const w = 0.035;
    const ray = ctx.createLinearGradient(0, 0, cos(a) * len, sin(a) * len);
    ray.addColorStop(0, "rgba(255, 210, 140, 0.13)");
    ray.addColorStop(1, "rgba(255, 160, 80, 0)");
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(cos(a - w) * R0 * 0.9, sin(a - w) * R0 * 0.9);
    ctx.lineTo(cos(a) * len, sin(a) * len);
    ctx.lineTo(cos(a + w) * R0 * 0.9, sin(a + w) * R0 * 0.9);
    ctx.fill();
  }
  ctx.restore();

  // Boiling surface (redrawn every 3 frames to stay fast)
  const pd = pixelDensity();
  const D = Math.round(R0 * 2 * pd * Math.min(zoom, 3));
  if (sunCanvas.width !== D || frameCount % 4 === 1) {
    sunCanvas.width = D; sunCanvas.height = D;
    const sctx = sunCanvas.getContext("2d");
    const img = sctx.createImageData(D, D);
    const px = img.data, R = D / 2, t = time * 0.004;
    for (let j = 0; j < D; j++) {
      const ny = (j + 0.5 - R) / R;
      for (let i = 0; i < D; i++) {
        const nx = (i + 0.5 - R) / R;
        const r2 = nx * nx + ny * ny;
        const k = (j * D + i) * 4;
        if (r2 > 1) { px[k + 3] = 0; continue; }
        const nz = Math.sqrt(1 - r2);
        const gran = noise(nx * 5 + 10, ny * 5 + 10, t);           // granules
        const spot = noise(nx * 1.5 + 40, ny * 1.5, t * 0.3);       // sunspots
        const limb = 0.55 + 0.45 * Math.pow(nz, 0.6);               // edges look darker
        let r = 255, gg = 150 + 90 * gran, b = 40 + 110 * gran * gran;
        if (spot < 0.22) { r *= 0.55; gg *= 0.45; b *= 0.4; }
        px[k] = r * limb; px[k + 1] = gg * limb; px[k + 2] = b * limb;
        px[k + 3] = Math.min(1, (1 - Math.sqrt(r2)) * R) * 255;
      }
    }
    sctx.putImageData(img, 0, 0);
  }
  ctx.drawImage(sunCanvas, -R0, -R0, R0 * 2, R0 * 2);
}

// =====================================================================
// ASTEROID BELT (DNS lookups)
// =====================================================================
function drawAsteroids(edge, backHalf) {
  for (const s of asteroids) {
    const a = s.angle - time * 0.0006;
    if ((sin(a) < 0) !== backHalf) continue;
    const r = edge + s.wobble;
    s.x = r * cos(a);
    s.y = r * sin(a) * TILT;

    push();
    translate(s.x, s.y);
    rotate(a * 3 + time * 0.01);
    if (s.info.odd) {
      const pulse = 1 + 0.3 * sin(time * 0.1);
      const ctx = drawingContext;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 22 * pulse);
      g.addColorStop(0, "rgba(255, 60, 60, 0.7)");
      g.addColorStop(1, "rgba(255, 60, 60, 0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 22 * pulse, 0, TWO_PI); ctx.fill();
      fill(255, 80, 70);
    } else {
      fill(125, 115, 108);
    }
    stroke(0, 0, 0, 80);
    strokeWeight(0.8 / zoom);
    beginShape();
    for (let k = 0; k < s.shape.length; k++) {
      const ang = (TWO_PI * k) / s.shape.length;
      vertex(cos(ang) * s.size * s.shape[k], sin(ang) * s.size * s.shape[k]);
    }
    endShape(CLOSE);
    noStroke();
    fill(255, 255, 255, 35);                       // sunlit highlight
    circle(-s.size * 0.25, -s.size * 0.25, s.size * 0.6);
    pop();
  }
}

// =====================================================================
// COMETS (port scans)
// =====================================================================
class Comet {
  constructor(alert) { this.alert = alert; this.reset(); }
  reset() {
    const a = random(TWO_PI), r = max(width, height) * 0.6;
    this.pos = createVector(r * cos(a), r * sin(a) * TILT);
    this.vel = p5.Vector.mult(this.pos, -0.006).rotate(0.25);
    this.dust = [];
  }
  update() {
    const sp = SPEEDS[speedIndex];
    if (sp === 0) return;                        // paused
    this.pos.add(p5.Vector.mult(this.vel, sp));
    this.dust.push({ x: this.pos.x + random(-3, 3), y: this.pos.y + random(-3, 3), life: 255 });
    for (const p of this.dust) p.life -= 6 * sp;
    this.dust = this.dust.filter(p => p.life > 0);
    if (this.pos.mag() < 50 || this.pos.mag() > max(width, height)) this.reset();
  }
  show() {
    const ctx = drawingContext;
    const z = 1 / zoom;                          // keep the comet the same size on screen when zoomed
    const away = this.pos.copy().normalize().mult(170 * z);
    const tail = ctx.createLinearGradient(this.pos.x, this.pos.y, this.pos.x + away.x, this.pos.y + away.y);
    tail.addColorStop(0, "rgba(150, 210, 255, 0.85)");
    tail.addColorStop(1, "rgba(150, 210, 255, 0)");
    ctx.strokeStyle = tail;
    ctx.lineWidth = 3 * z;
    ctx.beginPath(); ctx.moveTo(this.pos.x, this.pos.y);
    ctx.lineTo(this.pos.x + away.x, this.pos.y + away.y); ctx.stroke();

    noStroke();
    for (const p of this.dust) { fill(255, 170, 80, p.life * 0.6); circle(p.x, p.y, 3 * z); }

    const g = ctx.createRadialGradient(this.pos.x, this.pos.y, z, this.pos.x, this.pos.y, 16 * z);
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(1, "rgba(255, 200, 150, 0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, 16 * z, 0, TWO_PI); ctx.fill();

    fill(255); textSize(11 * z);
    text("PORT SCAN · " + this.alert.ports + " ports", this.pos.x + 16 * z, this.pos.y - 8 * z);
  }
}

// =====================================================================
// BACKGROUND: nebula clouds, Milky Way band, twinkling stars
// =====================================================================
function buildBackground() {
  nebula = createGraphics(ceil(width / 6), ceil(height / 6));
  nebula.pixelDensity(1);
  nebula.loadPixels();
  const W = nebula.width, H = nebula.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n1 = noise(x * 0.025, y * 0.025);
      const n2 = noise(x * 0.04 + 100, y * 0.04 + 100);
      // distance from a diagonal "Milky Way" line across the sky
      const band = Math.abs((x / W) * 0.55 - (y / H) + 0.25);
      const milky = Math.exp(-band * band / 0.012) * (0.4 + 0.6 * noise(x * 0.08 + 300, y * 0.08));
      const cloud = pow(max(n1 - 0.35, 0) * 1.8, 2) * 0.5;
      const i = 4 * (y * W + x);
      nebula.pixels[i] = 60 + 120 * n2 + 120 * milky;
      nebula.pixels[i + 1] = 30 + 40 * n1 + 110 * milky;
      nebula.pixels[i + 2] = 120 + 100 * n1 + 90 * milky;
      nebula.pixels[i + 3] = 255 * min(cloud + milky * 0.35, 0.8);
    }
  }
  nebula.updatePixels();

  stars = [];
  skyLayer = createGraphics(width, height);
  skyLayer.pixelDensity(1);
  skyLayer.image(nebula, 0, 0, width, height);
  skyLayer.noStroke();
  for (let i = 0; i < 700; i++) {
    const tint = random([[255, 255, 255], [190, 210, 255], [255, 230, 190], [255, 200, 170]]);
    let x = random(width), y = random(height);
    if (i < 300) {                                   // extra stars packed along the Milky Way
      const t = random();
      x = t * width;
      y = (t * 0.55 + 0.25) * height + randomGaussian(0, height * 0.06);
    }
    const s = random() < 0.03 ? random(2, 3) : random(0.4, 1.5);
    if (s > 1.2) {
      stars.push({ x, y, s, c: tint, phase: random(TWO_PI), speed: random(0.01, 0.05) });   // twinkles live
    } else {
      skyLayer.fill(tint[0], tint[1], tint[2], random(120, 230));                          // baked in once
      skyLayer.circle(x, y, s);
    }
  }
}

function drawStars() {
  noStroke();
  for (const s of stars) {
    const tw = 0.55 + 0.45 * sin(frameCount * s.speed + s.phase);
    fill(s.c[0], s.c[1], s.c[2], 255 * tw);
    circle(s.x, s.y, s.s);
    if (s.s > 2) {
      stroke(s.c[0], s.c[1], s.c[2], 90 * tw);
      line(s.x - 5, s.y, s.x + 5, s.y); line(s.x, s.y - 5, s.x, s.y + 5);
      noStroke();
    }
  }
}

// =====================================================================
// LABELS AND LEGEND
// =====================================================================
function drawLabel(h) {
  textSize(12);
  const w = max(h.lines.map(l => textWidth(l))) + 20;
  fill(10, 12, 30, 220); stroke(120, 150, 255, 120);
  rect(h.x + 14, h.y - 12, w, h.lines.length * 16 + 10, 8);
  noStroke(); fill(255);
  h.lines.forEach((l, i) => text(l, h.x + 24, h.y + 5 + i * 16));
}

function drawLegend() {
  resetMatrix();
  noStroke();
  textSize(15); fill(255);
  text("PACKET GALAXY", 24, 34);
  textSize(12); fill(180, 190, 220);
  text(galaxy.stars.length + " servers · " + (galaxy.dns || []).length + " DNS lookups · " +
       alertCount() + (alertCount() === 1 ? " alert" : " alerts"), 24, 54);
  const rows = [
    [[255, 200, 90], "Sun = my laptop"],
    [[90, 150, 220], "Rocky planet = TCP server (size = packets)"],
    [[190, 120, 240], "Gas giant = UDP server"],
    [[225, 215, 195], "Rings = top 3 talkers"],
    [[200, 200, 210], "Moons = server used 2+ ports"],
    [[125, 115, 108], "Asteroid = DNS lookup"],
    [[255, 70, 70], "Red asteroid = suspicious DNS"],
    [[255, 180, 100], "Comet = port scan"]
  ];
  rows.forEach(([c, label], i) => { fill(c); circle(30, 76 + i * 18, 8); fill(210); text(label, 42, 80 + i * 18); });
}

// Port scans + suspicious DNS names
function alertCount() {
  return (galaxy.alerts || []).length + (galaxy.dns || []).filter(q => q.odd).length;
}

// Same IP always gets the same look
function hashIP(ip) {
  let h = 0;
  for (const ch of ip) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildBackground();
}