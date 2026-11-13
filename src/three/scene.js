// Scroll-driven 3D bottles. The DOM marks story stops with [data-pose]; the bottles move between them.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BOTTLES, S, clamp, cloveGeometries, loadBottleKit, radialTexture, rng, saltGeometry, smooth, sprigGeometry, wordmarkTexture,
} from './bottle.js';

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

  const kit = await loadBottleKit({ renderer, media });
  if (!kit) {
    renderer.dispose();
    return null;
  }
  const { edgeTone } = kit;
  const { saltMat, cloveMat, budMat, mintMat } = kit.mats;
  const shadowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]);
  const haloTex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);

  // ---- Bottles ----
  function buildBottle(b) {
    const { pivot } = kit.build(b);
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
