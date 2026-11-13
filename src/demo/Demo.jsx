// /demo — a cinematic, scroll-snapped product page: seven scenes around one 3D DOMCH bottle.
// Layers (back to front): background colour, text behind the bottle, the WebGL canvas, the page UI.
// The page scrolls through seven full-height stops; one frame loop eases between them and moves everything.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, track } from '../lib/api.js';
import { formatPrice } from '../lib/util.js';
import { FALLBACK } from '../data/static.js';
import { Adult, Arrow, Chat, Chevron, Close, Flask, Menu, NoAlcohol, Phone, Pin, Shield, Swipe } from '../components/Icons.jsx';
import './demo.css';

const IDS = ['hero', 'ingredients', 'quality', 'light', 'details', 'products', 'finale'];
const DOT_LABELS = ['Нүүр', 'Найрлага', 'Чанар', 'Гэрлийн тууз', 'Нарийн зүйлс', 'Бүтээгдэхүүн', 'Төгсгөл'];
const PHOTO = '/media/domch_bottles.webp';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap';

// The full ingredient list from the label, in its order; same order and colours as the orbs in the 3D scene.
const ING = [
  { key: 'water', name: 'Шүүсэн ус', tag: 'Спирт агуулаагүй', side: 'left', color: '#46dcff', pos: [-0.27, 0.235], img: '/media/ing-water.svg' },
  { key: 'salt', name: 'Жамц давс', tag: 'Үрэвслийг намдаана', side: 'right', color: '#ff8fb6', pos: [0.27, 0.235], img: '/media/ing-salt.webp' },
  {
    key: 'clove', name: 'Хадаасан цэцгийн ханд', sub: '(башир цэцэг)', tag: 'Эвгүй үнэрийг арилгана', side: 'left', color: '#ffad4d',
    pos: [-0.295, 0], img: '/media/ing-clove.webp',
  },
  { key: 'mint', name: 'Гаа', tag: 'Сэрүүн амт өгнө', side: 'right', color: '#5cff9d', pos: [0.295, 0], img: '/media/ing-mint.webp' },
  { key: 'glycerin', name: 'Глицерин', tag: 'Чийгшүүлэгч', side: 'left', color: '#b892ff', pos: [-0.27, -0.235], img: '/media/ing-glycerin.svg' },
  { key: 'blue', name: 'FD&C Blue No.1', tag: 'Өнгө оруулагч', side: 'right', color: '#3f6bff', pos: [0.27, -0.235], img: '/media/ing-blue.svg' },
];

const PERKS = [
  { Icon: NoAlcohol, t: 'Спирт агуулаагүй', d: 'Шүүсэн ус, жамц давс, ургамлын ханд' },
  { Icon: Flask, t: 'Лабораторийн хяналт', d: 'Чанарыг өдөр бүр итгэмжлэгдсэн лабораторид шалгана' },
  { Icon: Shield, t: 'ISO 9001 · Аюулгүйн тэмдэг', d: 'Чанар, үйл ажиллагааны баталгаажуулалттай' },
  { Icon: Adult, t: 'Гэр бүлийн хэрэглээ', d: 'Насанд хүрэгч 25 мл · хүүхэд 15 мл' },
];

const CALLOUTS = [
  { id: 'cap', t: ['Нарийн зүйлсэд', 'анхаарсан'], d: 'Эргэдэг таг · тасалгааны хэмд 12 сар хадгална' },
  { id: 'label', t: ['Жамц давсны', 'уусмал'], d: 'Найрлага, хэрэглэх заавар шошгон дээр' },
];

const NAV = [
  { id: 'home', label: 'Нүүр', scene: 0, on: [0, 6] },
  { id: 'ing', label: 'Найрлага', scene: 1, on: [1], menu: true },
  { id: 'quality', label: 'Онцлог', scene: 2, on: [2, 3, 4] },
  { id: 'products', label: 'Бүтээгдэхүүн', scene: 5, on: [5], menu: true },
  { id: 'where', label: 'Хаанаас авах', href: '/#where' },
];

