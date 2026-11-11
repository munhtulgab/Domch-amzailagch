// Scroll-driven 3D bottles. The DOM marks story stops with [data-pose]; the bottles move between them.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const S = 1 / 1000; // photo pixels -> scene units

// Outlines measured from the product photo (pixel units, y from the top of each bottle).
// body rows: [y, half-width, shape] where shape 0 = round neck, 1 = rounded-square body.
const BOTTLES = {
  big: {
    H: 1440, volume: '500 мл', barcode: '8656021393816', seed: 7, drops: 240, capDrops: 26,
    cap: { y0: 0, y1: 205, rTop: 107, rBot: 112 },
    ring: { y0: 205, y1: 242, r: 113 },
    neck: { y0: 242, y1: 302, r: 90, threads: [258, 274, 290] },
    body: [[302, 90, 0], [308, 134, 0.15], [316, 196, 0.4], [330, 241, 0.65], [350, 262, 0.82], [370, 278, 0.93], [390, 292, 1], [410, 296, 1], [580, 296, 1], [595, 288, 1], [610, 272, 1], [625, 255, 1], [640, 248, 1], [1100, 248, 1], [1115, 256, 1], [1130, 268, 1], [1150, 282, 1], [1170, 289, 1], [1190, 292, 1], [1360, 292, 1], [1385, 282, 1], [1405, 264, 1], [1420, 240, 1], [1430, 205, 1], [1436, 150, 1], [1439, 80, 1], [1440, 4, 1]],
    labels: { upper: [408, 578, 252], main: [645, 1135, 238], back: [665, 1095, 224], strip: [1178, 1226, 246] },
  },
  small: {
    H: 1182, volume: '250 мл', seed: 19, drops: 190, capDrops: 20,
    cap: { y0: 0, y1: 205, rTop: 96, rBot: 100 },
    ring: { y0: 205, y1: 226, r: 97 },
    neck: { y0: 226, y1: 257, r: 76, threads: [236, 248] },
    body: [[257, 76, 0], [262, 134, 0.3], [272, 186, 0.55], [282, 216, 0.72], [302, 234, 0.86], [322, 251, 0.96], [342, 257, 1], [482, 257, 1], [502, 240, 1], [522, 222, 1], [542, 214, 1], [922, 214, 1], [942, 221, 1], [962, 234, 1], [982, 247, 1], [1002, 250, 1], [1102, 250, 1], [1122, 243, 1], [1142, 222, 1], [1162, 196, 1], [1172, 178, 1], [1178, 140, 1], [1181, 70, 1], [1182, 4, 1]],
    labels: { upper: [332, 486, 218], main: [524, 938, 199], back: [548, 905, 190], strip: [990, 1030, 210] },
  },
};

// Story poses. Bottle: [x across the screen (-0.5..0.5), y up the screen, depth, turn, tip, lean, scale].
// Ingredients: [shown, salt, extract, mint].
const OFF_R = [0.78, -0.85, 0.3, 0.4, 0, 0, 0.9];
const OFF_L = [-0.9, -0.05, 0.2, -0.6, 0, 0, 0.9];
const OFF_LN = [-1, 0.2, 0.2, -0.6, 0, 0, 0.9];
const POSES = {
  wide: {
    hero: { big: [0.22, -0.02, 0, -0.32, 0, 0, 1], small: OFF_R, ing: [0, 0, 0, 0], mark: 1 },
    sizes: { big: [0.3, -0.02, -0.1, 0.16, 0, 0, 1], small: [0.1, -0.07, 0.3, -0.22, 0, 0, 1], ing: [0, 0, 0, 0], mark: 0 },
    intro: { big: [0.21, 0, 0, 0.9, 0, 0, 0.9], small: OFF_L, ing: [0.75, 0.6, 0.6, 0.6], mark: 0 },
    salt: { big: [0.21, 0, 0, 1.75, 0, 0, 0.9], small: OFF_L, ing: [1, 1, 0.22, 0.22], mark: 0 },
    drop: { big: [0.21, 0, 0, 3.05, 0, 0, 0.9], small: OFF_L, ing: [1, 0.22, 1, 0.22], mark: 0 },
    mint: { big: [0.21, 0, 0, 4.35, 0, 0, 0.9], small: OFF_L, ing: [1, 0.22, 0.22, 1], mark: 0 },
    full: { big: [0.21, 0, 0, 5.6, 0, 0, 0.9], small: OFF_L, ing: [0.55, 0.55, 0.55, 0.55], mark: 0 },
    usage: { big: [-0.22, 0, 0, 6.45, 0, -0.34, 1], small: OFF_L, ing: [0, 0, 0, 0], mark: 0 },
  },
  narrow: {
    hero: { big: [0, 0.19, 0, -0.32, 0, 0, 1], small: [0.85, -0.6, 0.3, 0.4, 0, 0, 0.9], ing: [0, 0, 0, 0], mark: 1 },
    sizes: { big: [0.17, 0.19, -0.1, 0.16, 0, 0, 0.95], small: [-0.17, 0.16, 0.3, -0.22, 0, 0, 0.95], ing: [0, 0, 0, 0], mark: 0 },
    intro: { big: [0, 0.2, 0, 0.9, 0, 0, 0.86], small: OFF_LN, ing: [0.75, 0.6, 0.6, 0.6], mark: 0 },
    salt: { big: [0, 0.2, 0, 1.75, 0, 0, 0.86], small: OFF_LN, ing: [1, 1, 0.22, 0.22], mark: 0 },
    drop: { big: [0, 0.2, 0, 3.05, 0, 0, 0.86], small: OFF_LN, ing: [1, 0.22, 1, 0.22], mark: 0 },
    mint: { big: [0, 0.2, 0, 4.35, 0, 0, 0.86], small: OFF_LN, ing: [1, 0.22, 0.22, 1], mark: 0 },
    full: { big: [0, 0.2, 0, 5.6, 0, 0, 0.86], small: OFF_LN, ing: [0.55, 0.55, 0.55, 0.55], mark: 0 },
    usage: { big: [0, 0.2, 0, 6.45, 0, -0.28, 0.95], small: OFF_LN, ing: [0, 0, 0, 0], mark: 0 },
  },
};

