'use strict';

// ---------- Settings ----------
const DEFAULTS = {
  text: '', uppercase: true, textSize: 24, autoFit: true, autoWrap: true, lineHeight: 95, textY: 45, letterSpacing: 2,
  textColor: '#e07a1f', strokeColor: '#2a1606', stroke: 6, textOnTop: false,
  nameBg: 'parchment',
  contrast: 1.1, brightness: 25,
  boxW: 25, boxH: 50, border: 0.6, gap: 1.6, frameColor: '#000000', dpi: 300,
  frameStyle: 'black', fantasyBorder: 2.4, gemColor: '#b3122a',
};
const FONT = 'DisplayArtThree';
const STORE_KEY = 'miniature-maker-settings';

let S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (_) {}
// v2: brighter default B/W. Lift settings saved with the old default.
if (!S.version) { if (S.brightness === 0) S.brightness = DEFAULTS.brightness; S.version = 2; }
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (_) {} };

// Crop state: image center relative to the box (fractions of box w/h) and zoom relative to "cover".
let img = null;
const crop = { cx: 0.5, cy: 0.5, zoom: 1, flip: false };

const $ = (id) => document.getElementById(id);

// ---------- Font ----------
async function loadFont() {
  const bin = atob(window.DISPLAY_ART_THREE_B64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const face = new FontFace(FONT, buf.buffer);
  await face.load();
  document.fonts.add(face);
}

// ---------- Crop geometry ----------
function coverScale(w, h) { return Math.max(w / img.width, h / img.height); }

// Width/height ratio of the picture area (frame excluded).
function boxAspect() { const L = layoutMm(); return L.bw / L.bh; }

// Size of the drawn image as fractions of the box.
function imgFrac() {
  const aspect = boxAspect();
  const w = aspect, h = 1;
  const s = coverScale(w, h) * crop.zoom;
  return { fw: (img.width * s) / w, fh: (img.height * s) / h };
}

function clampCrop() {
  if (!img || !$('clamp').checked) return;
  crop.zoom = Math.max(1, crop.zoom);
  const { fw, fh } = imgFrac();
  crop.cx = Math.min(fw / 2, Math.max(1 - fw / 2, crop.cx));
  crop.cy = Math.min(fh / 2, Math.max(1 - fh / 2, crop.cy));
}

// Draws the cropped image into the rectangle (x, y, w, h) of ctx.
function drawCrop(ctx, x, y, w, h) {
  const s = coverScale(w, h) * crop.zoom;
  const dw = img.width * s, dh = img.height * s;
  const cx = x + w * crop.cx, cy = y + h * crop.cy;
  ctx.save();
  ctx.translate(cx, cy);
  if (crop.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// ---------- Rendering ----------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function toGray(canvas) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data, c = S.contrast, b = S.brightness;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = (v - 128) * c + 128 + b;
    d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  ctx.putImageData(data, 0, 0);
}

// Greedy word wrap of one paragraph to maxW (uses the current ctx font).
function wrapParagraph(ctx, para, maxW) {
  const words = para.split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const test = line + ' ' + word;
    if (ctx.measureText(test).width <= maxW) line = test;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

// Small deterministic PRNG so the parchment stains are identical in preview and export.
function rng(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

// Scroll banner centred on (cx, cy): wavy parchment sheet with rolled ends.
function drawParchment(ctx, cx, cy, pw, ph) {
  const roll = Math.min(ph * 0.26, pw * 0.12);
  const x0 = cx - pw / 2 + roll * 0.6, x1 = cx + pw / 2 - roll * 0.6;
  const top = cy - ph / 2, bot = cy + ph / 2;
  const amp = ph * 0.035, waves = 2;
  const edge = (y, dir) => (t) => y + dir * amp * Math.sin(t * Math.PI * 2 * waves);

  const body = new Path2D();
  const steps = 24;
  const topY = edge(top, 1), botY = edge(bot, -1);
  body.moveTo(x0, topY(0));
  for (let i = 1; i <= steps; i++) body.lineTo(x0 + (x1 - x0) * i / steps, topY(i / steps));
  for (let i = steps; i >= 0; i--) body.lineTo(x0 + (x1 - x0) * i / steps, botY(i / steps));
  body.closePath();

  ctx.save();
  // Drop shadow
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = ph * 0.18;
  ctx.shadowOffsetY = ph * 0.05;
  ctx.fillStyle = '#d9bf86';
  ctx.fill(body);
  ctx.restore();

  // Paper tone: light centre, darker burnt edges
  ctx.save();
  ctx.clip(body);
  const gr = ctx.createRadialGradient(cx, cy, ph * 0.1, cx, cy, Math.max(pw, ph) * 0.62);
  gr.addColorStop(0, '#f6e8c3');
  gr.addColorStop(0.6, '#e6cf98');
  gr.addColorStop(1, '#b48a4c');
  ctx.fillStyle = gr;
  ctx.fillRect(cx - pw / 2, top - amp * 2, pw, ph + amp * 4);
  // Stains
  const r = rng(7);
  for (let i = 0; i < 9; i++) {
    const sx = x0 + r() * (x1 - x0), sy = top + r() * ph, sr = ph * (0.08 + r() * 0.2);
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, 'rgba(120,80,30,0.16)');
    sg.addColorStop(1, 'rgba(120,80,30,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, ph * 0.025);
  ctx.strokeStyle = '#6b4a22';
  ctx.stroke(body);

  // Rolled ends
  for (const ex of [x0, x1]) {
    const rx = ex - roll / 2, ry = top - ph * 0.06, rh = ph * 1.12;
    const rg = ctx.createLinearGradient(rx, 0, rx + roll, 0);
    rg.addColorStop(0, '#8a6430');
    rg.addColorStop(0.35, '#f1dfb2');
    rg.addColorStop(0.7, '#c9a464');
    rg.addColorStop(1, '#6e4c22');
    ctx.beginPath();
    ctx.roundRect(rx, ry, roll, rh, roll / 2);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.stroke();
    // Spiral hint at the curl
    ctx.beginPath();
    ctx.ellipse(ex, ry + roll * 0.5, roll * 0.22, roll * 0.16, 0, 0, Math.PI * 2);
    ctx.ellipse(ex, ry + rh - roll * 0.5, roll * 0.22, roll * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#6b4a22';
    ctx.fill();
  }
}

function drawText(ctx, w, h) {
  let text = S.text.trim();
  if (!text) return;
  if (S.uppercase) text = text.toUpperCase();
  const paragraphs = text.split(/\r?\n/).map((p) => p.trim());
  const lh = S.lineHeight / 100;
  const scroll = S.nameBg === 'parchment';
  let size = (S.textSize / 100) * w;
  let lines, lw, widest, blockH, padX, padY;
  // Shrink (if enabled) until every line fits the width and the block fits the height.
  for (let i = 0; i < 60; i++) {
    ctx.font = `${size}px "${FONT}"`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(S.letterSpacing / 100) * size}px`;
    lw = (S.stroke / 100) * size;
    padX = scroll ? size * 0.42 : 0;
    padY = scroll ? size * 0.28 : 0;
    const maxW = (scroll ? w * 0.98 - 2 * padX : w * 0.94) - 2 * lw;
    lines = S.autoWrap ? paragraphs.flatMap((p) => wrapParagraph(ctx, p, maxW)) : paragraphs;
    widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    blockH = (lines.length - 1) * size * lh + size + 2 * lw;
    if (!S.autoFit) break;
    if (widest <= maxW && blockH + 2 * padY <= h * 0.94) break;
    size *= 0.95;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = w / 2;
  const step = size * lh;
  const cy = (S.textY / 100) * h;
  const y0 = cy - ((lines.length - 1) * step) / 2;
  // The parchment is sized and placed from the text block, so it follows the name.
  if (scroll) {
    const pw = Math.min(w * 0.98, widest + 2 * lw + 2 * padX);
    drawParchment(ctx, x, cy, pw, blockH + 2 * padY);
  }
  // Strokes first, then fills, so a line's outline never covers the line above.
  if (lw > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = lw * 2;
    ctx.strokeStyle = S.strokeColor;
    lines.forEach((l, i) => ctx.strokeText(l, x, y0 + i * step));
  }
  ctx.fillStyle = S.textColor;
  lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * step));
}

function renderBox(w, h, gray, withText) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, c.width, c.height);
  drawCrop(ctx, 0, 0, c.width, c.height);
  if (gray) toGray(c);
  if (withText) drawText(ctx, c.width, c.height);
  return c;
}

// ---------- Frames ----------
const FANTASY = {
  gold:   { dark: '#3d2508', mid: '#b07f26', light: '#f7df92' },
  silver: { dark: '#24282e', mid: '#8e98a3', light: '#f4f7fa' },
  bronze: { dark: '#331a0a', mid: '#94542a', light: '#e8ae78' },
};
const WOOD = {
  wood:  { dark: '#2a1407', base: '#6e3f1c', light: '#9c6534', grain: '40,18,4' },
  oak:   { dark: '#4d3114', base: '#a5773f', light: '#d2a86a', grain: '90,55,20' },
};
const frameDark = () => (FANTASY[S.frameStyle] || WOOD[S.frameStyle]).dark;
const isFantasy = () => S.frameStyle !== 'black';

// Card layout in mm. Each face is exactly boxW × boxH, frame included, so the
// printed card is always boxW × 2·boxH; the centre line is split between the faces.
// Black = one frame shared by both pictures; fantasy = each face fully framed.
function layoutMm() {
  const { boxW: W, boxH: H, gap: g } = S;
  const fantasy = isFantasy();
  const t = fantasy ? S.fantasyBorder : S.border;
  const bw = Math.max(1, W - 2 * t);
  const bh = Math.max(1, fantasy ? H - g / 2 - 2 * t : H - g / 2 - t);
  const by = fantasy ? H + g / 2 + t : H + g / 2;
  return { w: W, h: 2 * H, t, bw, bh, top: { x: t, y: t }, bottom: { x: t, y: by } };
}

function metalGradient(ctx, x0, y0, x1, y1, p, bands) {
  const gr = ctx.createLinearGradient(x0, y0, x1, y1);
  const seq = [p.mid, p.light, p.mid, p.dark];
  const n = bands * seq.length;
  for (let i = 0; i <= n; i++) gr.addColorStop(i / n, seq[i % seq.length]);
  return gr;
}

function metalSphere(ctx, cx, cy, r, p) {
  const gr = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  gr.addColorStop(0, p.light); gr.addColorStop(0.5, p.mid); gr.addColorStop(1, p.dark);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = gr; ctx.fill();
  ctx.lineWidth = r * 0.14; ctx.strokeStyle = p.dark; ctx.stroke();
}

function gem(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
  const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r * 1.1);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, color); gr.addColorStop(1, '#000000');
  ctx.fillStyle = gr; ctx.fill();
  ctx.lineWidth = r * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
  // facets
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
  ctx.lineWidth = r * 0.06; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.stroke();
  ctx.restore();
}

function bandPath(ctx, o, i) { // ring between outer rect o and inner rect i
  ctx.beginPath();
  ctx.rect(o.x, o.y, o.w, o.h);
  ctx.rect(i.x, i.y, i.w, i.h);
}

// Bevel: light on top/left and dark on bottom/right (or inverted), between rects o and i.
function bevel(ctx, o, i, light, dark) {
  const sides = [
    [[o.x, o.y], [o.x + o.w, o.y], [i.x + i.w, i.y], [i.x, i.y], light],                     // top
    [[o.x, o.y], [i.x, i.y], [i.x, i.y + i.h], [o.x, o.y + o.h], light],                     // left
    [[o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [i.x + i.w, i.y + i.h], [i.x + i.w, i.y], dark], // right
    [[o.x, o.y + o.h], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h], [o.x + o.w, o.y + o.h], dark], // bottom
  ];
  for (const [a, b, c, d, col] of sides) {
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }
}

// Soft shadow cast by a frame onto the picture (x, y, w, h).
function frameShadow(ctx, x, y, w, h, t) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = t * 0.8;
  ctx.lineWidth = t; ctx.strokeStyle = '#000';
  ctx.strokeRect(x - t / 2, y - t / 2, w + t, h + t);
  ctx.restore();
}

function drawFrame(ctx, x, y, w, h, t) {
  if (WOOD[S.frameStyle]) drawWoodFrame(ctx, x, y, w, h, t);
  else drawFantasyFrame(ctx, x, y, w, h, t);
}

// Mitred wooden frame: four planks with grain along their length and a rounded profile.
function drawWoodFrame(ctx, x, y, w, h, t) {
  const p = WOOD[S.frameStyle];
  const ox = x - t, oy = y - t, ow = w + 2 * t, oh = h + 2 * t;
  ctx.save();
  frameShadow(ctx, x, y, w, h, t);

  // Each plank in local coords: x along its length (len), y from outer edge (0) to inner edge (t).
  const planks = [
    { tx: ox, ty: oy, rot: 0, len: ow },                      // top
    { tx: ox + ow, ty: oy, rot: Math.PI / 2, len: oh },       // right
    { tx: ox + ow, ty: oy + oh, rot: Math.PI, len: ow },      // bottom
    { tx: ox, ty: oy + oh, rot: -Math.PI / 2, len: oh },      // left
  ];
  const r = rng(11);
  for (const pl of planks) {
    ctx.save();
    ctx.translate(pl.tx, pl.ty);
    ctx.rotate(pl.rot);
    const L = pl.len;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.lineTo(L - t, t); ctx.lineTo(t, t); ctx.closePath();
    ctx.clip();

    // Rounded profile across the plank
    const gr = ctx.createLinearGradient(0, 0, 0, t);
    gr.addColorStop(0, p.dark);
    gr.addColorStop(0.18, p.light);
    gr.addColorStop(0.5, p.base);
    gr.addColorStop(0.8, p.light);
    gr.addColorStop(1, p.dark);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, L, t);

    // Grain: wavy lines along the length
    const lines = 9;
    for (let i = 0; i < lines; i++) {
      const gy = t * (i + 0.3 + r() * 0.4) / lines;
      const a1 = t * (0.03 + r() * 0.05), f1 = (2 + r() * 3) / L * Math.PI * 2, ph1 = r() * 6.3;
      const a2 = t * 0.02, f2 = (9 + r() * 8) / L * Math.PI * 2, ph2 = r() * 6.3;
      ctx.beginPath();
      for (let s = 0; s <= 60; s++) {
        const gx = L * s / 60;
        const yy = gy + a1 * Math.sin(gx * f1 + ph1) + a2 * Math.sin(gx * f2 + ph2);
        s ? ctx.lineTo(gx, yy) : ctx.moveTo(gx, yy);
      }
      ctx.lineWidth = t * (0.025 + r() * 0.04);
      ctx.strokeStyle = `rgba(${p.grain},${0.25 + r() * 0.3})`;
      ctx.stroke();
    }

    // A knot on the long planks
    if (L > t * 8) {
      const kx = L * (0.25 + r() * 0.5), ky = t * (0.35 + r() * 0.3);
      for (let k = 4; k >= 1; k--) {
        ctx.beginPath();
        ctx.ellipse(kx, ky, t * 0.13 * k * 0.6, t * 0.05 * k * 0.6, 0, 0, Math.PI * 2);
        ctx.lineWidth = t * 0.025;
        ctx.strokeStyle = `rgba(${p.grain},0.5)`;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(kx, ky, t * 0.07, t * 0.03, 0, 0, Math.PI * 2);
      ctx.fillStyle = p.dark;
      ctx.fill();
    }
    ctx.restore();
  }

  // Light from top-left
  bevel(ctx, { x: ox, y: oy, w: ow, h: oh }, { x, y, w, h }, 'rgba(255,240,210,0.12)', 'rgba(0,0,0,0.22)');

  // Mitre joints, edges and the inner lip
  ctx.lineWidth = t * 0.05;
  ctx.strokeStyle = 'rgba(20,8,0,0.75)';
  ctx.beginPath();
  for (const [cx, cy, ix, iy] of [[ox, oy, x, y], [ox + ow, oy, x + w, y], [ox + ow, oy + oh, x + w, y + h], [ox, oy + oh, x, y + h]]) {
    ctx.moveTo(cx, cy); ctx.lineTo(ix, iy);
  }
  ctx.stroke();
  ctx.lineWidth = t * 0.08;
  ctx.strokeStyle = p.dark;
  ctx.strokeRect(ox + t * 0.04, oy + t * 0.04, ow - t * 0.08, oh - t * 0.08);
  ctx.lineWidth = t * 0.1;
  ctx.strokeRect(x - t * 0.05, y - t * 0.05, w + t * 0.1, h + t * 0.1);

  // Wooden pegs on the joints
  for (const [cx, cy] of [[ox + t * 0.5, oy + t * 0.5], [ox + ow - t * 0.5, oy + t * 0.5],
                          [ox + t * 0.5, oy + oh - t * 0.5], [ox + ow - t * 0.5, oy + oh - t * 0.5]]) {
    const pr = t * 0.14;
    const pg = ctx.createRadialGradient(cx - pr * 0.3, cy - pr * 0.3, pr * 0.1, cx, cy, pr);
    pg.addColorStop(0, p.light); pg.addColorStop(1, p.dark);
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = pr * 0.25; ctx.strokeStyle = 'rgba(20,8,0,0.8)'; ctx.stroke();
  }
  ctx.restore();
}

// Ornate frame of thickness t around the box (x, y, w, h). Drawn after the image.
function drawFantasyFrame(ctx, x, y, w, h, t) {
  const p = FANTASY[S.frameStyle];
  const rect = (d) => ({ x: x - d, y: y - d, w: w + 2 * d, h: h + 2 * d });
  const outer = rect(t), mid = rect(t * 0.5), inner = rect(0);

  ctx.save();
  frameShadow(ctx, x, y, w, h, t);

  // Metal body
  bandPath(ctx, outer, inner);
  ctx.fillStyle = metalGradient(ctx, outer.x, outer.y, outer.x + outer.w, outer.y + outer.h, p, 5);
  ctx.fill('evenodd');
  // Rounded molding: outer half raised, inner half recessed
  bevel(ctx, outer, mid, 'rgba(255,255,255,0.28)', 'rgba(0,0,0,0.35)');
  bevel(ctx, mid, inner, 'rgba(0,0,0,0.3)', 'rgba(255,255,255,0.22)');

  // Engraved lines
  const line = (r, lwRel, col) => { ctx.lineWidth = t * lwRel; ctx.strokeStyle = col; ctx.strokeRect(r.x, r.y, r.w, r.h); };
  line(rect(t - t * 0.05), 0.1, p.dark);
  line(rect(t * 0.5), 0.06, p.dark);
  line(rect(t * 0.5 - t * 0.07), 0.04, 'rgba(255,255,255,0.35)');
  line(rect(t * 0.04), 0.1, p.dark);

  // Rivets along the molding
  const rr = t * 0.14;
  const rivets = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / (t * 2.2)));
    for (let i = 1; i < n; i++) metalSphere(ctx, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, rr, p);
  };
  const c0 = t * 1.2; // keep clear of the corner ornaments
  rivets(mid.x + c0, mid.y, mid.x + mid.w / 2 - t * 0.6, mid.y);
  rivets(mid.x + mid.w / 2 + t * 0.6, mid.y, mid.x + mid.w - c0, mid.y);
  rivets(mid.x + c0, mid.y + mid.h, mid.x + mid.w / 2 - t * 0.6, mid.y + mid.h);
  rivets(mid.x + mid.w / 2 + t * 0.6, mid.y + mid.h, mid.x + mid.w - c0, mid.y + mid.h);
  for (const sx of [mid.x, mid.x + mid.w]) {
    rivets(sx, mid.y + c0, sx, mid.y + mid.h / 2 - t * 0.8);
    rivets(sx, mid.y + mid.h / 2 + t * 0.8, sx, mid.y + mid.h - c0);
  }

  // Studs at the middle of each side
  metalSphere(ctx, mid.x + mid.w / 2, mid.y, t * 0.3, p);
  metalSphere(ctx, mid.x + mid.w / 2, mid.y + mid.h, t * 0.3, p);
  for (const sx of [mid.x, mid.x + mid.w]) {
    metalSphere(ctx, sx, mid.y + mid.h / 2, t * 0.42, p);
    gem(ctx, sx, mid.y + mid.h / 2, t * 0.28, S.gemColor);
  }

  // Corner medallions with gems
  const cr = t * 0.62;
  for (const [cx, cy] of [[outer.x + cr, outer.y + cr], [outer.x + outer.w - cr, outer.y + cr],
                          [outer.x + cr, outer.y + outer.h - cr], [outer.x + outer.w - cr, outer.y + outer.h - cr]]) {
    metalSphere(ctx, cx, cy, cr, p);
    ctx.beginPath(); ctx.arc(cx, cy, cr * 0.72, 0, Math.PI * 2);
    ctx.lineWidth = t * 0.05; ctx.strokeStyle = p.dark; ctx.stroke();
    gem(ctx, cx, cy, cr * 0.55, S.gemColor);
  }
  ctx.restore();
}

// Renders the whole miniature at the given pixels-per-mm.
function renderCard(k) {
  const L = layoutMm();
  const px = (v) => Math.round(v * k);
  // Derive box sizes from the rounded card size so the print size stays exact.
  const card = makeCanvas(px(L.w), px(L.h));
  const t = px(L.t), bw = card.width - 2 * t, bh = px(L.top.y + L.bh) - t;
  const ctx = card.getContext('2d');
  ctx.fillStyle = isFantasy() ? frameDark() : S.frameColor;
  ctx.fillRect(0, 0, card.width, card.height);

  // Top: color, rotated 180°
  const tx = t, ty = t;
  const top = renderBox(bw, bh, false, S.textOnTop);
  ctx.save();
  ctx.translate(tx + bw, ty + bh);
  ctx.rotate(Math.PI);
  ctx.drawImage(top, 0, 0);
  if (isFantasy()) drawFrame(ctx, 0, 0, bw, bh, t);
  ctx.restore();

  // Bottom: black & white with text
  const bx = t, by = card.height - t - bh;
  ctx.drawImage(renderBox(bw, bh, true, true), bx, by);
  if (isFantasy()) drawFrame(ctx, bx, by, bw, bh, t);
  return card;
}

function cardMm() {
  const L = layoutMm();
  return { w: L.w, h: L.h };
}

// ---------- Editor ----------
const editor = $('editor');
const ectx = editor.getContext('2d');
const MARGIN = 60;
let boxRect = { x: 0, y: 0, w: 0, h: 0 };

function layoutEditor() {
  const maxH = Math.min(600, window.innerHeight - 260);
  const maxW = Math.min(460, $('editorWrap').parentElement.clientWidth || 460);
  let bh = Math.max(200, maxH - 2 * MARGIN);
  const aspect = boxAspect();
  let bw = bh * aspect;
  if (bw > maxW - 2 * MARGIN) { bw = maxW - 2 * MARGIN; bh = bw / aspect; }
  const cw = Math.round(bw + 2 * MARGIN), ch = Math.round(bh + 2 * MARGIN);
  const dpr = window.devicePixelRatio || 1;
  editor.style.width = cw + 'px';
  editor.style.height = ch + 'px';
  editor.width = Math.round(cw * dpr);
  editor.height = Math.round(ch * dpr);
  ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
  boxRect = { x: MARGIN, y: MARGIN, w: bw, h: bh };
}

function drawEditor() {
  const cw = editor.width / (window.devicePixelRatio || 1), ch = editor.height / (window.devicePixelRatio || 1);
  ectx.clearRect(0, 0, cw, ch);
  const { x, y, w, h } = boxRect;
  if (img) {
    drawCrop(ectx, x, y, w, h);
    ectx.fillStyle = 'rgba(14,15,17,0.72)';
    ectx.beginPath();
    ectx.rect(0, 0, cw, ch);
    ectx.rect(x, y, w, h);
    ectx.fill('evenodd');
    // Text guide
    ectx.save();
    ectx.beginPath(); ectx.rect(x, y, w, h); ectx.clip();
    ectx.translate(x, y);
    ectx.globalAlpha = 0.9;
    drawText(ectx, w, h);
    ectx.restore();
  } else {
    ectx.fillStyle = '#1b1d21';
    ectx.fillRect(x, y, w, h);
  }
  ectx.strokeStyle = '#e07a1f';
  ectx.lineWidth = 1.5;
  ectx.strokeRect(x - 0.75, y - 0.75, w + 1.5, h + 1.5);
}

// Pan
let drag = null;
editor.addEventListener('pointerdown', (e) => {
  if (!img) return;
  editor.setPointerCapture(e.pointerId);
  editor.classList.add('dragging');
  drag = { x: e.clientX, y: e.clientY, cx: crop.cx, cy: crop.cy };
});
editor.addEventListener('pointermove', (e) => {
  if (!drag) return;
  crop.cx = drag.cx + (e.clientX - drag.x) / boxRect.w;
  crop.cy = drag.cy + (e.clientY - drag.y) / boxRect.h;
  clampCrop();
  update(false);
});
const endDrag = () => { drag = null; editor.classList.remove('dragging'); update(); };
editor.addEventListener('pointerup', endDrag);
editor.addEventListener('pointercancel', endDrag);

// Zoom around a point (in box fractions)
function zoomTo(z, px = 0.5, py = 0.5) {
  const min = $('clamp').checked ? 1 : 0.2;
  z = Math.min(6, Math.max(min, z));
  const r = z / crop.zoom;
  crop.cx = px + (crop.cx - px) * r;
  crop.cy = py + (crop.cy - py) * r;
  crop.zoom = z;
  clampCrop();
  update();
}
editor.addEventListener('wheel', (e) => {
  if (!img) return;
  e.preventDefault();
  const rect = editor.getBoundingClientRect();
  const px = (e.clientX - rect.left - boxRect.x) / boxRect.w;
  const py = (e.clientY - rect.top - boxRect.y) / boxRect.h;
  zoomTo(crop.zoom * Math.exp(-e.deltaY * 0.0015), px, py);
}, { passive: false });

$('zoom').addEventListener('input', (e) => zoomTo(parseFloat(e.target.value)));
$('clamp').addEventListener('change', () => { clampCrop(); update(); });
$('resetCrop').addEventListener('click', () => { Object.assign(crop, { cx: 0.5, cy: 0.5, zoom: 1 }); update(); });
$('fitCrop').addEventListener('click', () => {
  $('clamp').checked = false;
  const aspect = boxAspect();
  const contain = Math.min(aspect / img.width, 1 / img.height);
  Object.assign(crop, { cx: 0.5, cy: 0.5, zoom: contain / coverScale(aspect, 1) });
  update();
});
$('flipCrop').addEventListener('click', () => { crop.flip = !crop.flip; update(); });

// ---------- Image loading ----------
function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    img = im;
    Object.assign(crop, { cx: 0.5, cy: 0.5, zoom: 1, flip: false });
    $('dropHint').style.display = 'none';
    ['resetCrop', 'fitCrop', 'flipCrop', 'download', 'addSheet'].forEach((id) => ($(id).disabled = false));
    update();
  };
  im.src = url;
}
$('file').addEventListener('change', (e) => { loadImageFile(e.target.files[0]); e.target.value = ''; });
const wrap = $('editorWrap');
['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); wrap.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || !e.relatedTarget) wrap.classList.remove('over'); }));
document.addEventListener('drop', (e) => loadImageFile(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) loadImageFile(item.getAsFile());
});

// ---------- Preview ----------
const preview = $('preview');
function drawPreview() {
  const mm = cardMm();
  const dpr = window.devicePixelRatio || 1;
  const cssH = Math.min(520, Math.max(240, window.innerHeight - 320));
  const cssW = cssH * mm.w / mm.h;
  preview.style.width = cssW + 'px';
  preview.style.height = cssH + 'px';
  if (!img) {
    preview.width = Math.round(cssW * dpr); preview.height = Math.round(cssH * dpr);
    const c = preview.getContext('2d');
    c.fillStyle = '#ddd'; c.fillRect(0, 0, preview.width, preview.height);
    return;
  }
  const card = renderCard((cssH * dpr) / mm.h);
  preview.width = card.width; preview.height = card.height;
  preview.getContext('2d').drawImage(card, 0, 0);
}

// ---------- Export (PNG with DPI metadata) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function canvasToPngWithDpi(canvas, dpi) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 33; // after signature (8) + IHDR chunk (25)
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(src.subarray(at), at + chunk.length);
  return new Blob([out], { type: 'image/png' });
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const fileName = () => (S.text.trim().replace(/\s+/g, ' ') || 'miniatura').replace(/[\\/:*?"<>|]+/g, '_');
const pxPerMm = () => S.dpi / 25.4;

$('download').addEventListener('click', async () => {
  downloadBlob(await canvasToPngWithDpi(renderCard(pxPerMm()), S.dpi), fileName() + '.png');
});

// ---------- A4 sheet ----------
const SHEET = { w: 210, h: 297, margin: 8, spacing: 2 };
const sheet = []; // { image, wMm, hMm, name, thumb, qty }

// Places every copy of every item, flowing onto as many A4 pages as needed.
function layoutSheet() {
  const pages = [];
  let page = null, x = 0, y = 0, rowH = 0, tooBig = 0;
  const newPage = () => { page = []; pages.push(page); x = SHEET.margin; y = SHEET.margin; rowH = 0; };
  const maxW = SHEET.w - 2 * SHEET.margin, maxH = SHEET.h - 2 * SHEET.margin;
  for (const it of sheet) {
    if (it.wMm > maxW || it.hMm > maxH) { tooBig++; continue; }
    for (let n = 0; n < it.qty; n++) {
      if (!page) newPage();
      if (x + it.wMm > SHEET.w - SHEET.margin && x > SHEET.margin) { x = SHEET.margin; y += rowH + SHEET.spacing; rowH = 0; }
      if (y + it.hMm > SHEET.h - SHEET.margin) newPage();
      page.push({ it, x, y });
      x += it.wMm + SHEET.spacing;
      rowH = Math.max(rowH, it.hMm);
    }
  }
  return { pages, tooBig };
}

function renderSheetPages() {
  const k = pxPerMm();
  return layoutSheet().pages.map((page) => {
    const c = makeCanvas(SHEET.w * k, SHEET.h * k);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    for (const { it, x, y } of page) {
      ctx.drawImage(it.image, Math.round(x * k), Math.round(y * k), Math.round(it.wMm * k), Math.round(it.hMm * k));
    }
    return c;
  });
}

function refreshSheetUI() {
  const list = $('sheetList');
  list.innerHTML = '';
  sheet.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item';
    const im = document.createElement('img');
    im.src = it.thumb;
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div class="name"></div><div class="muted">${it.wMm.toFixed(1)} × ${it.hMm.toFixed(1)} mm</div>`;
    info.querySelector('.name').textContent = it.name;
    const qty = document.createElement('input');
    qty.type = 'number'; qty.min = '1'; qty.max = '500'; qty.value = it.qty;
    qty.title = 'Numero di copie';
    qty.oninput = () => {
      const v = parseInt(qty.value, 10);
      if (v >= 1) { it.qty = Math.min(500, v); refreshSheetCount(); }
    };
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Rimuovi';
    x.onclick = () => { sheet.splice(i, 1); refreshSheetUI(); };
    row.append(im, info, qty, x);
    list.append(row);
  });
  refreshSheetCount();
}

function refreshSheetCount() {
  const { pages, tooBig } = layoutSheet();
  const copies = pages.reduce((n, p) => n + p.length, 0);
  $('sheetCount').textContent = sheet.length
    ? `· ${copies} ${copies === 1 ? 'copia' : 'copie'} · ${pages.length} ${pages.length === 1 ? 'foglio' : 'fogli'}`
      + (tooBig ? ` · ${tooBig} troppo grandi` : '')
    : '';
  ['sheetDownload', 'sheetPrint', 'sheetClear'].forEach((id) => ($(id).disabled = !copies));
}

function addToSheet(image, wMm, hMm, name, qty = 1) {
  const t = makeCanvas(40, 40 * image.height / image.width);
  t.getContext('2d').drawImage(image, 0, 0, t.width, t.height);
  sheet.push({ image, wMm, hMm, name, thumb: t.toDataURL(), qty });
  refreshSheetUI();
}

$('addSheet').addEventListener('click', () => {
  const mm = cardMm();
  const qty = Math.min(500, Math.max(1, parseInt($('sheetQty').value, 10) || 1));
  addToSheet(renderCard(pxPerMm()), mm.w, mm.h, S.text.trim().replace(/\s+/g, ' ') || 'Miniatura', qty);
});

// Reads the DPI stored in a PNG's pHYs chunk (null if missing).
function pngDpi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || dv.getUint32(0) !== 0x89504e47) return null;
  for (let p = 8; p + 8 <= bytes.length;) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (type === 'pHYs' && len >= 9 && bytes[p + 16] === 1) return dv.getUint32(p + 8) * 0.0254;
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}

// Saved miniatures: real size comes from the PNG's DPI, otherwise the current card width.
$('sheetFiles').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const image = await createImageBitmap(file);
      const dpi = pngDpi(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
      const wMm = dpi ? image.width / dpi * 25.4 : cardMm().w;
      const hMm = wMm * image.height / image.width;
      addToSheet(image, wMm, hMm, file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      console.error('Immagine non valida', file.name, err);
    }
  }
  e.target.value = '';
});