// Background per scene: [top-left, bottom-right, glow].
const BG = [
  ['#08090b', '#020303', '#121b1e'],
  ['#060708', '#020203', '#0b1517'],
  ['#060a0c', '#020405', '#0a2426'],
  ['#131838', '#1e2452', '#2e2f72'],
  ['#b8a5ef', '#8bb4f4', '#dccfff'],
  ['#b3a2ee', '#93bdf6', '#e4dbff'],
  ['#0b0f17', '#030407', '#131c29'],
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => u * u * (3 - 2 * u);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG_RGB = BG.map((row) => row.map(hex));
const mixRgb = (a, b, u) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(',')})`;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useMedia(query) {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

const Instagram = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);
const Facebook = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21z" />
  </svg>
);
const Bag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
  </svg>
);
const Prev = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
);
const Next = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

export default function Demo() {
  const [content, setContent] = useState({
    products: FALLBACK.products, settings: {}, messenger: { enabled: false, link: '' }, filters: FALLBACK.filters,
  });
  const [active, setActive] = useState(0);
  const [gl, setGl] = useState('wait');
  const [turned, setTurned] = useState(false);
  const [card, setCard] = useState(null);
  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState(null);
  const [sheet, setSheet] = useState(false);
  const narrow = useMedia('(max-aspect-ratio: 9/10)');
  const compactNav = useMedia('(max-width: 1023px)');

  const canvasRef = useRef(null);
  const bgRef = useRef(null);
  const heroRef = useRef(null);
  const heroL = useRef(null);
  const heroR = useRef(null);
  const markRef = useRef(null);
  const headRef = useRef(null);
  const sceneEls = useRef([]);
  const orbEls = useRef([]);
  const callEls = useRef([]);
  const lineEls = useRef([]);
  const ctlRef = useRef(null);
  const stepRef = useRef(1);
  const pdRef = useRef(0);
  const activeRef = useRef(0);
  const rootRef = useRef(null);
  const viewEls = useRef({});
  const resized = useRef(false);
  const openedOnce = useRef(false);

  // ---- data ----
  useEffect(() => {
    let alive = true;
    api('/content')
      .then((d) => {
        if (!alive || !d) return;
        setContent({
          products: d.products && d.products.length ? d.products : FALLBACK.products,
          settings: d.settings || {},
          messenger: d.messenger || { enabled: false, link: '' },
          filters: d.filters || FALLBACK.filters,
        });
      })
      .catch(() => {
        /* the page keeps its built-in content */
      });
    return () => {
      alive = false;
    };
  }, []);

  const products = useMemo(() => [...content.products]
    .sort((a, b) => a.volume_ml - b.volume_ml)
    .map((p) => ({ ...p, size: p.slug === 'small' || p.volume_ml < 400 ? 'small' : 'big' })), [content.products]);
  const cur = card === null ? Math.max(0, products.length - 1) : Math.min(card, products.length - 1);
  // one live 3D bottle per size: the first card of each size shows it
  const live = useMemo(() => {
    const seen = new Set();
    return new Set(products.filter((p) => !seen.has(p.size) && seen.add(p.size)).map((p) => p.id));
  }, [products]);
  const branchCount = useMemo(() => {
    const f = content.filters || {};
    const n = Object.values(f.chainCounts || {}).reduce((a, v) => a + Number(v || 0), 0) + Number(f.single || 0);
    return n > 0 ? n : null;
  }, [content.filters]);
  const phone = content.settings.phone || '7799-7799';
  const phoneHref = `tel:${phone.replace(/[^\d+]/g, '')}`;

  // ---- page set-up: snapping on the document, the condensed display face, the tab title ----
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dm-on');
    const prevTitle = document.title;
    document.title = 'ДОМЧ — Зүгээр л ам зайлагч биш';
    if (!document.querySelector('link[href*="Oswald"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HREF;
      document.head.appendChild(link);
    }
    return () => {
      root.classList.remove('dm-on');
      document.title = prevTitle;
    };
  }, []);

  // ---- measuring: scroll step, hero gap ----
  const measure = useCallback(() => {
    const stops = document.querySelectorAll('.dm-stop');
    stepRef.current = stops.length > 1 ? stops[1].offsetTop - stops[0].offsetTop : window.innerHeight;
    const ctl = ctlRef.current;
    resized.current = true;
    if (ctl) {
      ctl.resize();
      if (heroL.current && heroR.current) ctl.setHeroShift((heroL.current.offsetWidth - heroR.current.offsetWidth) / 2);
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 60);
    };
    measure();
    window.addEventListener('resize', later);
    if (document.fonts) {
      document.fonts.ready.then(measure).catch(() => {});
      document.fonts.load('700 80px Oswald').then(measure).catch(() => {});
    }
    // open at the scene named in the address (#products …)
    const id = window.location.hash.replace('#', '');
    const at = IDS.indexOf(id);
    if (at > 0) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: at * stepRef.current, behavior: 'auto' });
        pdRef.current = at;
      });
    }
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', later);
    };
  }, [measure]);

  // ---- the 3D stage ----
  useEffect(() => {
    let cancelled = false;
    let ctl = null;
    import('../three/demoScene.js')
      .then(({ createDemoScene }) => createDemoScene({ canvas: canvasRef.current }))
      .then((c) => {
        if (cancelled) {
          if (c) c.dispose();
          return;
        }
        if (!c) {
          setGl('off');
          return;
        }
        ctl = c;
        ctlRef.current = c;
        setGl('on');
        measure();
      })
      .catch(() => {
        if (!cancelled) setGl('off');
      });
    return () => {
      cancelled = true;
      ctlRef.current = null;
      if (ctl) ctl.dispose();
    };
  }, [measure]);

  // ---- the frame loop: ease towards the scroll position, draw the bottle, move the UI ----
  useEffect(() => {
    const reduce = reduceMotion();
    let raf = 0;
    let last = performance.now();
    pdRef.current = window.scrollY / stepRef.current;

    const placeLines = (pd, a) => {
      const e = clamp(1 - Math.abs(pd - 4) * 1.8, 0, 1);
      const shift = (pd - 4) * 56;
      CALLOUTS.forEach((c, i) => {
        const box = callEls.current[i];
        const line = lineEls.current[i];
        if (!box || !line) return;
        const target = a && a[c.id];
        if (!target || e <= 0.02) {
          line.style.opacity = '0';
          return;
        }
        // wide screens: from the box side facing the bottle; portrait: from the box edge facing it
        const thin = window.innerWidth / window.innerHeight < 0.9;
        const leftBox = box.offsetLeft + box.offsetWidth / 2 < window.innerWidth / 2;
        const below = box.offsetTop + box.offsetHeight / 2 > window.innerHeight / 2;
        let sx = leftBox ? box.offsetLeft + box.offsetWidth : box.offsetLeft;
        let sy = box.offsetTop + box.offsetHeight * (leftBox ? 0.32 : 0.7);
        if (thin) {
          sx = box.offsetLeft + box.offsetWidth * (leftBox ? 0.72 : 0.28);
          sy = below ? box.offsetTop : box.offsetTop + box.offsetHeight;
        }
        const tx = target.x;
        const ty = target.y + shift;
        const path = line.querySelector('path');
        const dots = line.querySelectorAll('circle');
        path.setAttribute('d', `M${sx.toFixed(1)} ${sy.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)}`);
        path.style.strokeDashoffset = (1 - smooth(e)).toFixed(3);
        dots.forEach((dot) => {
          dot.setAttribute('cx', tx.toFixed(1));
          dot.setAttribute('cy', ty.toFixed(1));
        });
        line.style.opacity = smooth(e).toFixed(3);
      });
    };

    const applyScenes = (pd) => {
      sceneEls.current.forEach((el, i) => {
        if (!el) return;
        const d = pd - i;
        const v = clamp(1 - Math.abs(d) * 1.8, 0, 1);
        const e = smooth(v);
        el.style.opacity = e.toFixed(3);
        el.style.setProperty('--d', d.toFixed(3));
        const on = e > 0.02 ? '1' : '0';
        if (el.dataset.on !== on) {
          el.dataset.on = on;
          el.style.visibility = on === '1' ? 'visible' : 'hidden';
        }
      });
      const hero = heroRef.current;
      if (hero) {
        const v = smooth(clamp(1 - pd * 1.5, 0, 1));
        hero.style.opacity = v.toFixed(3);
        hero.style.setProperty('--d', pd.toFixed(3));
      }
      const mark = markRef.current;
      if (mark) {
        const v = smooth(clamp(1 - Math.abs(pd - 6) * 1.6, 0, 1));
        mark.style.opacity = v.toFixed(3);
        mark.style.setProperty('--d', (pd - 6).toFixed(3));
      }
      const bg = bgRef.current;
      if (bg) {
        const i = clamp(Math.floor(pd), 0, BG.length - 1);
        const j = Math.min(i + 1, BG.length - 1);
        const u = smooth(clamp(pd - i, 0, 1));
        const c = [0, 1, 2].map((n) => mixRgb(BG_RGB[i][n], BG_RGB[j][n], u));
        bg.style.background = `radial-gradient(70% 60% at 50% 56%, ${c[2]} 0%, transparent 72%), linear-gradient(150deg, ${c[0]}, ${c[1]})`;
      }
      // the bottles stand in the product cards, so there the canvas is drawn over the page
      if (rootRef.current) rootRef.current.classList.toggle('is-cards', Math.abs(pd - 5) < 0.5);
      const idx = clamp(Math.round(pd), 0, IDS.length - 1);
      if (idx !== activeRef.current) {
        activeRef.current = idx;
        setActive(idx);
      }
    };

    // where each product card shows its bottle (viewport pixels), near the products scene only
    const readCards = (pd) => {
      if (Math.abs(pd - 5) > 1.05) return null;
      const out = {};
      ['big', 'small'].forEach((size) => {
        const el = viewEls.current[size];
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) out[size] = { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      return out;
    };

    const applyAnchors = (pd, a) => {
      if (a) {
        a.orbs.forEach((o, k) => {
          const el = orbEls.current[k];
          if (!el) return;
          el.style.transform = `translate3d(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px, 0)`;
          el.style.setProperty('--r', `${o.r.toFixed(1)}px`);
          el.style.opacity = smooth(clamp(o.v * 1.4 - 0.3, 0, 1)).toFixed(3);
        });
      } else {
        const W = window.innerWidth;
        const H = window.innerHeight;
        const thin = W / H < 0.9;
        ING.forEach((ing, k) => {
          const el = orbEls.current[k];
          if (!el) return;
          const x = (0.5 + ing.pos[0] * (thin ? 1.12 : 1)) * W;
          const y = (0.5 - ing.pos[1] * (thin ? 1.13 : 1)) * H;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          el.style.setProperty('--r', `${(thin ? 0.095 * W : 0.066 * H).toFixed(1)}px`);
          el.style.opacity = '1';
        });
      }
      placeLines(pd, a);
    };

    let lastPd = -1;
    let lastCtl = null;
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = window.scrollY / stepRef.current;
      let pd = pdRef.current;
      pd = reduce ? target : pd + (target - pd) * (1 - Math.exp(-dt * 6.5));
      if (Math.abs(target - pd) < 0.0004) pd = target;
      pdRef.current = pd;
      const ctl = ctlRef.current;
      const dirty = ctl !== lastCtl;
      lastCtl = ctl;
      // with reduced motion nothing drifts on its own, so frames are drawn only when something changed
      if (!reduce || dirty || pd !== lastPd || resized.current || (ctl && ctl.busy())) {
        resized.current = false;
        applyScenes(pd);
        const anchors = ctl ? ctl.frame(pd, now, { cards: readCards(pd) }) : null;
        applyAnchors(pd, anchors);
      }
      lastPd = pd;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- turning by hand: drag a bottle or an orb (on touch screens sideways; up and down still scrolls) ----
  useEffect(() => {
    const root = document.documentElement;
    const fine = window.matchMedia('(pointer: fine)').matches;
    // the page's own controls keep their behaviour
    const ui = (el) => el && el.closest && el.closest('a, button, input, select, textarea, .dm-head, .dm-panel, .dm-perks, .dm-call, .dm-q__copy, .dm-dots, .dm-chat');
    let drag = null;
    let moved = false;
    let hoverRaf = 0;
    let hoverAt = null;
    const onDown = (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const ctl = ctlRef.current;
      if (!ctl || ui(e.target)) return;
      const h = ctl.pick(e.clientX, e.clientY);
      if (!h) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, t: performance.now(), h, mouse: e.pointerType === 'mouse' };
      moved = false;
      ctl.grab(h);
      root.classList.add('dm-grabbing');
      if (drag.mouse) e.preventDefault();
    };
    const onMove = (e) => {
      const ctl = ctlRef.current;
      if (drag && e.pointerId === drag.id) {
        if (!ctl) return;
        const now = performance.now();
        if (Math.abs(e.clientX - drag.x0) > 5) {
          if (!moved) setTurned(true);
          moved = true;
        }
        ctl.turn(drag.h, e.clientX - drag.x, drag.mouse ? e.clientY - drag.y : 0, now - drag.t);
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.t = now;
        return;
      }
      if (!fine || e.pointerType !== 'mouse' || !ctl) return;
      hoverAt = e;
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          const c = ctlRef.current;
          root.classList.toggle('dm-grab', !!(c && hoverAt && !ui(hoverAt.target) && c.pick(hoverAt.clientX, hoverAt.clientY)));
        });
      }
    };
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (ctlRef.current) ctlRef.current.release(drag.h);
      drag = null;
      root.classList.remove('dm-grabbing');
    };
    // a drag over a product card must not also select it
    const onClick = (e) => {
      if (!moved) return;
      moved = false;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('click', onClick, true);
    return () => {
      cancelAnimationFrame(hoverRaf);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('click', onClick, true);
      root.classList.remove('dm-grab', 'dm-grabbing');
    };
  }, []);

  // left / right arrow keys turn the bottle on screen (the one in the active card on the products scene)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctl = ctlRef.current;
      if (!ctl) return;
      const size = activeRef.current === 5 && products[cur] ? products[cur].size : 'big';
      ctl.nudge(e.key === 'ArrowLeft' ? -1 : 1, size);
      setTurned(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [products, cur]);

  // the cards moved: redraw so the bottles follow them (also with reduced motion)
  useEffect(() => {
    resized.current = true;
  }, [cur, panel, narrow, products, gl]);

  // ---- the address follows the scene; the product panel opens itself the first time ----
  useEffect(() => {
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(null, '', `${pathname}${search}${active ? `#${IDS[active]}` : ''}`);
    } catch {
      /* ignore */
    }
    if (active === 5 && !openedOnce.current) {
      openedOnce.current = true;
      const t = setTimeout(() => setPanel(true), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [active]);

  // ---- menus close on Escape or a click elsewhere ----
  useEffect(() => {
    if (!menu && !sheet) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setSheet(false);
      }
    };
    const onDown = (e) => {
      if (headRef.current && !headRef.current.contains(e.target)) {
        setMenu(null);
        setSheet(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [menu, sheet]);

  const go = useCallback((i) => {
    setMenu(null);
    setSheet(false);
    window.scrollTo({ top: i * stepRef.current, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, []);
  const showIngredient = (key) => {
    go(1);
    setTimeout(() => ctlRef.current && ctlRef.current.pulse(key), 650);
  };
  const showProduct = (i) => {
    setCard(i);
    setPanel(true);
    openedOnce.current = true;
    go(5);
  };
  const where = (from) => track('where_click', { from });

  // ---- product carousel layout ----
  const cw = narrow ? 188 : 232;
  const gap = narrow ? 14 : 26;
  const pw = 292;
  const panelBeside = panel && !narrow;
  const groupShift = panelBeside ? (pw + gap) / 2 : 0;
  const prod = products[cur];
  const step = (dir) => {
    setCard((cur + dir + products.length) % products.length);
  };

  const setScene = (i) => (el) => { sceneEls.current[i] = el; };

  const panelEl = prod && (
    <aside
      className="dm-panel"
      aria-hidden={!panel}
      style={narrow ? undefined : { transform: `translateX(${cw / 2 + gap + pw / 2 - groupShift}px)` }}
    >
      <p className="dm-panel__eyebrow">DOMCH · {prod.name}</p>
      <p className="dm-panel__title">{prod.volume_ml} мл</p>
      <div className="dm-meter"><span>Насанд хүрэгч · нэг удаад</span><b>25 мл</b><i style={{ '--w': panel ? 1 : 0 }} /></div>
      <div className="dm-meter"><span>Хүүхэд · нэг удаад</span><b>15 мл</b><i style={{ '--w': panel ? 0.6 : 0 }} /></div>
      <dl>
        <div><dt>Багтаамж</dt><dd>{prod.volume_ml} мл</dd></div>
        <div><dt>Үйлдвэрийн үнэ</dt><dd>{formatPrice(prod.price) || 'Лавлана уу'}</dd></div>
        <div><dt>Амт</dt><dd>Гаа</dd></div>
        <div><dt>Хадгалах</dt><dd>12 сар</dd></div>
      </dl>
      {prod.online_url ? (
        <a className="dm-panel__btn" href={prod.online_url} target="_blank" rel="noopener noreferrer" tabIndex={panel ? 0 : -1}
          onClick={() => track('online_click', { from: 'demo', size: prod.volume_ml })}>Онлайнаар авах</a>
      ) : (
        <a className="dm-panel__btn" href="/#where" tabIndex={panel ? 0 : -1} onClick={() => where('demo-panel')}>Хаанаас авах</a>
      )}
    </aside>
  );


  return (
    <div
      ref={rootRef}
      className={`dm${gl === 'off' ? ' dm--nogl' : ''}${gl === 'on' ? ' dm--gl' : ''}${active === 4 || active === 5 ? ' is-light' : ''}${menu || sheet ? ' menu-open' : ''}`}
    >
      <div className="dm-bg" ref={bgRef} aria-hidden="true" />

      {/* text that sits behind the bottle */}
      <div className="dm-back">
        <h1 className="dm-hero" ref={heroRef}>
          <span className="dm-hero__l" ref={heroL}>Зүгээр л</span>
          <span className="dm-hero__gap" aria-hidden="true" />
          <span className="dm-hero__r" ref={heroR}>ам зайлагч биш.</span>
        </h1>
        <p className="dm-mark" ref={markRef} aria-hidden="true">DOM<span>CH</span></p>
      </div>

      <canvas className="dm-gl" ref={canvasRef} aria-hidden="true" />
      {gl === 'off' && <img className="dm-photo" src={PHOTO} alt="" width="1040" height="1492" style={{ opacity: active === 5 ? 0 : 1 }} />}

      <div className="dm-front">
        <header className="dm-head" ref={headRef}>
          <div className="dm-util">
            <span>{branchCount ? `${branchCount} салбарт худалдаалж байна` : 'Эмийн сангуудад худалдаалж байна'}</span>
            <i aria-hidden="true" />
            <a href={phoneHref} onClick={() => track('call_click', { from: 'demo' })}><Phone size={12} /> {phone}</a>
          </div>
          <div className="dm-bar">
            <a className="dm-logo" href="/" aria-label="DOMCH, үндсэн сайт">DOM<span>CH</span></a>
            {!compactNav && (
              <nav className="dm-nav" aria-label="Demo цэс">
                {NAV.map((n) => {
                  const current = n.on && n.on.includes(active);
                  if (n.href) {
                    return <a key={n.id} className="dm-nav__btn" href={n.href} onClick={() => where('demo-nav')}>{n.label}</a>;
                  }
                  return (
                    <div key={n.id} className="dm-nav__item" onMouseEnter={() => n.menu && setMenu(n.id)} onMouseLeave={() => n.menu && setMenu(null)}>
                      <button
                        type="button"
                        className="dm-nav__btn"
                        aria-current={current ? 'true' : undefined}
                        aria-expanded={n.menu ? menu === n.id : undefined}
                        onClick={() => (n.menu && menu !== n.id ? setMenu(n.id) : go(n.scene))}
                      >
                        {n.label}
                        {n.menu && <Chevron size={12} open={menu === n.id} />}
                      </button>
                      {n.menu && menu === n.id && (
                        <div className="dm-drop">
                          {n.id === 'ing'
                            ? ING.map((i) => (
                              <button key={i.key} type="button" onClick={() => showIngredient(i.key)}>
                                <span className="dm-drop__dot" style={{ background: i.color, color: i.color }} />{i.name}{i.sub ? ` ${i.sub}` : ''}
                              </button>
                            ))
                            : products.map((p, i) => (
                              <button key={p.id} type="button" onClick={() => showProduct(i)}>
                                <span className="dm-drop__vol">{p.volume_ml}</span>мл · {p.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            )}
            <div className="dm-icons">
              {content.settings.instagram && (
                <a className="dm-ico" href={content.settings.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram"><Instagram /></a>
              )}
              {content.settings.facebook && (
                <a className="dm-ico" href={content.settings.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook"><Facebook /></a>
              )}
              <button type="button" className="dm-ico dm-bag" aria-label={`Бүтээгдэхүүн, ${products.length} хэмжээ`} onClick={() => go(5)}>
                <Bag /><i>{products.length}</i>
              </button>
              {compactNav && (
                <button type="button" className="dm-ico" aria-expanded={sheet} aria-controls="dm-sheet" aria-label={sheet ? 'Цэс хаах' : 'Цэс нээх'}
                  onClick={() => setSheet(!sheet)}>
                  {sheet ? <Close /> : <Menu />}
                </button>
              )}
            </div>
          </div>
          {compactNav && sheet && (
            <div className="dm-sheet" id="dm-sheet">
              {NAV.map((n) => (n.href ? (
                <a key={n.id} href={n.href} onClick={() => where('demo-menu')}>{n.label}<Arrow /></a>
              ) : (
                <button key={n.id} type="button" aria-current={n.on.includes(active) ? 'true' : undefined} onClick={() => go(n.scene)}>
                  {n.label}<Arrow />
                </button>
              )))}
              <a href={phoneHref} onClick={() => track('call_click', { from: 'demo-menu' })}><Phone size={16} /> {phone}</a>
            </div>
          )}
        </header>

        {/* 1 · hero: the headline is behind the bottle; only the cue sits in front */}
        <section className="dm-s dm-s--hero" ref={setScene(0)} aria-label="Нүүр">
          <button type="button" className="dm-cue" onClick={() => go(1)}><i aria-hidden="true" />Доош гүйлгэнэ үү</button>
          {gl === 'on' && (
            <p className={`dm-hint${turned ? ' is-done' : ''}`}><Swipe /> Савыг чирж эргүүлнэ үү</p>
          )}
        </section>

        {/* 2 · ingredients round the glowing bottle */}
        <section className="dm-s dm-s--ing" ref={setScene(1)} aria-labelledby="dm-ing-title">
          <h2 className="dm-sr" id="dm-ing-title">Найрлага</h2>
          {ING.map((i, k) => (
            <div key={i.key} className="dm-orb" data-side={i.side} style={{ '--c': i.color }} ref={(el) => { orbEls.current[k] = el; }}>
              <img className="dm-orb__img" src={i.img} alt="" loading="lazy" />
              <span className="dm-orb__tag">{i.tag}</span>
              <h3 className="dm-orb__name">{i.name}{i.sub && <small>{i.sub}</small>}</h3>
            </div>
          ))}
        </section>

        {/* 3 · tested and controlled: copy, the lifted cap, a card of facts */}
        <section className="dm-s dm-s--quality" ref={setScene(2)} aria-labelledby="dm-q-title">
          <div className="dm-q__copy">
            <h2 id="dm-q-title">Туршилтаар<br />баталгаажсан.</h2>
            <p>Эмнэл зүйн туршилт судалгаагаар баталгаажсан жор. Чанар, аюулгүй байдлыг нь өдөр бүр лабораторид хянадаг.</p>
            <a className="dm-btn" href="/#where" onClick={() => where('demo-quality')}>Хаанаас авах</a>
          </div>
          <aside className="dm-perks" aria-label="Онцлог үзүүлэлт">
            <h3>Онцлог үзүүлэлт</h3>
            <ul>
              {PERKS.map(({ Icon, t, d }) => (
                <li key={t}>
                  <span className="dm-perks__ico"><Icon size={17} /></span>
                  <span><strong>{t}</strong><small>{d}</small></span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        {/* 4 · light ribbons (picture only) */}
        <section className="dm-s dm-s--light" ref={setScene(3)} aria-label="Сэргэг мэдрэмж">
          <p className="dm-light">Өдөр бүрийн <em>сэргэг</em> мэдрэмж</p>
        </section>

        {/* 5 · details, with lines to the bottle */}
        <section className="dm-s dm-s--details" ref={setScene(4)} aria-label="Нарийн зүйлс">
          {CALLOUTS.map((c, i) => (
            <svg key={`l-${c.id}`} className="dm-line" aria-hidden="true" ref={(el) => { lineEls.current[i] = el; }}>
              <path pathLength="1" />
              <circle r="9" className="dm-line__ring" />
              <circle r="3.5" />
            </svg>
          ))}
          {CALLOUTS.map((c, i) => (
            <div key={c.id} className={`dm-call dm-call--${c.id}`} ref={(el) => { callEls.current[i] = el; }}>
              <h3>{c.t[0]}<br />{c.t[1]}</h3>
              <p>{c.d}</p>
            </div>
          ))}
        </section>

        {/* 6 · product cards with a detail panel */}
        <section className="dm-s dm-s--products" ref={setScene(5)} aria-labelledby="dm-p-title">
          <h2 className="dm-sr" id="dm-p-title">Бүтээгдэхүүн</h2>
          <div className={`dm-car${panel ? ' is-open' : ''}`} style={{ '--cw': `${cw}px`, '--pw': `${pw}px` }}>
            {products.length > 1 && (
              <button type="button" className="dm-car__arrow is-prev" aria-label="Өмнөх бүтээгдэхүүн" onClick={() => step(-1)}><Prev /></button>
            )}
            <div className="dm-car__stage">
              {products.map((p, i) => {
                const on = i === cur;
                const x = (i - cur) * (cw + gap) + (panelBeside && i > cur ? pw + gap : 0) - groupShift;
                const price = formatPrice(p.price);
                return (
                  <article
                    key={p.id}
                    className={`dm-card${on ? ' is-active' : ''}`}
                    style={{ transform: `translateX(${x}px) scale(${on ? 1 : 0.9})`, zIndex: on ? 2 : 1 }}
                    aria-current={on ? 'true' : undefined}
                    onClick={() => { if (!on) setCard(i); }}
                  >
                    <span className="dm-card__tag">Гаа</span>
                    {gl === 'on' && live.has(p.id) ? (
                      <div
                        className="dm-card__view"
                        role="img"
                        aria-label={`DOMCH ${p.name}, ${p.volume_ml} мл. Чирж эргүүлнэ үү.`}
                        ref={(el) => { viewEls.current[p.size] = el; }}
                      />
                    ) : (
                      <img src={PHOTO} alt={`DOMCH ${p.name}, ${p.volume_ml} мл`} className="is-photo" />
                    )}
                    <h3>{p.name}</h3>
                    <p className="dm-card__meta">{p.volume_ml} мл{price ? ` · ${price}` : ''}</p>
                    <button
                      type="button"
                      className="dm-card__btn"
                      aria-expanded={on ? panel : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (on) setPanel(!panel);
                        else {
                          setCard(i);
                          setPanel(true);
                        }
                        track('size_select', { size: p.volume_ml, from: 'demo' });
                      }}
                    >
                      {on && panel ? 'Хураах' : 'Дэлгэрэнгүй'}
                    </button>
                  </article>
                );
              })}
              {!narrow && panelEl}
            </div>
            {products.length > 1 && (
              <button type="button" className="dm-car__arrow is-next" aria-label="Дараагийн бүтээгдэхүүн" onClick={() => step(1)}><Next /></button>
            )}
            {narrow && panelEl}
          </div>
          <a className="dm-pill dm-pill--products" href="/#where" onClick={() => where('demo-products')}>
            <Pin size={16} /> Бүх салбарыг харах
          </a>
        </section>

        {/* 7 · finale: the wordmark is behind the bottle */}
        <section className="dm-s dm-s--finale" ref={setScene(6)} aria-labelledby="dm-f-title">
          <h2 id="dm-f-title" className="dm-tagline">Энгийнээс илүү.</h2>
          <a className="dm-pill" href="/">Домчтой танилцах</a>
        </section>

        <nav className="dm-dots" aria-label="Хэсгүүд">
          {IDS.map((id, i) => (
            <button key={id} type="button" aria-label={DOT_LABELS[i]} aria-current={active === i ? 'true' : undefined} onClick={() => go(i)} />
          ))}
        </nav>

        {content.messenger && content.messenger.enabled && content.messenger.link && (
          <a className="dm-chat" href={content.messenger.link} target="_blank" rel="noopener noreferrer" aria-label="Messenger-ээр бичих"
            onClick={() => track('messenger_click', { from: 'demo' })}>
            <Chat size={22} />
          </a>
        )}
      </div>

      <div className="dm-track" aria-hidden="true">
        {IDS.map((id) => <div key={id} id={id} className="dm-stop" />)}
      </div>
    </div>
  );
}
