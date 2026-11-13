// /demo: one DOMCH bottle carried through seven scroll scenes, after a cinematic product-site reel —
// mist, a neon outline with glowing ingredient orbs, the cap lifted off over a ring of light, light ribbons,
// details, product cards (rendered snapshots of the bottles) and the wordmark finale.
// The page owns scrolling and the frame loop; this module draws a frame for a given (damped) scene progress.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BOTTLES, S, clamp, cloveGeometries, loadBottleKit, radialTexture, rng, saltGeometry, smooth, sprigGeometry, surfacePoint, yWorld,
} from './bottle.js';

export const SCENES = ['hero', 'ingredients', 'quality', 'light', 'details', 'products', 'finale'];

// Per scene. Bottle: [x (share of the view width), y (share of the height), depth, turn, tip, lean, scale].
// mist, neon outline, ingredient orbs, lifted cap, light ribbons, and how light the page is (lavender = 1).
const K = (b, o = {}) => ({ b, mist: 0, glow: 0, orbs: 0, cap: 0, ribbons: 0, lav: 0, ...o });
const KEYS = {
  wide: [
    K([0, -0.035, 0, -0.38, 0, 0, 1], { mist: 1 }),
    K([0, -0.02, 0, 0.32, 0, 0, 0.8], { glow: 1, orbs: 1 }),
    K([-0.015, -0.115, 0, 0.95, 0.05, 0, 0.8], { cap: 1 }),
    K([0, -0.03, 0, 2.55, 0.03, -0.16, 0.88], { ribbons: 1, lav: 0.15 }),
    K([0, -0.045, 0, 6.38, 0, 0.06, 0.86], { ribbons: 0.86, lav: 1 }),
    K([0, -1.05, 0, 7.2, 0, 0, 0.8], { lav: 1 }),
    K([0, -0.03, 0, 12.15, 0, 0, 0.76], { mist: 0.35 }),
  ],
  narrow: [
    K([0, -0.115, 0, -0.38, 0, 0, 0.98], { mist: 1 }),
    K([0, -0.01, 0, 0.32, 0, 0, 0.64], { glow: 1, orbs: 1 }),
    K([0, -0.005, 0, 0.95, 0.05, 0, 0.5], { cap: 1 }),
    K([0, -0.02, 0, 2.55, 0.03, -0.16, 0.76], { ribbons: 1, lav: 0.15 }),
    K([0, -0.005, 0, 6.38, 0, 0.06, 0.66], { ribbons: 0.86, lav: 1 }),
    K([0, -1.1, 0, 7.2, 0, 0, 0.7], { lav: 1 }),
    K([0, 0.005, 0, 12.15, 0, 0, 0.68], { mist: 0.35 }),
  ],
};

// Ingredient orbs: where they float (share of the view, from the centre) and their glow.
export const ORBS = [
  { key: 'salt', color: '#ff8fb6', wide: [-0.265, 0.19], narrow: [-0.27, 0.235] },
  { key: 'mint', color: '#5cff9d', wide: [0.265, 0.19], narrow: [0.27, 0.235] },
  { key: 'clove', color: '#ffad4d', wide: [-0.25, -0.21], narrow: [-0.27, -0.235] },
  { key: 'water', color: '#4fb8ff', wide: [0.25, -0.21], narrow: [0.27, -0.235] },
];

const NEON = new THREE.Color('#4cf2df');