$('sheetClear').addEventListener('click', () => { sheet.length = 0; refreshSheetUI(); });
$('sheetDownload').addEventListener('click', async () => {
  const pages = renderSheetPages();
  for (let i = 0; i < pages.length; i++) {
    const name = pages.length > 1 ? `foglio-miniature-${i + 1}.png` : 'foglio-miniature.png';
    downloadBlob(await canvasToPngWithDpi(pages[i], S.dpi), name);
    await new Promise((r) => setTimeout(r, 300));
  }
});
$('sheetPrint').addEventListener('click', async () => {
  const area = $('printArea');
  area.innerHTML = '';
  const loads = renderSheetPages().map((c) => {
    const page = document.createElement('div');
    page.className = 'page';
    const im = new Image();
    const loaded = new Promise((r) => { im.onload = r; });
    im.src = c.toDataURL('image/png');
    page.append(im);
    area.append(page);
    return loaded;
  });
  await Promise.all(loads);
  window.print();
});

// ---------- Controls binding ----------
const fmt = {
  lineHeight: (v) => v + '%', textSize: (v) => v + '%', textY: (v) => v + '%', letterSpacing: (v) => v + '%', stroke: (v) => v + '%',
  contrast: (v) => (+v).toFixed(2), brightness: (v) => (v > 0 ? '+' : '') + v,
};
const NUMERIC = new Set(['textSize', 'textY', 'letterSpacing', 'stroke', 'contrast', 'brightness', 'boxW', 'boxH', 'border', 'gap', 'dpi', 'lineHeight', 'fantasyBorder']);
const LAYOUT = new Set(['boxW', 'boxH', 'border', 'gap', 'fantasyBorder', 'frameStyle']);