function rng(seed) {
  let s = seed;
  return function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => u * u * (3 - 2 * u);
const sgnPow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Bottle geometry (outline resampled every 4 px and smoothed) ----
function buildRows(b) {
  const P = b.body;
  const y0 = P[0][0];
  const y1 = P[P.length - 1][0];
  const STEP = 4;
  const raw = [];
  for (let y = y0; y <= y1 + 0.001; y += STEP) {
    let i = 0;
    while (i < P.length - 2 && P[i + 1][0] < y) i += 1;
    const a = P[i];
    const c = P[i + 1];
    const f = clamp((y - a[0]) / (c[0] - a[0]), 0, 1);
    raw.push({ y, w: a[1] + (c[1] - a[1]) * f, s: a[2] + (c[2] - a[2]) * f });
  }
  const rows = raw.map((r, i) => {
    if (i < 2 || i > raw.length - 3) return r;
    let w = 0;
    let s = 0;
    for (let k = -2; k <= 2; k += 1) {
      w += raw[i + k].w;
      s += raw[i + k].s;
    }
    return { y: r.y, w: w / 5, s: s / 5 };
  });
  return { y0, step: STEP, rows };
}
function shapeAt(R, yPix) {
  const f = clamp((yPix - R.y0) / R.step, 0, R.rows.length - 1);
  const i = Math.min(Math.floor(f), R.rows.length - 2);
  const t = f - i;
  const a = R.rows[i];
  const c = R.rows[i + 1];
  const w = a.w + (c.w - a.w) * t;
  const s = a.s + (c.s - a.s) * t;
  return { w: w * S, d: w * S * (1 - 0.38 * s), n: 2 + 1.3 * s };
}
const yWorld = (b, yPix) => (b.H - yPix) * S;
function surfacePoint(b, yPix, phi) {
  const sh = shapeAt(b.R, yPix);
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const x = sh.w * sgnPow(c, 2 / sh.n);
  const z = sh.d * sgnPow(s, 2 / sh.n);
  const nx = (Math.sign(x) * (Math.abs(x) / sh.w) ** (sh.n - 1)) / sh.w;
  const nz = (Math.sign(z) * (Math.abs(z) / sh.d) ** (sh.n - 1)) / sh.d;
  const n = new THREE.Vector3(nx, 0, nz);
  if (n.lengthSq() < 1e-12) n.set(0, 0, 1);
  n.normalize();
  return { p: new THREE.Vector3(x, yWorld(b, yPix), z), n };
}
function bodyGeometry(b) {
  const R = b.R;
  const M = 112;
  const pos = [];
  const idx = [];
  const N = R.rows.length;
  R.rows.forEach((r) => {
    for (let k = 0; k < M; k += 1) {
      const { p } = surfacePoint(b, r.y, (k / M) * Math.PI * 2);
      pos.push(p.x, p.y, p.z);
    }
  });
  for (let r = 0; r < N - 1; r += 1) {
    for (let k = 0; k < M; k += 1) {
      const a = r * M + k;
      const bb = r * M + ((k + 1) % M);
      const c = (r + 1) * M + k;
      const d = (r + 1) * M + ((k + 1) % M);
      idx.push(a, bb, c, bb, d, c);
    }
  }
  const top = pos.length / 3;
  pos.push(0, yWorld(b, R.rows[0].y), 0);
  const bot = pos.length / 3;
  pos.push(0, yWorld(b, R.rows[N - 1].y) - 0.0005, 0);
  for (let k = 0; k < M; k += 1) {
    idx.push(top, (k + 1) % M, k);
    idx.push(bot, (N - 1) * M + k, (N - 1) * M + ((k + 1) % M));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// A label is a patch of the bottle surface, so it wraps round the corners like a printed sleeve.
function labelGeometry(b, spec, side) {
  const [y0, y1, hw] = spec;
  const COLS = 52;
  const ROWS = 34;
  const lift = 0.0016;
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= ROWS; j += 1) {
    const v = j / ROWS;
    const yPix = y0 + v * (y1 - y0);
    const sh = shapeAt(b.R, yPix);
    for (let i = 0; i <= COLS; i += 1) {
      const u = i / COLS;
      const xw = (u - 0.5) * 2 * hw * S * side;
      const c = sgnPow(clamp(xw / sh.w, -0.995, 0.995), sh.n / 2);
      const phi = Math.atan2(Math.sqrt(Math.max(0, 1 - c * c)) * side, c);
      const { p, n } = surfacePoint(b, yPix, phi);
      p.addScaledVector(n, lift);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, 1 - v);
    }
  }
  const W = COLS + 1;
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const a = j * W + i;
      const bb = a + 1;
      const c = a + W;
      const d = c + 1;
      idx.push(a, c, bb, bb, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function capGeometry(b) {
  const c = b.cap;
  const bevel = 12;
  const pts = [
    [c.rBot * 0.92, c.y1], [c.rBot, c.y1 - 2], [c.rBot, c.y1 - 10],
    [c.rTop + (c.rBot - c.rTop) * 0.1, c.y0 + bevel + 6], [c.rTop, c.y0 + bevel],
    [c.rTop - bevel * 0.3, c.y0 + bevel * 0.3], [c.rTop - bevel, c.y0], [0, c.y0],
  ].map(([r, y]) => new THREE.Vector2(r * S, yWorld(b, y)));
  const g = new THREE.LatheGeometry(pts, 240);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const yTop = yWorld(b, c.y0 + bevel + 4);
  const yBot = yWorld(b, c.y1 - 6);
  for (let i = 0; i < p.count; i += 1) {
    v.fromBufferAttribute(p, i);
    if (v.y <= yTop && v.y >= yBot) {
      const ang = Math.atan2(v.z, v.x);
      const r = Math.hypot(v.x, v.z);
      const k = (r + (0.5 + 0.5 * Math.cos(ang * 96)) ** 2 * 2.6 * S) / r;
      p.setXYZ(i, v.x * k, v.y, v.z * k);
    }
  }
  g.computeVertexNormals();
  return g;
}
// ---- Printed labels drawn from the product photo (sharper than a photo crop) ----
const INK = '#23292a';
const LABEL_GREEN = '#1f4a41';
const font = (wt, px, face = '"Golos Text", system-ui, sans-serif') => `${wt} ${px}px ${face}`;
function canvasTexture(cv) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function silver(g, x0, y0, x1, y1) {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, '#c9c6c2');
  grad.addColorStop(0.28, '#e7e5e2');
  grad.addColorStop(0.55, '#b9b6b2');
  grad.addColorStop(0.8, '#dddad6');
  grad.addColorStop(1, '#aeaba7');
  return grad;
}
function octagon(g, W, H, c) {
  g.beginPath();
  g.moveTo(c, 0); g.lineTo(W - c, 0); g.lineTo(W, c); g.lineTo(W, H - c);
  g.lineTo(W - c, H); g.lineTo(c, H); g.lineTo(0, H - c); g.lineTo(0, c);
  g.closePath();
}
// Justified paragraphs (the first one indented), shrinking the type until everything fits.
function setText(g, paras, x, top, maxW, bottom, size) {
  for (let px = size; px >= 18; px -= 1) {
    g.font = font(500, px);
    const lh = px * 1.16;
    const lines = [];
    paras.forEach((text, pi) => {
      const indent = pi === 0 ? px * 3.2 : 0;
      let line = [];
      let first = true;
      text.split(' ').forEach((w) => {
        const room = maxW - (first ? indent : 0);
        const t = [...line, w].join(' ');
        if (line.length && g.measureText(t).width > room) {
          lines.push({ words: line, indent: first ? indent : 0, last: false });
          line = [w];
          first = false;
        } else line.push(w);
      });
      if (line.length) lines.push({ words: line, indent: first ? indent : 0, last: true });
    });
    if (top + lines.length * lh <= bottom || px === 18) {
      let y = top + px;
      lines.forEach(({ words, indent, last }) => {
        const room = maxW - indent;
        const used = words.reduce((a, w) => a + g.measureText(w).width, 0);
        const gap = !last && words.length > 1 ? (room - used) / (words.length - 1) : g.measureText(' ').width;
        let cx = x + indent;
        words.forEach((w) => {
          g.fillText(w, cx, y);
          cx += g.measureText(w).width + gap;
        });
        y += lh;
      });
      return;
    }
  }
}
// EAN-13 bars for the code printed on the bottle.
function ean13(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = L.map((p) => p.replace(/./g, (c) => (c === '0' ? '1' : '0')));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) bits += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) bits += R[d[i]];
  return `${bits}101`;
}
function barcode(g, code, x, y, w, h) {
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, w, h);
  const bits = ean13(code);
  const m = (w - 40) / (bits.length + 9);
  const x0 = x + 20 + m * 9;
  const barH = h - 56;
  g.fillStyle = '#111';
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] !== '1') continue;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    g.fillRect(x0 + i * m, y + 12, m + 0.4, barH + (guard ? 18 : 0));
  }
  g.font = font(500, Math.round(m * 7.4));
  g.textBaseline = 'alphabetic';
  g.textAlign = 'center';
  const ty = y + h - 10;
  g.fillText(code[0], x0 - m * 5, ty);
  for (let i = 0; i < 6; i += 1) g.fillText(code[1 + i], x0 + m * (3 + 7 * i + 3.5), ty);
  for (let i = 0; i < 6; i += 1) g.fillText(code[7 + i], x0 + m * (50 + 7 * i + 3.5), ty);
  g.textAlign = 'left';
}
function binIcon(g, x, y, s) {
  g.fillStyle = LABEL_GREEN;
  g.fillRect(x, y, s, s);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.moveTo(x + s * 0.3, y + s * 0.36); g.lineTo(x + s * 0.35, y + s * 0.84); g.lineTo(x + s * 0.65, y + s * 0.84); g.lineTo(x + s * 0.7, y + s * 0.36);
  g.closePath();
  g.stroke();
  [0.42, 0.5, 0.58].forEach((k) => {
    g.beginPath(); g.moveTo(x + s * k, y + s * 0.44); g.lineTo(x + s * k, y + s * 0.76); g.stroke();
  });
  g.fillRect(x + s * 0.24, y + s * 0.27, s * 0.52, s * 0.06);
  g.fillRect(x + s * 0.42, y + s * 0.2, s * 0.16, s * 0.05);
}
function recycleIcon(g, x, y, s) {
  g.fillStyle = LABEL_GREEN;
  g.fillRect(x, y, s, s);
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = s * 0.08;
  const cx = x + s / 2;
  const cy = y + s * 0.54;
  const r = s * 0.28;
  for (let k = 0; k < 3; k += 1) {
    const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.35;
    const a1 = a0 + (2 * Math.PI) / 3 - 0.75;
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    const tx = cx + r * Math.cos(a1);
    const ty = cy + r * Math.sin(a1);
    const ta = a1 + Math.PI / 2;
    g.beginPath();
    g.moveTo(tx + Math.cos(ta) * s * 0.11, ty + Math.sin(ta) * s * 0.11);
    g.lineTo(tx + Math.cos(ta + 2.2) * s * 0.09, ty + Math.sin(ta + 2.2) * s * 0.09);
    g.lineTo(tx + Math.cos(ta - 2.2) * s * 0.09, ty + Math.sin(ta - 2.2) * s * 0.09);
    g.closePath(); g.fill();
  }
}
const BACK_TEXT = [
  'Намар, өвөл, хаврын улиралд домч уусмалаар амны хөндий, хоолойгоо тогтмол зайлснаар амны хөндий, буйл, хоолой, залгиурын бактери, вирусын гаралтай үрэвсэлт өвчин, ханиад томуунаас сэргийлнэ.',
  'НАЙРЛАГА: Шүүсэн ус, жамц давс, хадаасан цэцгийн ханд, гаа, глицерин, FD&C Blue No.1',
  'ХЭРЭГЛЭХ АРГА, ТУН: Өглөө оройд шүдээ угаасны дараа насанд хүрэгчид нэг удаа 25 мл, хүүхэд 15 мл уусмалаар амны хөндий, хоолой залгиурыг 10 секунд орчим зайлж асгана. 2 удаа давтана.',
  'ХАДГАЛАХ НӨХЦӨЛ: Тасалгааны хэмд 12 сар хадгална.',
  'АНХААРУУЛГА: Бүтээгдэхүүний найрлагад орсон аль нэг бодисд харшилтай бол хэрэглэж болохгүй!',
  'Залгиж болохгүй!',
  'ХАЯГ: Монгол улс, Улаанбаатар хот, Жем Интернэшнл ХХК-д үйлдвэрлэв. Утас: 77997799 www.gem.mn',
];
// The back label as printed on the bottle (text, claim, wordmark, volume, barcode and disposal icons).
function backLabelTexture(b) {
  const [y0, y1, hw] = b.labels.back;
  const W = 1024;
  const H = Math.round((W * (y1 - y0)) / (2 * hw));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  octagon(g, W, H, 64);
  g.save();
  g.clip();
  g.fillStyle = silver(g, 0, 0, W, H);
  g.fillRect(0, 0, W, H);
  const band = Math.round(H * 0.118);
  const head = g.createLinearGradient(0, 0, W, 0);
  head.addColorStop(0, '#3d6f62');
  head.addColorStop(0.45, LABEL_GREEN);
  head.addColorStop(1, '#173b34');
  g.fillStyle = head;
  g.fillRect(0, 0, W, band);
  const sheen = g.createLinearGradient(0, band, 0, band + 70);
  sheen.addColorStop(0, 'rgba(120, 165, 160, 0.75)');
  sheen.addColorStop(1, 'rgba(120, 165, 160, 0)');
  g.fillStyle = sheen;
  g.beginPath(); g.moveTo(0, band); g.lineTo(W, band); g.lineTo(W, band + 10); g.lineTo(0, band + 80); g.closePath(); g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, Math.round(band * 0.52));
  g.fillText('ЖАМЦ ДАВСНЫ УУСМАЛ', W / 2, band * 0.54);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';

  const foot = H - Math.round(H * 0.3);
  g.fillStyle = INK;
  setText(g, BACK_TEXT, 44, band + 24, W - 88, foot - 10, 33);

  // claim, wordmark and volume
  g.fillStyle = INK;
  g.font = font(700, 29);
  g.fillText('ЭМНЭЛ ЗҮЙН ТУРШИЛТ', 44, foot + 40);
  g.fillText('СУДАЛГААГААР БАТАЛГААЖСАН', 44, foot + 76);
  g.textAlign = 'right';
  g.fillStyle = LABEL_GREEN;
  g.font = font(600, 64, 'Unbounded, "Golos Text", sans-serif');
  g.fillText('DOMCH', W - 44, foot + 52);
  g.fillStyle = '#2d3233';
  g.font = font(500, 50);
  g.fillText(b.volume.toUpperCase(), W - 44, foot + 108);
  g.textAlign = 'left';
  const icon = 84;
  binIcon(g, W - 44 - icon * 2 - 18, H - icon - 34, icon);
  recycleIcon(g, W - 44 - icon, H - icon - 34, icon);
  if (b.barcode) barcode(g, b.barcode, 190, foot + 98, 470, H - foot - 98);
  g.restore();
  return canvasTexture(cv);
}
// The silver strip on the lower back: «ЭРДСИЙН ТУНАДАС ҮҮСЭЖ БОЛНО.»
function stripTexture(b) {
  const [y0, y1, hw] = b.labels.strip;
  const W = 1024;
  const H = Math.round((W * (y1 - y0)) / (2 * hw));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const c = H * 0.5;
  g.beginPath();
  g.moveTo(c, 0); g.lineTo(W - c * 0.6, 0); g.lineTo(W, H * 0.5); g.lineTo(W - c * 0.6, H); g.lineTo(c, H); g.lineTo(0, H * 0.5);
  g.closePath();
  g.fillStyle = silver(g, 0, 0, W, H);
  g.fill();
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, Math.round(H * 0.5));
  g.fillText('ЭРДСИЙН ТУНАДАС ҮҮСЭЖ БОЛНО.', W / 2, H * 0.54);
  return canvasTexture(cv);
}
// ---- Ingredient forms ----
// A chunk of rock salt: a box knocked into an irregular, faceted crystal (vertices moved by position,
// so shared corners stay joined).
function saltGeometry(seed) {
  const rand = rng(seed);
  const g = new THREE.BoxGeometry(1, 0.82 + rand() * 0.3, 0.86 + rand() * 0.3, 2, 2, 2);
  const p = g.attributes.position;
  const moved = new Map();
  for (let i = 0; i < p.count; i += 1) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) {
      const corner = Math.abs(p.getX(i)) > 0.45 && Math.abs(p.getY(i)) > 0.38 && Math.abs(p.getZ(i)) > 0.38;
      const cut = corner ? 0.62 + rand() * 0.25 : 1;
      moved.set(key, [
        p.getX(i) * cut + (rand() - 0.5) * 0.22,
        p.getY(i) * cut + (rand() - 0.5) * 0.22,
        p.getZ(i) * cut + (rand() - 0.5) * 0.22,
      ]);
    }
    p.setXYZ(i, ...moved.get(key));
  }
  g.computeVertexNormals();
  return g;
}
// A dried clove: tapering stalk, four pointed sepals and the round bud between them.
function cloveGeometries() {
  const stalk = new THREE.LatheGeometry([
    [0.0, -0.5], [0.03, -0.5], [0.042, -0.46], [0.05, -0.3], [0.056, -0.05], [0.066, 0.12], [0.085, 0.22], [0.1, 0.27], [0.07, 0.29], [0, 0.29],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 14);
  const sepals = [];
  for (let k = 0; k < 4; k += 1) {
    const c = new THREE.ConeGeometry(0.045, 0.15, 6);
    c.translate(0, 0.075, 0);
    c.rotateZ(-0.55);
    c.rotateY((k * Math.PI) / 2 + Math.PI / 4);
    c.translate(0, 0.25, 0);
    sepals.push(c);
  }
  const head = mergeGeometries([stalk, ...sepals].map((g) => g.toNonIndexed()));
  head.scale(1.35, 1, 1.35);
  const bud = new THREE.SphereGeometry(0.088, 18, 12);
  bud.scale(1.35, 1.28, 1.35);
  bud.translate(0, 0.38, 0);
  return { body: head, bud };
}
// A mint sprig photo on a gently curved card (leaves are thin, so a card reads true from most angles).
function sprigGeometry(aspect) {
  const g = new THREE.PlaneGeometry(1, aspect, 10, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, -0.22 * x * x - 0.12 * y * y + 0.04 * Math.sin(x * 7));
  }
  g.computeVertexNormals();
  return g;
}
function radialTexture(stops) {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, c]) => grd.addColorStop(o, c));
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(cv);
}
function wordmarkTexture() {
  const cv = document.createElement('canvas');
  cv.width = 2048;
  cv.height = 560;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 420px Unbounded, "Golos Text", sans-serif';
  g.fillText('DOMCH', 1024, 290);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Start the 3D layer. Resolves to a controller, or null when WebGL is unavailable.
 * @param {{ canvas: HTMLCanvasElement, media?: string, initialSize?: 'big'|'small' }} options
 */
export async function createScene({ canvas, media = '/media/', initialSize = 'big' }) {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  let disposed = false;
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-2.2, 3.2, 3.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8fff6, 0.9);
  rim.position.set(3, 2, -2.5);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb8ae, 0.35));

  const FOV = 28;
  const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  let D = 5;
  let aspect = 1;
  let narrow = window.innerWidth < 820;
  const visH = (z) => 2 * (D - z) * tanH;
  const visW = (z) => visH(z) * aspect;

  const loader = new THREE.TextureLoader();
  let upperTex;
  let mainTex;
  let saltPhoto;
  let clovePhoto;
  let mintPhoto;
  try {
    [upperTex, mainTex, saltPhoto, clovePhoto, mintPhoto] = await Promise.all([
      loader.loadAsync(`${media}label_upper.webp`),
      loader.loadAsync(`${media}label_main.webp`),
      loader.loadAsync(`${media}ing-salt.webp`),
      loader.loadAsync(`${media}ing-clove.webp`),
      loader.loadAsync(`${media}ing-mint.webp`),
    ]);
  } catch {
    renderer.dispose();
    return null;
  }
  const aniso = renderer.capabilities.getMaxAnisotropy();
  [upperTex, mainTex, saltPhoto, clovePhoto, mintPhoto].forEach((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
  });
  // one salt crystal face and a wrinkled clove stalk, cut from the ingredient photos
  const crop = (tex, img, x, y, w, h) => {
    const t = tex.clone();
    t.repeat.set(w / img[0], h / img[1]);
    t.offset.set(x / img[0], 1 - (y + h) / img[1]);
    t.needsUpdate = true;
    return t;
  };
  const saltTex = crop(saltPhoto, [774, 460], 232, 212, 116, 96);
  const stalkTex = crop(clovePhoto, [754, 545], 252, 248, 156, 44);
  const budTex = crop(clovePhoto, [754, 545], 150, 395, 70, 60);
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('500 40px "Golos Text"'),
        document.fonts.load('700 40px "Golos Text"'),
        document.fonts.load('600 40px "Golos Text"'),
        document.fonts.load('600 200px Unbounded'),
      ]),
      sleep(1600),
    ]);
  } catch {
    /* canvas text falls back to system faces */
  }
  if (disposed) return null;

  // ---- Materials ----
  // LIQUID = 'green': the brand's tinted mouthwash; 'clear' shows the colourless liquid of the product photo.
  const LIQUID = 'green';
  // Glass edges look dark against a light page and bright against the dark ingredient section: uEdge 0..1.
  const edgeTone = { value: 0 };
  const fresnelEdges = (mat, edge) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uEdge = edgeTone;
      shader.fragmentShader = `uniform float uEdge;\n${shader.fragmentShader}`.replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.7);
        vec3 edgeCol = mix(vec3(0.10, 0.17, 0.15), vec3(0.86, 0.96, 0.93), uEdge);
        outgoingLight = mix(outgoingLight, edgeCol, fres * 0.85);
        diffuseColor.a = mix(diffuseColor.a, ${edge.toFixed(2)}, fres);
        #include <opaque_fragment>`);
    };
    return mat;
  };
  const liquid = LIQUID === 'green'
    ? new THREE.MeshPhysicalMaterial({
      color: 0x0c8f68, roughness: 0.1, metalness: 0, transmission: 0.3, thickness: 0.35, ior: 1.36,
      attenuationColor: new THREE.Color(0x05634a), attenuationDistance: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.15,
    })
    : fresnelEdges(new THREE.MeshPhysicalMaterial({
      color: 0xa3c2ba, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3,
    }), 0.7);
  // both walls in one mesh: three.js draws the far side first, then the near side
  if (LIQUID !== 'green') liquid.side = THREE.DoubleSide;
  const glass = LIQUID === 'green'
    ? new THREE.MeshPhysicalMaterial({
      color: 0xdcefe8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1, envMapIntensity: 1.6, depthWrite: false,
    })
    : fresnelEdges(new THREE.MeshPhysicalMaterial({
      color: 0xb4cdc6, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.14, clearcoat: 1, envMapIntensity: 1.6,
      depthWrite: false, side: THREE.DoubleSide,
    }), 0.7);
  // dark espresso-brown ribbed cap, as on the bottle
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0x3a2b27, roughness: 0.38, metalness: 0.08, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const beadMat = new THREE.MeshPhysicalMaterial({ color: 0xf2fffa, roughness: 0, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 1, envMapIntensity: 3 });
  const labelMat = (map) => new THREE.MeshStandardMaterial({
    map, transparent: true, roughness: 0.42, metalness: 0.12, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.18,
  });
  const upperMat = labelMat(upperTex);
  const mainMat = labelMat(mainTex);
  // pale pink rock salt: faceted, a little glassy
  const saltMat = new THREE.MeshPhysicalMaterial({
    map: saltTex, color: 0xf6c9b9, roughness: 0.5, metalness: 0, flatShading: true,
    clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xffd9cc), envMapIntensity: 0.85,
  });
  const cloveMat = new THREE.MeshStandardMaterial({ map: stalkTex, color: 0x9c7462, roughness: 0.86, metalness: 0 });
  const budMat = new THREE.MeshStandardMaterial({ map: budTex, color: 0xb08a72, roughness: 0.8, metalness: 0 });
  const mintMat = new THREE.MeshStandardMaterial({
    map: mintPhoto, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0,
    emissive: 0xffffff, emissiveMap: mintPhoto, emissiveIntensity: 0.12,
  });
  const shadowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const haloTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);

  // ---- Bottles ----
  const beadGeo = new THREE.SphereGeometry(1, 12, 9);
  function buildBottle(b) {
    b.R = buildRows(b);
    b.maxW = Math.max(...b.body.map((r) => r[1]));
    const inner = new THREE.Group();
    // draw order for the clear body: far wall, back labels, near wall, front labels and glass details
    const add = (mesh, order) => {
      mesh.renderOrder = order;
      inner.add(mesh);
      return mesh;
    };
    const body = bodyGeometry(b);
    add(new THREE.Mesh(body, liquid), 3);
    add(new THREE.Mesh(labelGeometry(b, b.labels.upper, 1), upperMat), 4);
    add(new THREE.Mesh(labelGeometry(b, b.labels.main, 1), mainMat), 4);
    const backTex = backLabelTexture(b);
    backTex.anisotropy = aniso;
    add(new THREE.Mesh(labelGeometry(b, b.labels.back, -1), labelMat(backTex)), 2);
    const stripTex = stripTexture(b);
    stripTex.anisotropy = aniso;
    add(new THREE.Mesh(labelGeometry(b, b.labels.strip, -1), labelMat(stripTex)), 2);
    const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(b.neck.r * S, b.neck.r * S, (b.neck.y1 - b.neck.y0) * S, 56, 1, true), glass), 4);
    neck.position.y = yWorld(b, (b.neck.y0 + b.neck.y1) / 2);
    b.neck.threads.forEach((ty) => {
      const t = add(new THREE.Mesh(new THREE.TorusGeometry(b.neck.r * S + 0.0015, 0.0045, 8, 56), glass), 4);
      t.rotation.x = Math.PI / 2;
      t.position.y = yWorld(b, ty);
    });
    const ring = add(new THREE.Mesh(new THREE.CylinderGeometry(b.ring.r * S, b.ring.r * S, (b.ring.y1 - b.ring.y0) * S, 64), glass), 4);
    ring.position.y = yWorld(b, (b.ring.y0 + b.ring.y1) / 2);
    inner.add(new THREE.Mesh(capGeometry(b), capMat));

    const rand = rng(b.seed);
    const total = b.drops + b.capDrops;
    const beads = new THREE.InstancedMesh(beadGeo, beadMat, total);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const yA = b.body[0][0] + 20;
    const yB = b.H - 40;
    for (let i = 0; i < total; i += 1) {
      const r = (2.5 + 8 * rand() ** 3) * S;
      let p;
      let n;
      if (i < b.drops) {
        ({ p, n } = surfacePoint(b, yA + rand() * (yB - yA), rand() * Math.PI * 2));
      } else {
        const ang = rand() * Math.PI * 2;
        const rr = (b.cap.rBot - 2) * S;
        n = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        p = new THREE.Vector3(n.x * rr, yWorld(b, b.cap.y0 + 22 + rand() * (b.cap.y1 - b.cap.y0 - 40)), n.z * rr);
      }
      p.addScaledVector(n, r * 0.25);
      q.setFromUnitVectors(zAxis, n);
      sc.set(r, r, r * 0.5);
      m.compose(p, q, sc);
      beads.setMatrixAt(i, m);
    }
    beads.renderOrder = 5;
    inner.add(beads);
    inner.position.y = (-b.H * S) / 2;
    const pivot = new THREE.Group();
    pivot.rotation.order = 'ZYX';
    pivot.add(inner);
    scene.add(pivot);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x0a2820, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    scene.add(shadow);
    return { pivot, shadow, b };
  }
  const BIG = buildBottle(BOTTLES.big);
  const SMALL = buildBottle(BOTTLES.small);

  // ---- Ingredients orbiting the bottle ----
  const ingGroup = new THREE.Group();
  scene.add(ingGroup);
  const elems = [];
  {
    const rand = rng(31);
    const saltGeos = [3, 8, 13, 21].map(saltGeometry);
    const clove = cloveGeometries();
    const sprig = sprigGeometry(339 / 519);
    const makeClove = () => {
      const o = new THREE.Group();
      o.add(new THREE.Mesh(clove.body, cloveMat), new THREE.Mesh(clove.bud, budMat));
      return o;
    };
    // salt crystals, cloves (the extract) and mint sprigs
    const kinds = [
      { g: 0, n: 14, make: (i) => new THREE.Mesh(saltGeos[i % saltGeos.length], saltMat), size: [0.07, 0.115] },
      { g: 1, n: 11, make: makeClove, size: [0.2, 0.28] },
      { g: 2, n: 8, make: () => new THREE.Mesh(sprig, mintMat), size: [0.32, 0.44] },
    ];
    kinds.forEach(({ g, n, make, size }) => {
      for (let i = 0; i < n; i += 1) {
        const mesh = make(i);
        mesh.visible = false;
        ingGroup.add(mesh);
        elems.push({
          mesh, g,
          th: (i / n) * Math.PI * 2 + g * 0.9 + rand() * 0.5,
          r: 0.58 + rand() * 0.36,
          h: (rand() - 0.5) * 1.3,
          base: size[0] + rand() * (size[1] - size[0]),
          rx: rand() * 6, ry: rand() * 6, rz: rand() * 6,
          sx: (rand() - 0.5) * 0.9, sy: (rand() - 0.5) * 0.9,
          ph: rand() * 6.28,
        });
      }
    });
  }

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  halo.scale.set(3.2, 3.2, 1);
  scene.add(halo);
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, (5.2 * 560) / 2048),
    new THREE.MeshBasicMaterial({ map: wordmarkTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  scene.add(mark);

  let darkPage = 0;
  const readColors = () => {
    const cs = getComputedStyle(root);
    // the first painted background (body is often transparent and the colour sits on <html>)
    const bg = [document.body, root].map((el) => getComputedStyle(el).backgroundColor.match(/[\d.]+/g))
      .find((c) => c && (c[3] === undefined || Number(c[3]) > 0.5));
    darkPage = bg && (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 < 0.4 ? 1 : 0;
    mark.material.color.setStyle(cs.getPropertyValue('--ghost').trim() || '#EAE8DF');
    halo.material.color.setStyle(cs.getPropertyValue('--mint').trim() || '#7FE0BE');
  };
  readColors();
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  on(darkQuery, 'change', readColors);
  const themeObserver = new MutationObserver(readColors);
  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => themeObserver.disconnect());

  // ---- Layout, anchors and scroll poses ----
  let anchors = [];
  let sizesY = null;
  let zoneEnd = Infinity;
  let ingEl = null;
  function computeAnchors() {
    const vh = window.innerHeight;
    const sy = window.scrollY;
    anchors = Array.from(document.querySelectorAll('[data-pose]')).map((el) => {
      const r = el.getBoundingClientRect();
      const name = el.dataset.pose;
      return { name, y: name === 'hero' ? 0 : Math.max(0, r.top + sy + r.height / 2 - vh / 2) };
    }).sort((a, b) => a.y - b.y);
    const s = anchors.find((a) => a.name === 'sizes');
    sizesY = s ? s.y : null;
    const solid = document.querySelector('.solid');
    zoneEnd = solid ? solid.getBoundingClientRect().top + sy : Infinity;
    ingEl = document.getElementById('ingredients');
  }
  function layout() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 820 ? 1.5 : 2));
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    narrow = window.innerWidth < 820;
    const frac = narrow ? 0.42 : aspect < 1.25 ? 0.5 : 0.6;
    D = 1.44 / frac / (2 * tanH);
    camera.updateProjectionMatrix();
    computeAnchors();
  }
  const mixPose = (A, B, u) => ({
    big: A.big.map((v, i) => v + (B.big[i] - v) * u),
    small: A.small.map((v, i) => v + (B.small[i] - v) * u),
    ing: A.ing.map((v, i) => v + (B.ing[i] - v) * u),
    mark: A.mark + (B.mark - A.mark) * u,
  });
  function poseAt(sy) {
    const set = POSES[narrow ? 'narrow' : 'wide'];
    if (!anchors.length || sy <= anchors[0].y) return mixPose(set.hero, set.hero, 0);
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const A = anchors[i];
      const B = anchors[i + 1];
      if (sy < B.y) {
        const u = smooth(clamp(((sy - A.y) / Math.max(1, B.y - A.y) - 0.15) / 0.7, 0, 1));
        return mixPose(set[A.name] || set.hero, set[B.name] || set.hero, u);
      }
    }
    const last = set[anchors[anchors.length - 1].name] || set.hero;
    return mixPose(last, last, 0);
  }

  layout();
  let cur = poseAt(window.scrollY);
  let resizeTimer = 0;
  const scheduleLayout = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (disposed) return;
      layout();
      wake();
    }, 80);
  };
  const resizeObserver = new ResizeObserver(scheduleLayout);
  resizeObserver.observe(canvas);
  const main = document.getElementById('main');
  if (main) resizeObserver.observe(main);
  cleanups.push(() => resizeObserver.disconnect());
  on(window, 'resize', scheduleLayout);

  // ---- Input ----
  let sel = initialSize;
  let selB = sel === 'big' ? 1 : 0;
  let drag = 0;
  let dragging = false;
  let lastX = 0;
  document.querySelectorAll('[data-drag]').forEach((el) => {
    on(el, 'pointerdown', (e) => {
      if (!root.classList.contains('gl-ready')) return;
      dragging = true;
      lastX = e.clientX;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
      wake();
    });
    on(el, 'pointermove', (e) => {
      if (!dragging) return;
      drag = clamp(drag + (e.clientX - lastX) * 0.012, -4, 4);
      lastX = e.clientX;
    });
    on(el, 'pointerup', () => { dragging = false; });
    on(el, 'pointercancel', () => { dragging = false; });
  });
  let mx = 0;
  let my = 0;
  let pmx = 0;
  let pmy = 0;
  if (window.matchMedia('(pointer: fine)').matches && !reduceMotion) {
    on(window, 'pointermove', (e) => {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  // ---- Frame ----
  let t0 = performance.now() + 150;
  let lastT = performance.now();
  let running = false;
  let raf = 0;
  function place(pivot, p, ex) {
    const z = p[2] + ex.z;
    const x = p[0] * visW(z);
    const y = p[1] * visH(z) + ex.y;
    const s = p[6] * ex.s;
    pivot.position.set(x, y, z);
    pivot.rotation.set(p[4], p[3] + ex.yaw, p[5]);
    pivot.scale.setScalar(s);
    return { x, y, z, s, roll: p[5] };
  }
  function placeShadow(B, P, strength) {
    const halfH = ((B.b.H * S) / 2) * P.s;
    const w = B.b.maxW * S * P.s;
    B.shadow.position.set(P.x, P.y - halfH - 0.012, P.z - 0.06);
    B.shadow.scale.set(w * 2.9, w * 0.42, 1);
    B.shadow.material.opacity = clamp(strength * (1 - Math.abs(P.roll) * 3), 0, 1) * 0.55;
  }
  function frame(now) {
    const dt = clamp((now - lastT) / 1000, 0.001, 0.05);
    lastT = now;
    const t = now / 1000;
    const sy = window.scrollY;
    const vh = window.innerHeight;
    const tgt = poseAt(sy);
    const k = 1 - Math.exp(-dt * (reduceMotion ? 14 : 5.5));
    ['big', 'small', 'ing'].forEach((key2) => {
      for (let i = 0; i < cur[key2].length; i += 1) cur[key2][i] += (tgt[key2][i] - cur[key2][i]) * k;
    });
    cur.mark += (tgt.mark - cur.mark) * k;

    const ip = reduceMotion ? 1 : clamp((now - t0) / 2400, 0, 1);
    const eRot = 1 - (1 - ip) ** 4;
    const ePos = 1 - (1 - ip) ** 3;
    selB += ((sel === 'big' ? 1 : 0) - selB) * (1 - Math.exp(-dt * 6));
    const wS = sizesY == null ? 0 : clamp(1 - Math.abs(sy - sizesY) / (vh * 0.6), 0, 1);
    if (!dragging) drag *= Math.exp(-dt * 2.4);
    const idle = reduceMotion ? 0 : 1;

    let deep = 0;
    if (ingEl) {
      const r = ingEl.getBoundingClientRect();
      const inT = smooth(clamp((vh * 0.9 - r.top) / (vh * 0.6), 0, 1));
      const outT = smooth(clamp((vh * 0.7 - r.bottom) / (vh * 0.6), 0, 1));
      deep = inT * (1 - outT);
    }

    const pb = place(BIG.pivot, cur.big, {
      z: wS * (selB * 0.3 - (1 - selB) * 0.14),
      s: (0.9 + 0.1 * ePos) * (1 + wS * selB * 0.03),
      y: -(1 - ePos) * visH(0) * 0.9 + Math.sin(t * 1.1) * 0.012 * idle,
      yaw: (1 - eRot) * -Math.PI * 2.5 + Math.sin(t * 0.5) * 0.06 * idle + drag,
    });
    const ps = place(SMALL.pivot, cur.small, {
      z: wS * ((1 - selB) * 0.3 - selB * 0.14),
      s: 1 + wS * (1 - selB) * 0.03,
      y: Math.sin(t * 1.1 + 1.7) * 0.012 * idle,
      yaw: Math.sin(t * 0.5 + 1.7) * 0.06 * idle + drag,
    });
    placeShadow(BIG, pb, ePos * (1 - deep));
    placeShadow(SMALL, ps, 1 - deep);

    const [show, wSalt, wDrop, wMint] = cur.ing;
    const ringS = narrow ? 0.78 : 1;
    const orbit = t * 0.12 * idle + cur.big[3] * 0.3;
    ingGroup.position.set(pb.x, pb.y, 0);
    elems.forEach((e) => {
      const w = e.g === 0 ? wSalt : e.g === 1 ? wDrop : wMint;
      const sc = e.base * show ** 1.5 * (0.35 + 0.65 * w) * ringS;
      if (show < 0.04 || sc < 0.002) {
        e.mesh.visible = false;
        return;
      }
      e.mesh.visible = true;
      const th = e.th + orbit;
      const rad = e.r * ringS * (1 + (1 - show) * 0.5);
      e.mesh.position.set(Math.cos(th) * rad, e.h * ringS + Math.sin(t * 0.9 + e.ph) * 0.03 * idle, Math.sin(th) * rad * 0.85);
      e.mesh.rotation.set(e.rx + t * e.sx * idle, e.ry + t * e.sy * idle, e.rz);
      e.mesh.scale.setScalar(sc);
    });
    halo.position.set(pb.x, pb.y, -1.1);
    halo.material.opacity = deep * 0.45;
    rim.intensity = 0.9 + deep * 0.9;
    edgeTone.value = Math.max(deep, darkPage);
    mark.position.set(pb.x, pb.y - 0.02, -2.6);
    mark.scale.setScalar(narrow ? 0.42 : 0.55);
    mark.material.opacity = cur.mark * ePos;

    pmx += (mx - pmx) * k;
    pmy += (my - pmy) * k;
    camera.position.set(pmx * 0.14, 0.05 - pmy * 0.08, D);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  const shouldRun = () => !disposed && !document.hidden && window.scrollY < zoneEnd + 2;
  function loop(now) {
    raf = 0;
    frame(now);
    if (shouldRun()) raf = requestAnimationFrame(loop);
    else running = false;
  }
  function wake() {
    if (!running && shouldRun()) {
      running = true;
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }
  on(window, 'scroll', wake, { passive: true });
  on(document, 'visibilitychange', wake);

  frame(performance.now());
  root.classList.add('gl-ready');
  t0 = performance.now() + 150;
  running = true;
  raf = requestAnimationFrame(loop);

  return {
    setSize(size) {
      sel = size === 'small' ? 'small' : 'big';
      wake();
    },
    refresh() {
      if (disposed) return;
      computeAnchors();
      wake();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      cleanups.forEach((fn) => fn());
      root.classList.remove('gl-ready');
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); });
            m.dispose();
          });
        }
      });
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
    },
  };
}