// ---- Shaders: glowing shells, a band of light and comet-tailed ribbons (premultiplied output) ----
const SHELL_VS = `
uniform float uThick;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position + normal * uThick, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
// Colours arrive in linear space; out() converts them for the screen as the built-in materials do.
const OUT = `
vec3 outCol(vec3 c) { return linearToOutputTexel(vec4(c, 1.0)).rgb; }`;
// The far side of an inflated copy: brightest where it meets the bottle's silhouette, fading outwards.
const HALO_FS = `${OUT}
uniform vec3 uColor;
uniform float uAmt;
uniform float uPow;
uniform float uScale;
varying vec3 vN;
varying vec3 vV;
void main() {
  float d = -dot(normalize(vN), normalize(vV));
  float g = clamp(pow(clamp(d * uScale, 0.0, 1.0), uPow) * uAmt, 0.0, 1.0);
  gl_FragColor = vec4(outCol(uColor) * g, g);
}`;
// Grazing-angle light on a skin just over the surface: the bright inner line of the outline, or a glass bubble.
const RIM_FS = `${OUT}
uniform vec3 uColor;
uniform float uAmt;
uniform float uPow;
uniform float uScale;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float g = (pow(f, uPow) * 1.25 + uScale) * uAmt;
  vec3 col = mix(outCol(uColor), vec3(1.0), pow(f, 7.0) * 0.55);
  g = clamp(g, 0.0, 1.0);
  gl_FragColor = vec4(col * g, g);
}`;
const BAND_VS = `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAND_FS = `${OUT}
uniform vec3 uColor;
uniform float uAmt;
uniform float uR;
uniform float uW;
varying vec2 vP;
void main() {
  float r = length(vP);
  float g = clamp(exp(-pow((r - uR) / uW, 2.0)) * uAmt, 0.0, 1.0);
  gl_FragColor = vec4(outCol(uColor) * g, g);
}`;
const RIBBON_VS = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const RIBBON_FS = `${OUT}
uniform vec3 uA;
uniform vec3 uB;
uniform float uHead;
uniform float uLen;
uniform float uAmt;
uniform float uCore;
uniform float uHot;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float s = fract(uHead - vUv.x);
  float k = clamp(s / uLen, 0.0, 1.0);
  float tail = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.006, s);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  vec3 col = mix(outCol(mix(uA, uB, k)), vec3(1.0), uHot * (1.0 - k * 0.6) * 0.75);
  float a = clamp(tail * pow(facing, uCore) * uAmt, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}`;

function shaderMat(vertexShader, fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    ...extra,
  });
}
const shellMat = (fs, color, thick, pow, scale, side) => shaderMat(SHELL_VS, fs, {
  uColor: { value: new THREE.Color(color) },
  uAmt: { value: 0 },
  uThick: { value: thick },
  uPow: { value: pow },
  uScale: { value: scale },
}, { side });

// Soft puffs of mist: fractal value noise under a round falloff.
function mistTexture(seed) {
  const N = 128;
  const G = 9;
  const rand = rng(seed);
  const grid = Array.from({ length: G * G }, () => rand());
  const at = (x, y) => grid[(((y % G) + G) % G) * G + (((x % G) + G) % G)];
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const cv = document.createElement('canvas');
  cv.width = N;
  cv.height = N;
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      let n = 0;
      let amp = 0.5;
      let f = 1;
      for (let o = 0; o < 4; o += 1) {
        n += amp * noise((x / N) * 4 * f + o * 3.1, (y / N) * 4 * f + o * 1.7);
        amp *= 0.5;
        f *= 2;
      }
      const dx = (x / N) * 2 - 1;
      const dy = (y / N) * 2 - 1;
      const fall = clamp(1 - Math.sqrt(dx * dx + dy * dy), 0, 1) ** 1.3;
      const lit = Math.round(255 * (0.8 + 0.2 * (1 - y / N)));
      const i = (y * N + x) * 4;
      img.data[i] = lit;
      img.data[i + 1] = lit;
      img.data[i + 2] = lit;
      img.data[i + 3] = Math.round(clamp((n - 0.3) * 2.5, 0, 1) * fall * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A drop of water: a sphere drawn up to a point.
function dropGeometry() {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i);
    const pinch = y > 0 ? 1 - y ** 1.6 * 0.82 : 1;
    p.setXYZ(i, p.getX(i) * pinch, y * (y > 0 ? 1.5 : 1), p.getZ(i) * pinch);
  }
  g.computeVertexNormals();
  return g;
}

const easeOutBack = (u) => {
  const c = 1.9;
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
};

/**
 * Start the 3D stage. Resolves to a controller, or null when WebGL or the artwork is unavailable.
 * @param {{ canvas: HTMLCanvasElement, media?: string }} options
 */
