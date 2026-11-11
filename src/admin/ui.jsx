import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

/* ---------- Icons: 24px stroke set, sized by the `size` prop ---------- */
const P = {
  home: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  chat: 'M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4A8 8 0 1 1 20 12Z',
  handshake: 'm11 17 2 2a1.4 1.4 0 0 0 2-2m-2-2 2.5 2.5a1.4 1.4 0 0 0 2-2l-3.3-3.4M3 13l3.5-3.6L9 8l3 1.2 1.3-.7a2.7 2.7 0 0 1 2.8.1L21 11M3 13l5 5a1.4 1.4 0 0 0 2-2M3 7l3.5 2.4M21 7l-3.5 2.4',
  question: 'M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.5M12 17.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z',
  pin: 'M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21Zm0-8.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  store: 'M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20',
  tag: 'M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-6.1 6.1a1.4 1.4 0 0 1-2 0ZM8 8h.01',
  doctor: 'M7 3.5v5a5 5 0 0 0 10 0v-5M7 3.5H5.5m11.5 0h1.5M12 13.5v1.5a4.5 4.5 0 0 0 9 0v-2M21 11.5a1.5 1.5 0 1 1 0 .01',
  book: 'M4.5 5.5A2 2 0 0 1 6.5 3.5h13v14h-13a2 2 0 0 0-2 2Zm0 0v14a2 2 0 0 0 2 2h13v-4',
  video: 'M3.5 7.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2Zm12 3.2 5-3v8.6l-5-3',
  help: 'M4 5.5h16v10H9l-5 4Zm5.5 3.5h5m-5 3h3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7.4 7.4 0 0 0-2.3-1.3L14.4 3h-4l-.3 2.4a7.4 7.4 0 0 0-2.3 1.3l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9a7.4 7.4 0 0 0 2.3 1.3l.3 2.4h4l.3-2.4a7.4 7.4 0 0 0 2.3-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z',
  search: 'M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Zm5.2-2 4.5 4.5',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 19.5h15',
  edit: 'M4 20h4L19.3 8.7a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16Zm9.5-13.5 4 4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7m-8.5 0 1 12.5h9L17 7M10 11v5m4-5v5',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2m0 15v2m9.5-9.5h-2m-15 0h-2m16.2-6.7-1.4 1.4M6.7 17.3l-1.4 1.4m0-13.4 1.4 1.4m10.6 10.6 1.4 1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  monitor: 'M3.5 5.5h17v11h-17Zm5 15h7m-3.5-4v4',
  logout: 'M14 4.5h4.5v15H14M9.5 8 5.5 12l4 4m-4-4h11',
  external: 'M14 4.5h5.5V10m0-5.5L11 13M18 14v5.5H4.5V6H10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3.5 3.5l17 17M10 6c.6-.2 1.3-.3 2-.3 6 0 9.5 6.3 9.5 6.3a17 17 0 0 1-2.6 3.3M6.6 7.2A17 17 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5M3.5 13.5V19h17v-5.5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
  phone: 'M5 4h3.5l1.5 4.5-2 1.3a11 11 0 0 0 6.2 6.2l1.3-2L20 15.5V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4Z',
  mail: 'M3.5 6h17v12h-17Zm0 .5L12 13l8.5-6.5',
  send: 'M21 3 3.5 10.2l6.8 3 3 6.8Zm0 0-10.7 10.2',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8m0-12.8-2.8 2.8m-7.2 7.2-2.8 2.8',
  layers: 'm12 3.5 9 4.5-9 4.5L3 8Zm-9 8.5 9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6Z',
};

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg className={`a-ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name] || P.spark} />
    </svg>
  );
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);
  const push = useCallback((text, tone = 'ok') => {
    seq.current += 1;
    const id = seq.current;
    setItems((list) => [...list.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="a-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`a-toast a-toast--${t.tone}`}>
            <Icon name={t.tone === 'error' ? 'close' : 'check'} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Drawer: a side panel on desktop, a full-height sheet on phones (built on <dialog>) ---------- */
export function Drawer({ title, subtitle, onClose, children, footer, variant = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    const previous = document.activeElement;
    try {
      d.showModal();
    } catch {
      d.setAttribute('open', '');
    }
    const first = d.querySelector('[data-autofocus]');
    if (first) first.focus();
    document.documentElement.classList.add('modal-open');
    const onCancel = (e) => {
      e.preventDefault();
      onCloseRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('cancel', onCancel);
      document.documentElement.classList.remove('modal-open');
      if (d.open) d.close();
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className={`a-drawer${variant ? ` a-drawer--${variant}` : ''}`} aria-labelledby={titleId}
      onMouseDown={(e) => { if (e.target === ref.current) onCloseRef.current(); }}>
      <div className="a-drawer__in">
        <header className="a-drawer__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p className="a-muted">{subtitle}</p>}
          </div>
          <button type="button" className="a-icon-btn" aria-label="Хаах" onClick={() => onCloseRef.current()}>
            <Icon name="close" />
          </button>
        </header>
        <div className="a-drawer__body">{children}</div>
        {footer && <footer className="a-drawer__foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/* ---------- Loading placeholders and empty states ---------- */
export function Skeleton({ rows = 4, card = false }) {
  return (
    <div className={`a-skel${card ? ' a-skel--card' : ''}`} aria-busy="true" aria-label="Ачаалж байна">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ width: `${92 - ((i * 17) % 40)}%` }} />)}
    </div>
  );
}

export function Empty({ icon = 'inbox', title, text, action }) {
  return (
    <div className="a-empty-state">
      <span className="a-empty-state__icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      {text && <p className="a-muted">{text}</p>}
      {action}
    </div>
  );
}

/* ---------- Theme: follow the device, or pin light / dark (kept on this device) ---------- */
const THEME_KEY = 'domch_admin_theme';
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  }, [theme]);
  const next = useMemo(() => ({ system: 'light', light: 'dark', dark: 'system' }[theme]), [theme]);
  return { theme, cycle: () => setTheme(next) };
}
export const THEME_LABEL = { system: 'Төхөөрөмжийн өнгө', light: 'Цайвар', dark: 'Бараан' };
export const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };

/* ---------- Initials avatar ---------- */
export function Avatar({ name, size = 36 }) {
  const text = String(name || '?').trim();
  // initials from words that start with a letter ("Хэрэглэгч …1279" → "Х", "Янжмаа А." → "ЯА")
  const words = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const named = words.filter((w) => /^\p{L}/u.test(w));
  const letters = (named.length ? named : words).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return (
    <span className="a-avatar" style={{ width: size, height: size, '--h': h }} aria-hidden="true">{letters}</span>
  );
}
