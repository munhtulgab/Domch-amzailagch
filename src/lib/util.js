import { useEffect, useRef, useState } from 'react';

export const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  try {
    window.history.replaceState(null, '', `#${id}`);
  } catch {
    /* ignore */
  }
}

export function formatPrice(price) {
  if (price === null || price === undefined || price === '') return null;
  return `${String(Math.round(Number(price))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}₮`;
}

export function formatDate(value) {
  if (!value) return '';
  const plain = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return `${plain[1]}.${plain[2]}.${plain[3]}`;
  // Stored timestamps are UTC ("YYYY-MM-DD HH:MM:SS"); show them in the viewer's time zone.
  const d = new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(value)) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

export function youtubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('youtu.be')) return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

export function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function useInView(options = { rootMargin: '300px' }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return undefined;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, options);
    io.observe(el);
    return () => io.disconnect();
  }, [inView]); // eslint-disable-line react-hooks/exhaustive-deps
  return [ref, inView];
}

export const fold = (s) => String(s || '').toLocaleLowerCase('mn');