function syncControls() {
  for (const key of Object.keys(DEFAULTS)) {
    const el = $(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!S[key];
    else el.value = S[key];
    if (fmt[key]) $(key + 'Val').textContent = fmt[key](S[key]);
  }
  updateFrameUI();
}

// Show only the options of the selected frame style.
function updateFrameUI() {
  document.querySelectorAll('[data-frame]').forEach((el) => {
    const f = el.dataset.frame;
    el.hidden = f === 'black' ? isFantasy() : f === 'metal' ? !FANTASY[S.frameStyle] : !isFantasy();
  });
}

for (const key of Object.keys(DEFAULTS)) {
  const el = $(key);
  if (!el) continue;
  el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (NUMERIC.has(key)) {
      v = parseFloat(v);
      if (!Number.isFinite(v) || v < 0 && !['letterSpacing', 'brightness'].includes(key)) return;
      if ((key === 'boxW' || key === 'boxH') && v < 5) return;
    }
    S[key] = v;
    if (fmt[key]) $(key + 'Val').textContent = fmt[key](v);
    if (LAYOUT.has(key)) { layoutEditor(); clampCrop(); }
    if (key === 'frameStyle') updateFrameUI();
    save();
    update();
  });
}

$('resetSettings').addEventListener('click', () => {
  const text = S.text;
  S = { ...DEFAULTS, text };
  save(); syncControls(); layoutEditor(); clampCrop(); update();
});

// ---------- Update loop ----------
let previewPending = false;
function update(full = true) {
  $('zoom').value = crop.zoom;
  $('zoomVal').textContent = crop.zoom.toFixed(2) + '×';
  drawEditor();
  // Throttle the (heavier) preview while dragging
  if (full || !previewPending) {
    previewPending = true;
    requestAnimationFrame(() => { previewPending = false; drawPreview(); });
  }
}

window.addEventListener('resize', () => { layoutEditor(); update(); });

// ---------- Init ----------
syncControls();
layoutEditor();
update();
loadFont().then(() => update()).catch((err) => console.error('Font non caricato', err));