export async function createDemoScene({ canvas, media = '/media/' }) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const kit = await loadBottleKit({ renderer, media });
  if (!kit) {
    renderer.dispose();
    return null;
  }

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(-2.2, 3.2, 3.5);
  const rimL = new THREE.DirectionalLight(0x9ff3ff, 1.4);
  rimL.position.set(-3.2, 1.4, -2.4);
  const rimR = new THREE.DirectionalLight(0xffffff, 1.2);
  rimR.position.set(3, 2, -2.5);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9fb8ae, 0.3);
  scene.add(key, rimL, rimR, hemi);

  const FOV = 28;
  const tanH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  let D = 5;
  let W = 1;
  let H = 1;
  let aspect = 1;
  let narrow = false;
  let heroShift = 0;
  const visH = (z) => 2 * (D - z) * tanH;
  const visW = (z) => visH(z) * aspect;

  // ---- The bottle, with a neon outline (inflated far side + a bright skin) that follows the lifted cap ----
  const B = kit.build(BOTTLES.big);
  const b = B.b;
  scene.add(B.pivot);
  const halo = shellMat(HALO_FS, NEON, 0.04, 2.0, 2.2, THREE.BackSide);
  const skin = shellMat(RIM_FS, NEON, 0.0025, 4.5, 0, THREE.FrontSide);
  const outlined = [];
  const outline = (geo, parent, y = 0) => {
    [halo, skin].forEach((mat, i) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.renderOrder = 6 + i;
      parent.add(m);
      outlined.push(m);
    });
  };
  outline(B.body.geometry, B.inner);
  // neck and ring: an open tube; the cap: a lathe with a rounded top, so the line runs over it
  const topH = (b.neck.y1 - b.ring.y0) * S;
  outline(new THREE.CylinderGeometry(b.ring.r * S, b.ring.r * S, topH, 48, 1, true), B.inner, yWorld(b, (b.ring.y0 + b.neck.y1) / 2));
  {
    const r0 = b.cap.rBot * S;
    const r1 = b.cap.rTop * S;
    const yB = yWorld(b, b.cap.y1);
    const yT = yWorld(b, b.cap.y0) - 0.018;
    const pts = [new THREE.Vector2(r0, yB), new THREE.Vector2(r1, yT)];
    for (let i = 1; i <= 10; i += 1) {
      const a = (i / 10) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(r1 * Math.cos(a), 0.0005), yT + Math.sin(a) * 0.022));
    }
    outline(new THREE.LatheGeometry(pts, 64), B.cap);
  }

  // ---- Mist round the base ----
  const mist = new THREE.Group();
  scene.add(mist);
  const puffs = [];
  {
    const texes = [3, 11, 27, 41].map(mistTexture);
    const rand = rng(5);
    for (let i = 0; i < 42; i += 1) {
      const mat = new THREE.SpriteMaterial({
        map: texes[i % texes.length], color: 0xdfe6ea, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      });
      const s = new THREE.Sprite(mat);
      mist.add(s);
      const front = i % 3 === 0;
      // puffs in front of the bottle are drawn last, over its glass and drops
      s.renderOrder = front ? 12 : 0;
      puffs.push({
        s,
        x: (rand() - 0.5) * 2.2 * (0.35 + rand() * 0.65),
        y: front ? 0.02 + rand() * 0.16 : -0.06 + rand() * 0.2,
        z: front ? 0.25 + rand() * 0.45 : -0.7 + rand() * 0.85,
        size: 0.5 + rand() * 0.75,
        op: 0.2 + rand() * 0.24,
        rot: rand() * 6.28,
        vr: (rand() - 0.5) * 0.12,
        ph: rand() * 6.28,
        drift: (rand() - 0.5) * 0.05,
      });
    }
  }
  const floorTex = radialTexture([[0, 'rgba(255,255,255,0.75)'], [0.45, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: floorTex, color: 0x9fd8e8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // ---- Ingredient orbs: a glass bubble with the ingredient inside, an aura and a burst of glowing bits ----
  const auraTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.32, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const bubbleGeo = new THREE.SphereGeometry(1, 48, 32);
  const bitGeo = new THREE.IcosahedronGeometry(1, 0);
  const tint = (mat, color, k) => {
    const m = mat.clone();
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = k;
    return m;
  };
  const orbs = ORBS.map((o, idx) => {
    const group = new THREE.Group();
    scene.add(group);
    const color = new THREE.Color(o.color);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({
      map: auraTex, color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    }));
    aura.position.z = -1.05;
    aura.scale.setScalar(3.4);
    group.add(aura);
    const content = new THREE.Group();
    group.add(content);
    const rand = rng(50 + idx * 7);
    if (o.key === 'salt') {
      const mat = tint(kit.mats.saltMat, color, 0.18);
      [3, 8, 13, 21, 34, 55].forEach((seed, i) => {
        const m = new THREE.Mesh(saltGeometry(seed), mat);
        const a = (i / 6) * Math.PI * 2;
        m.position.set(Math.cos(a) * 0.32, (rand() - 0.5) * 0.4, Math.sin(a) * 0.3);
        m.rotation.set(rand() * 6, rand() * 6, rand() * 6);
        m.scale.setScalar(0.34 + rand() * 0.14);
        content.add(m);
      });
    } else if (o.key === 'mint') {
      const mat = tint(kit.mats.mintMat, color, 0.25);
      const sprig = sprigGeometry(339 / 519);
      [-0.5, 0.05, 0.6].forEach((a, i) => {
        const m = new THREE.Mesh(sprig, mat);
        m.rotation.set(0.2, a, -0.5 + i * 0.5);
        m.position.set((i - 1) * 0.18, (i - 1) * 0.05, (i - 1) * 0.06);
        m.scale.setScalar(1.15);
        content.add(m);
      });
    } else if (o.key === 'clove') {
      const geo = cloveGeometries();
      const body = tint(kit.mats.cloveMat, color, 0.2);
      const bud = tint(kit.mats.budMat, color, 0.2);
      for (let i = 0; i < 5; i += 1) {
        const c = new THREE.Group();
        c.add(new THREE.Mesh(geo.body, body), new THREE.Mesh(geo.bud, bud));
        const a = (i / 5) * Math.PI * 2;
        c.position.set(Math.cos(a) * 0.28, (rand() - 0.5) * 0.3, Math.sin(a) * 0.24);
        c.rotation.set(rand() * 6, rand() * 6, rand() * 6);
        c.scale.setScalar(0.95 + rand() * 0.2);
        content.add(c);
      }
    } else {
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xbfe8ff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.78, clearcoat: 1, clearcoatRoughness: 0,
        envMapIntensity: 2.4, emissive: color, emissiveIntensity: 0.32, ior: 1.33,
      });
      const drop = new THREE.Mesh(dropGeometry(), mat);
      drop.scale.setScalar(0.44);
      content.add(drop);
      for (let i = 0; i < 5; i += 1) {
        const d = new THREE.Mesh(bubbleGeo, mat);
        const a = (i / 5) * Math.PI * 2 + 0.4;
        d.position.set(Math.cos(a) * 0.62, (rand() - 0.5) * 0.7, Math.sin(a) * 0.4);
        d.scale.setScalar(0.07 + rand() * 0.07);
        content.add(d);
      }
    }
    const bubble = new THREE.Mesh(bubbleGeo, shellMat(RIM_FS, color, 0, 2.6, 0.05, THREE.FrontSide));
    bubble.renderOrder = 8;
    group.add(bubble);
    const nBits = 26;
    const bits = new THREE.InstancedMesh(bitGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }), nBits);
    group.add(bits);
    const seeds = Array.from({ length: nBits }, () => {
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(rand() * 2 - 1);
      return {
        dir: new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th) * 0.5),
        ph: rand(),
        sp: 0.12 + rand() * 0.16,
        size: 0.035 + rand() * 0.05,
        rx: rand() * 6,
        ry: rand() * 6,
      };
    });
    return { o, idx, group, aura, content, bubble, bits, seeds, pulse: 0 };
  });

  // ---- Ring of light round the neck while the cap is lifted ----
  const ring = new THREE.Group();
  B.inner.add(ring);
  const RING_R = 0.235;
  const ringCore = new THREE.Mesh(
    new THREE.TorusGeometry(RING_R, 0.0032, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  ringCore.rotation.x = Math.PI / 2;
  ring.add(ringCore);
  const band = new THREE.Mesh(
    new THREE.RingGeometry(RING_R - 0.08, RING_R + 0.08, 160, 1),
    shaderMat(BAND_VS, BAND_FS, {
      uColor: { value: new THREE.Color('#bff8ff') }, uAmt: { value: 0 }, uR: { value: RING_R }, uW: { value: 0.03 },
    }, { side: THREE.DoubleSide }),
  );
  band.rotation.x = -Math.PI / 2;
  ring.add(band);
  const bloom = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, 'rgba(255,255,255,0.55)'], [0.4, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]),
    color: 0x9ff6ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
  }));
  bloom.scale.set(RING_R * 3.2, RING_R * 1.6, 1);
  ring.add(bloom);
  const arcs = [[RING_R + 0.025, 2.4, 1.3], [RING_R - 0.02, 1.7, -0.9], [RING_R + 0.05, 1.1, 0.6]].map(([r, arc, speed]) => {
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.0024, 6, 120, arc),
      new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(m);
    ring.add(holder);
    return { holder, m, speed };
  });

  // ---- Light ribbons: closed loops round the bottle, a comet head running along each ----
  const ribbons = new THREE.Group();
  scene.add(ribbons);
  const loops = [
    { rx: 1.02, rz: 0.4, tilt: [0.32, 0.1, 0.28], wob: 0.025, a: '#62f3ff', bCol: '#4a6bff', speed: 0.12, len: 0.72, ph: 0 },
    { rx: 1.12, rz: 0.46, tilt: [-0.38, 0.5, -0.24], wob: 0.03, a: '#ff7ad9', bCol: '#8b5cff', speed: 0.09, len: 0.78, ph: 0.45 },
    { rx: 0.9, rz: 0.34, tilt: [0.16, -0.5, 0.5], wob: 0.02, a: '#b7a3ff', bCol: '#53e0ff', speed: 0.15, len: 0.6, ph: 0.8 },
    { rx: 1.2, rz: 0.5, tilt: [-0.12, 1.2, 0.12], wob: 0.02, a: '#7ff7ff', bCol: '#ff8ae0', speed: 0.07, len: 0.55, ph: 0.2 },
  ].map((L, li) => {
    const pts = [];
    for (let i = 0; i < 96; i += 1) {
      const th = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(th) * L.rx, Math.sin(th * 2 + li) * L.wob, Math.sin(th) * L.rz));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const holder = new THREE.Group();
    holder.rotation.set(...L.tilt);
    ribbons.add(holder);
    const layer = (radius, core, hot, amt) => {
      const mat = shaderMat(RIBBON_VS, RIBBON_FS, {
        uA: { value: new THREE.Color(L.a) }, uB: { value: new THREE.Color(L.bCol) }, uHead: { value: 0 }, uLen: { value: L.len },
        uAmt: { value: 0 }, uCore: { value: core }, uHot: { value: hot },
      });
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 420, radius, 8, true), mat);
      m.renderOrder = 9;
      holder.add(m);
      return { mat, amt };
    };
    return { L, holder, layers: [layer(0.034, 1.1, 0, 0.62), layer(0.012, 0.8, 0.25, 0.95), layer(0.0045, 0.3, 1, 1)] };
  });

  // ---- Layout ----
  function layout() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    aspect = W / H;
    narrow = aspect < 0.9;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 1.75));
    renderer.setSize(W, H, false);
    camera.aspect = aspect;
    // the bottle at scale 1 fills this share of the height (kept narrower than half the width on phones)
    const frac = narrow ? Math.min(0.5, (0.5 * aspect) / 0.46) : 0.62;
    D = (b.H * S) / frac / (2 * tanH);
    camera.updateProjectionMatrix();
  }
  layout();

  const keyAt = (p) => {
    const set = KEYS[narrow ? 'narrow' : 'wide'];
    const i = clamp(Math.floor(p), 0, set.length - 1);
    const j = Math.min(i + 1, set.length - 1);
    const u = smooth(clamp(p - i, 0, 1));
    const A = set[i];
    const Bk = set[j];
    const ax = i === 0 && !narrow ? heroShift : A.b[0];
    const bx = j === 0 && !narrow ? heroShift : Bk.b[0];
    const mix = (x, y) => x + (y - x) * u;
    return {
      b: A.b.map((v, n) => (n === 0 ? mix(ax, bx) : mix(v, Bk.b[n]))),
      mist: mix(A.mist, Bk.mist),
      glow: mix(A.glow, Bk.glow),
      orbs: mix(A.orbs, Bk.orbs),
      cap: mix(A.cap, Bk.cap),
      ribbons: mix(A.ribbons, Bk.ribbons),
      lav: mix(A.lav, Bk.lav),
    };
  };

  // ---- Input: a little camera drift with the pointer ----
  let mx = 0;
  let my = 0;
  let pmx = 0;
  let pmy = 0;
  const onPointer = (e) => {
    mx = (e.clientX / window.innerWidth) * 2 - 1;
    my = (e.clientY / window.innerHeight) * 2 - 1;
  };
  const fine = window.matchMedia('(pointer: fine)').matches && !reduce;
  if (fine) window.addEventListener('pointermove', onPointer, { passive: true });

  // ---- Frame ----
  const t0 = performance.now() + 120;
  let lastT = performance.now();
  const v3 = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const scl = new THREE.Vector3();
  const wrap = (v, m) => ((v % m) + m) % m;
  const toScreen = (v) => {
    v.project(camera);
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
  };
  const capPoint = new THREE.Vector3(0, yWorld(b, (b.cap.y0 + b.cap.y1) / 2), b.cap.rBot * S);
  const labelPoint = surfacePoint(b, 860, Math.PI / 2).p;
  const bodyPoint = surfacePoint(b, 1250, Math.PI / 2 + 0.6).p;

  function frame(pd, now) {
    const dt = clamp((now - lastT) / 1000, 0.001, 0.05);
    lastT = now;
    const t = reduce ? 0 : now / 1000;
    const idle = reduce ? 0 : 1;
    const k = keyAt(pd);
    const ip = reduce ? 1 : clamp((now - t0) / 2600, 0, 1);
    const eRise = 1 - (1 - ip) ** 3;
    const eSpin = 1 - (1 - ip) ** 4;

    // bottle
    const [bx, by, bz, yaw, tip, lean, sc] = k.b;
    const z = bz;
    const X = bx * visW(z);
    const Y = by * visH(z) - (1 - eRise) * visH(0) * 0.55 + Math.sin(t * 1.1) * 0.012 * idle;
    B.pivot.position.set(X, Y, z);
    B.pivot.rotation.set(tip, yaw + (1 - eSpin) * -Math.PI * 2 + Math.sin(t * 0.5) * 0.06 * idle, lean);
    B.pivot.scale.setScalar(sc * (0.92 + 0.08 * eRise));
    const halfH = ((b.H * S) / 2) * sc;
    B.pivot.visible = Y + halfH > -visH(z) / 2 - 0.05;

    // cap lifted off and turned
    const c = smooth(clamp(k.cap, 0, 1));
    B.cap.position.y = c * 0.36;
    B.cap.rotation.y = -c * 2.6 + c * t * 0.35;
    ring.position.y = yWorld(b, b.ring.y0) + c * 0.15;
    ring.rotation.x = 0.32 * c;
    ringCore.material.opacity = c;
    band.material.uniforms.uAmt.value = c * 0.95;
    bloom.material.opacity = c * 0.5;
    arcs.forEach((a) => {
      a.holder.rotation.y = t * a.speed;
      a.m.material.opacity = c * 0.9;
    });
    ring.visible = c > 0.002;

    // neon outline
    const glow = k.glow * eRise;
    halo.uniforms.uAmt.value = glow * 1.05;
    skin.uniforms.uAmt.value = glow * 0.7;
    outlined.forEach((m) => { m.visible = glow > 0.002; });

    // mist
    const m = k.mist * eRise;
    mist.visible = m > 0.002;
    if (mist.visible) {
      const baseY = Y - halfH;
      const spread = 1 + (1 - k.mist) * 0.8;
      const w = narrow ? 0.62 : 1;
      puffs.forEach((p, i) => {
        const drift = reduce ? 0 : wrap(p.drift * t + 1.1, 2.2) - 1.1;
        const x = (p.x * (0.45 + 0.55 * eRise) + Math.sin(t * 0.07 + p.ph) * 0.12 + drift * 0.25) * spread * w;
        p.s.position.set(X + x, baseY + p.y + Math.sin(t * 0.13 + p.ph) * 0.025 - (1 - k.mist) * 0.12, p.z);
        p.s.scale.setScalar(p.size * (0.55 + 0.45 * eRise) * (narrow ? 0.8 : 1) * (1 + (1 - k.mist) * 0.4));
        p.s.material.rotation = p.rot + p.vr * t;
        p.s.material.opacity = p.op * m * (i % 3 === 0 ? 0.9 : 1);
      });
    }
    const fl = Math.max(m * 0.55, 0);
    floor.visible = fl > 0.002;
    floor.position.set(X, Y - halfH + 0.004, z - 0.02);
    floor.scale.set(1.5 * sc, 0.5 * sc, 1);
    floor.material.opacity = fl;

    // orbs
    const ow = clamp(k.orbs, 0, 1);
    const orbAnchors = [];
    orbs.forEach((orb) => {
      const local = clamp(ow * 1.35 - orb.idx * 0.1, 0, 1);
      const pos = orb.o[narrow ? 'narrow' : 'wide'];
      const oz = 0.18;
      const R = narrow ? 0.12 * visW(oz) : 0.085 * visH(oz);
      const tx = pos[0] * visW(oz);
      const ty = pos[1] * visH(oz);
      const fly = smooth(local);
      orb.pulse = Math.max(0, orb.pulse - dt * 0.9);
      const pulse = 1 + Math.sin((1 - orb.pulse) * Math.PI) * orb.pulse * 0.18;
      const s = R * (local > 0 ? easeOutBack(local) : 0) * pulse;
      orb.group.visible = s > 0.0005;
      orb.group.position.set(X * (1 - fly) + tx * fly, Y * (1 - fly) + ty * fly + Math.sin(t * 0.9 + orb.idx) * 0.012 * idle, oz);
      orb.group.scale.setScalar(Math.max(s, 0.0001));
      orb.aura.material.opacity = 0.62 * local;
      orb.bubble.material.uniforms.uAmt.value = local;
      orb.content.rotation.set(Math.sin(t * 0.5 + orb.idx) * 0.25, t * 0.45 + orb.idx * 1.3, 0);
      orb.seeds.forEach((sd, j) => {
        const life = reduce ? sd.ph : (t * sd.sp + sd.ph) % 1;
        const dist = (1.1 + life * 1.5) * (0.35 + 0.65 * local);
        v3.copy(sd.dir).multiplyScalar(dist);
        quat.setFromEuler(eul.set(sd.rx + t * 0.8, sd.ry + t * 0.6, 0));
        const size = Math.max(sd.size * (1 - life) ** 0.6 * local, 0.0001);
        mtx.compose(v3, quat, scl.set(size, size * 0.7, size * 0.85));
        orb.bits.setMatrixAt(j, mtx);
      });
      orb.bits.instanceMatrix.needsUpdate = true;
      orbAnchors.push({ key: orb.o.key, wx: tx, wy: ty, R, local, oz });
    });

    // ribbons
    const rw = clamp(k.ribbons, 0, 1);
    ribbons.visible = rw > 0.002;
    ribbons.position.set(X, Y + 0.02, z);
    ribbons.scale.setScalar((narrow ? 0.62 : 1) * (0.86 + 0.14 * rw) * (sc / 0.88));
    ribbons.rotation.y = t * 0.05;
    loops.forEach((lp, li) => {
      // the details scene keeps one ribbon; all of them run in the light scene
      const show = li === 1 ? clamp(rw * 1.15, 0, 1) : clamp((rw - 0.9) * 10, 0, 1);
      lp.layers.forEach((ly) => {
        ly.mat.uniforms.uHead.value = (reduce ? 0.35 : t * lp.L.speed) + lp.L.ph;
        ly.mat.uniforms.uLen.value = lp.L.len * (0.35 + 0.65 * show);
        ly.mat.uniforms.uAmt.value = ly.amt * show;
      });
    });

    // light: brighter rims on the dark pages, a softer, airy fill on the lavender ones
    const lav = clamp(k.lav, 0, 1);
    rimL.intensity = 1.5 * (1 - lav) + 0.4 * lav;
    rimR.intensity = 1.3 * (1 - lav) + 0.8 * lav;
    key.intensity = 1.25 + 0.3 * lav;
    hemi.intensity = 0.28 + 0.4 * lav;

    pmx += (mx - pmx) * (1 - Math.exp(-dt * 4));
    pmy += (my - pmy) * (1 - Math.exp(-dt * 4));
    camera.position.set(pmx * 0.08, 0.05 - pmy * 0.05, D);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);

    // where the DOM labels go (CSS pixels)
    const orbsOut = orbAnchors.map((a) => {
      const p = toScreen(v3.set(a.wx, a.wy, a.oz));
      return { key: a.key, x: p.x, y: p.y, r: (a.R / visH(a.oz)) * H, v: a.local };
    });
    B.pivot.updateMatrixWorld(true);
    const cap = toScreen(B.cap.localToWorld(v3.copy(capPoint)));
    const label = toScreen(B.inner.localToWorld(v3.copy(labelPoint)));
    const body = toScreen(B.inner.localToWorld(v3.copy(bodyPoint)));
    const top = toScreen(v3.set(X, Y + halfH, z));
    const bottom = toScreen(v3.set(X, Y - halfH, z));
    return { orbs: orbsOut, cap, label, body, bottle: { x: (top.x + bottom.x) / 2, top: top.y, bottom: bottom.y } };
  }

  // ---- Product card pictures: each size rendered alone on a clear background ----
  function snapshots() {
    const out = {};
    const prevPR = renderer.getPixelRatio();
    const prev = renderer.getSize(new THREE.Vector2());
    const PW = 520;
    const PH = 700;
    const snap = new THREE.Scene();
    snap.environment = env;
    const k2 = new THREE.DirectionalLight(0xffffff, 1.5);
    k2.position.set(-2.2, 3.2, 3.5);
    const r2 = new THREE.DirectionalLight(0xffffff, 1.1);
    r2.position.set(3, 2, -2.5);
    snap.add(k2, r2, new THREE.HemisphereLight(0xffffff, 0xb9c6ff, 0.55));
    const cam = new THREE.PerspectiveCamera(22, PW / PH, 0.1, 30);
    const shared = new Set(Object.values(kit.mats));
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(PW, PH, false);
      ['small', 'big'].forEach((size) => {
        const built = kit.build(BOTTLES[size]);
        built.pivot.rotation.set(0.04, -0.5, 0);
        snap.add(built.pivot);
        const h = built.b.H * S;
        const dist = h / 0.84 / (2 * Math.tan(THREE.MathUtils.degToRad(11)));
        cam.position.set(0, 0.02, dist);
        cam.lookAt(0, 0, 0);
        renderer.render(snap, cam);
        out[size] = canvas.toDataURL('image/png');
        snap.remove(built.pivot);
        built.pivot.traverse((o) => {
          if (o.geometry && !o.isInstancedMesh) o.geometry.dispose();
          if (o.material && !shared.has(o.material)) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
      });
    } finally {
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prev.x, prev.y, false);
    }
    return out;
  }

  return {
    frame,
    snapshots,
    resize() {
      layout();
    },
    /** Desktop hero: move the bottle into the gap of the headline (pixels from the centre). */
    setHeroShift(px) {
      heroShift = W ? px / W : 0;
    },
    pulse(keyName) {
      const orb = orbs.find((o) => o.o.key === keyName);
      if (orb) orb.pulse = 1;
    },
    dispose() {
      if (fine) window.removeEventListener('pointermove', onPointer);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat) => {
            Object.values(mat).forEach((v) => { if (v && v.isTexture) v.dispose(); });
            mat.dispose();
          });
        }
      });
      env.dispose();
      renderer.dispose();
    },
  };
}
