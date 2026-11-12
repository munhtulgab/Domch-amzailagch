import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { CITIES } from '../data/static.js';
import { formatDate } from '../lib/util.js';
import { MessengerInbox, MessengerSettings } from './Messenger.jsx';
import { AiSettings } from './Ai.jsx';
import { NotifySettings, enablePush, isStandalone, useAdminApp, useAppBadge, usePushState } from './Notify.jsx';
import { Avatar, Drawer, Empty, Icon, Skeleton, THEME_ICON, THEME_LABEL, ToastProvider, useTheme, useToast } from './ui.jsx';
import './admin.css';

const KEY = 'domch_admin_token';

const TABS = [
  { id: 'overview', label: 'Тойм', icon: 'home', group: 'main', sub: '' },
  { id: 'messenger', label: 'Messenger, Instagram', short: 'Чат', icon: 'chat', group: 'inbox', count: 'messenger_unread',
    sub: 'Facebook Page болон Instagram-аас ирсэн мессеж. AI туслах хариулж, та хүссэн үедээ орж хариулна.' },
  { id: 'partners', label: 'Хамтын ажиллагаа', icon: 'handshake', group: 'inbox', inbox: true, count: 'partners_new',
    sub: 'Эмийн сан, эмнэлэг, байгууллага, контент бүтээгчдийн хүсэлт. Утасны дугаартай хүсэлт л энд гарна.' },
  { id: 'questions', label: 'Эмчээс асуусан', icon: 'question', group: 'inbox', inbox: true, count: 'questions_new',
    sub: 'Сайтаас эмчид илгээсэн асуултууд.' },
  { id: 'reviews', label: 'Сэтгэгдэл', icon: 'star', group: 'inbox', inbox: true, count: 'reviews_pending',
    sub: 'Сэтгэгдэл таныг нийтлэх хүртэл сайтад харагдахгүй.' },
  { id: 'locations', label: 'Байршлын санал', icon: 'pin', group: 'inbox', inbox: true, count: 'locations_new',
    sub: 'Хэрэглэгчдийн «энд зарж эхлээч» гэж санал болгосон газрууд.' },
  { id: 'branches', label: 'Салбарууд', icon: 'store', group: 'content', table: true,
    sub: 'Сайтын газрын зураг болон AI туслахын «хаанаас авах вэ» хариултад орно.' },
  { id: 'products', label: 'Бүтээгдэхүүн, үнэ', icon: 'tag', group: 'content', table: true, sub: 'Савлагаа, үнэ, онлайн дэлгүүрийн холбоос.' },
  { id: 'tips', label: 'Эмчийн зөвлөгөө', icon: 'doctor', group: 'content', table: true, sub: 'Зөвлөгөө, 1 минутын видео, «Үнэн үү, ташаа юу?».' },
  { id: 'knowledge', label: 'Мэдлэгийн сан', icon: 'book', group: 'content', table: true,
    sub: 'Messenger-ийн AI зөвхөн эндхийн баталгаатай мэдээллээр хариулна.' },
  { id: 'videos', label: 'Видео', icon: 'video', group: 'content', table: true, sub: 'Контент бүтээгчид болон «Манай гэрийн Домч» бичлэгүүд.' },
  { id: 'faqs', label: 'Түгээмэл асуулт', icon: 'help', group: 'content', table: true, sub: 'Сайтын асуулт, хариултын хэсэг.' },
  { id: 'settings', label: 'Тохиргоо', icon: 'gear', group: 'system', sub: 'Холбоо барих мэдээлэл, Messenger, Instagram, AI туслах, мэдэгдэл, нэвтрэх нууц үг.' },
];
const TAB = Object.fromEntries(TABS.map((t) => [t.id, t]));
const GROUPS = [['main', ''], ['inbox', 'Ирсэн'], ['content', 'Агуулга'], ['system', 'Систем']];

const STATUS_LABEL = {
  pending: 'Хүлээгдэж буй', approved: 'Нийтэлсэн', rejected: 'Татгалзсан', new: 'Шинэ', answered: 'Хариулсан',
  archived: 'Архив', contacted: 'Холбогдсон', closed: 'Хаасан', done: 'Шийдсэн',
};
const KIND_LABEL = { pharmacy: 'Эмийн сан, борлуулагч', clinic: 'Шүдний эмнэлэг', corporate: 'Байгууллагын захиалга', creator: 'Контент бүтээгч' };
const DETAIL_LABEL = { direction: 'Хамтрах чиглэл', size: 'Савлагаа', quantity: 'Тоо хэмжээ', timeline: 'Хугацаа', social: 'Сошиал', focus: 'Контентын чиглэл' };
const EVENT_LABEL = {
  where_click: '«Хаанаас авах вэ?» дарсан', branch_search: 'Салбар хайсан', online_click: 'Онлайн дэлгүүр рүү орсон',
  direction_click: 'Зам заалгасан', call_click: 'Салбар руу залгасан', usage_view: 'Хэрэглэх заавар үзсэн',
  video_play: 'Видео тоглуулсан', partner_submit: 'Хамтын ажиллагааны хүсэлт', review_submit: 'Сэтгэгдэл илгээсэн',
  question_submit: 'Эмчээс асуусан', location_request: 'Байршлын санал', search: 'Хайлт хийсэн', size_select: 'Савлагаа сонгосон',
  messenger_click: 'Messenger товч дарсан',
};

const KNOWLEDGE_TOPICS = [['product', 'Бүтээгдэхүүн'], ['ingredients', 'Орц найрлага'], ['usage', 'Хэрэглээ'],
  ['buy', 'Худалдан авах'], ['health', 'Эрүүл мэнд'], ['company', 'Компани, хамтын ажиллагаа'], ['general', 'Бусад']];
const TOPIC_LABEL = Object.fromEntries(KNOWLEDGE_TOPICS);
const ACTIVE = { k: 'active', l: 'Сайтад харуулах', type: 'checkbox', def: true };
const SORT = { k: 'sort', l: 'Эрэмбэ', type: 'number', hint: 'Бага тоо түрүүлж харагдана.' };
const SCHEMAS = {
  branches: {
    title: 'Салбарууд',
    titleKey: 'name',
    filters: ['chain', 'city'],
    cols: [['chain', 'Сүлжээ'], ['name', 'Салбар'], ['city', 'Хот, аймаг'], ['district', 'Дүүрэг'], ['phone', 'Утас']],
    fields: [
      { k: 'chain', l: 'Сүлжээний нэр', req: true },
      { k: 'name', l: 'Салбарын нэр', req: true },
      { k: 'city', l: 'Хот, аймаг', req: true, type: 'select', options: CITIES.map((c) => [c, c]), def: CITIES[0] },
      { k: 'district', l: 'Дүүрэг, сум' },
      { k: 'address', l: 'Дэлгэрэнгүй хаяг', type: 'textarea' },
      { k: 'lat', l: 'Өргөрөг (lat)', type: 'number', step: 'any', hint: 'Google Maps дээр цэг дээр дарж хуулна. Жишээ: 47.9186' },
      { k: 'lng', l: 'Уртраг (lng)', type: 'number', step: 'any', hint: 'Жишээ: 106.9177' },
      { k: 'phone', l: 'Утас' },
      { k: 'hours', l: 'Цагийн хуваарь', hint: 'Жишээ: 09:00–21:00' },
      { k: 'sizes', l: 'Худалдаалдаг савлагаа', hint: 'Таслалаар: 250,500' },
      { k: 'online_url', l: 'Онлайн дэлгүүрийн холбоос', type: 'url' },
      { k: 'verified_at', l: 'Мэдээллийг шалгасан огноо', type: 'date' },
      ACTIVE,
    ],
  },
  products: {
    title: 'Бүтээгдэхүүн, үнэ',
    titleKey: 'name',
    cols: [['volume_ml', 'Хэмжээ'], ['price', 'Үнэ'], ['online_url', 'Онлайн холбоос']],
    fields: [
      { k: 'slug', l: 'Код', req: true, hint: 'small эсвэл big' },
      { k: 'name', l: 'Нэр', req: true },
      { k: 'volume_ml', l: 'Хэмжээ (мл)', type: 'number', req: true },
      { k: 'price', l: 'Үнэ (₮)', type: 'number', hint: 'Хоосон үлдээвэл «Үнийг салбараас лавлана уу» гэж харагдана.' },
      { k: 'online_url', l: 'Онлайн дэлгүүрийн холбоос', type: 'url' },
      SORT,
      ACTIVE,
    ],
  },
  tips: {
    title: 'Эмчийн зөвлөгөө',
    titleKey: 'title',
    cols: [['title', 'Гарчиг'], ['doctor_name', 'Эмч'], ['kind', 'Төрөл'], ['featured', 'Онцлох']],
    fields: [
      { k: 'kind', l: 'Төрөл', type: 'select', options: [['advice', 'Эмчийн зөвлөгөө'], ['minute', '1 минутын зөвлөгөө'], ['myth', 'Үнэн үү, ташаа юу?']], def: 'advice' },
      { k: 'title', l: 'Гарчиг', req: true },
      { k: 'summary', l: 'Товч хураангуй', type: 'textarea' },
      { k: 'body', l: 'Дэлгэрэнгүй текст', type: 'textarea', rows: 7, hint: 'Догол мөрийг хоосон мөрөөр тусгаарлана.' },
      { k: 'doctor_name', l: 'Эмчийн нэр' },
      { k: 'doctor_title', l: 'Мэргэжил' },
      { k: 'video_url', l: 'Видео холбоос', type: 'url', hint: 'YouTube эсвэл Facebook видео/reel холбоос. Сайт дээр шууд тоглоно.' },
      { k: 'image_url', l: 'Нүүр зураг', type: 'image', hint: 'Видеоны нүүр эсвэл зөвлөгөөний зураг. Хоосон бол YouTube-ийн зураг гарна.' },
      { k: 'source', l: 'Эх сурвалж' },
      { k: 'published_at', l: 'Нийтэлсэн огноо', type: 'date' },
      { k: 'featured', l: 'Онцлох зөвлөгөө (том хэмжээгээр)', type: 'checkbox' },
      SORT,
      ACTIVE,
    ],
  },
  videos: {
    title: 'Видео',
    titleKey: 'title',
    cols: [['title', 'Гарчиг'], ['author', 'Нэр'], ['topic', 'Сэдэв'], ['kind', 'Төрөл']],
    fields: [
      { k: 'kind', l: 'Төрөл', type: 'select', options: [['creator', 'Контент бүтээгч'], ['family', 'Манай гэрийн Домч']], def: 'creator' },
      { k: 'title', l: 'Гарчиг', req: true },
      { k: 'author', l: 'Бүтээгч, гэр бүлийн нэр' },
      { k: 'topic', l: 'Сэдэв' },
      { k: 'video_url', l: 'Видео холбоос', type: 'url', hint: 'YouTube эсвэл Facebook видео/reel холбоос (жишээ: facebook.com/reel/…).' },
      { k: 'image_url', l: 'Нүүр зураг', type: 'image', hint: 'Сонговол сайт дээр энэ зураг гарч, дарахад видео тоглоно.' },
      { k: 'sponsored', l: 'Хамтарсан контент (тэмдэглэгээ харагдана)', type: 'checkbox', def: true },
      SORT,
      ACTIVE,
    ],
  },
  knowledge: {
    title: 'Мэдлэгийн сан',
    titleKey: 'title',
    filters: ['topic'],
    cols: [['title', 'Гарчиг'], ['topic', 'Ангилал'], ['updated_at', 'Шинэчилсэн']],
    fields: [
      { k: 'topic', l: 'Ангилал', type: 'select', options: KNOWLEDGE_TOPICS, def: 'general' },
      { k: 'title', l: 'Гарчиг (асуулт эсвэл сэдэв)', req: true, hint: 'Жишээ: Жирэмсэн үед хэрэглэж болох уу?' },
      { k: 'body', l: 'Мэдээлэл', type: 'textarea', rows: 8, req: true,
        hint: 'Messenger-ийн AI зөвхөн энд бичсэн баталгаатай мэдээллээр хариулна. Тодорхой, бүтэн өгүүлбэрээр бичнэ үү.' },
      { k: 'keywords', l: 'Түлхүүр үгс', hint: 'Таслалаар. Хүмүүс өөрөөр асуухад тохирох хариултыг олоход тусална.' },
      SORT,
      { k: 'active', l: 'AI хариултад ашиглах', type: 'checkbox', def: true },
    ],
  },
  faqs: {
    title: 'Түгээмэл асуулт',
    titleKey: 'question',
    cols: [['question', 'Асуулт'], ['sort', 'Эрэмбэ']],
    fields: [
      { k: 'question', l: 'Асуулт', req: true },
      { k: 'answer', l: 'Хариулт', type: 'textarea', req: true },
      SORT,
      ACTIVE,
    ],
  },
};
const FILTER_LABEL = { chain: 'Бүх сүлжээ', city: 'Бүх хот, аймаг', topic: 'Бүх ангилал' };

const SETTING_FIELDS = [
  ['phone', 'Утас'], ['email', 'И-мэйл'], ['address', 'Хаяг'], ['online_store', 'Онлайн дэлгүүрийн холбоос'],
  ['facebook', 'Facebook холбоос'], ['instagram', 'Instagram холбоос'], ['youtube', 'YouTube холбоос'],
];

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function useAdminApi(token, onUnauthorized) {
  return useCallback(async (path, opts = {}) => {
    try {
      return await api(`/admin${path}`, { ...opts, token });
    } catch (err) {
      if (err.status === 401) onUnauthorized();
      throw err;
    }
  }, [token, onUnauthorized]);
}

/* Two-step delete: the first press arms the button for 4 seconds. */
function Confirm({ label, onConfirm, danger = true, icon = 'trash', compact = false }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  if (armed) {
    return (
      <button type="button" className={`a-btn a-btn--sm${danger ? ' a-btn--danger' : ''}`}
        onClick={(e) => { e.stopPropagation(); setArmed(false); onConfirm(); }}>
        Тийм, {label.toLowerCase()}
      </button>
    );
  }
  return compact ? (
    <button type="button" className="a-icon-btn" aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); setArmed(true); }}>
      <Icon name={icon} />
    </button>
  ) : (
    <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={(e) => { e.stopPropagation(); setArmed(true); }}>
      <Icon name={icon} size={16} />{label}
    </button>
  );
}

function download(name, rows) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `domch-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set()));
  const esc = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

function SearchBox({ value, onChange, placeholder = 'Хайх…', label = 'Хайх', autoFocus = false }) {
  return (
    <label className="a-search">
      <Icon name="search" size={17} />
      <span className="sr">{label}</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-autofocus={autoFocus ? '' : undefined} />
    </label>
  );
}

/* ---------------- Login ---------------- */
function Login({ onDone, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } });
      onDone(res);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="a-login">
      <form onSubmit={submit} className="a-login__card">
        <img className="a-logo a-logo--hero" src="/icons/icon-192.png" alt="DOMCH — жамц давсны уусмал" width="96" height="96" />
        <h1>Удирдлагын хэсэг</h1>
        <p className="a-muted">Сайт, Messenger, AI туслахаа нэг дороос удирдана.</p>
        {notice && <p className="a-note" role="status">{notice}</p>}
        <label htmlFor="a-user">Нэвтрэх нэр</label>
        <div className="a-login__field">
          <input id="a-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
            autoCapitalize="none" spellCheck={false} required autoFocus />
        </div>
        <label htmlFor="a-token">Нууц үг</label>
        <div className="a-login__field">
          <input id="a-token" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required />
          <button type="button" className="a-icon-btn" onClick={() => setShow(!show)} aria-pressed={show}
            aria-label={show ? 'Нууц үгийг нуух' : 'Нууц үгийг харах'}>
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
        {error && <p className="a-error" role="alert">{error}</p>}
        <button className="a-btn a-btn--lg" type="submit" disabled={busy || !username.trim() || !password}>
          {busy ? 'Шалгаж байна…' : <>Нэвтрэх <Icon name="arrowRight" size={17} /></>}
        </button>
        <a className="a-link" href="/">← Сайт руу буцах</a>
      </form>
    </div>
  );
}

/* ---------------- Overview ---------------- */
function lastDays(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => (
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (n - 1 - i))).toISOString().slice(0, 10)
  ));
}

function niceMax(v) {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** 30 columns, one per UTC day (empty days included, so gaps are visible). */
function DailyChart({ days }) {
  const [active, setActive] = useState(null);
  const top = niceMax(Math.max(...days.map((d) => d.count)));
  const cur = active == null ? null : days[active];
  const onKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive((i) => {
      const next = i == null ? days.length - 1 : i + (e.key === 'ArrowRight' ? 1 : -1);
      return Math.min(days.length - 1, Math.max(0, next));
    });
  };
  return (
    <figure className="a-chart">
      <div className="a-chart__plot">
        <div className="a-chart__y" aria-hidden="true"><span>{fmt(top)}</span><span>{fmt(top / 2)}</span><span>0</span></div>
        <div
          className="a-chart__bars"
          tabIndex={0}
          role="group"
          aria-label="Өдөр тутмын үйлдлийн тоо. Сумны товчоор өдөр сонгоно."
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {days.map((d, i) => (
            <span key={d.day} className={`a-chart__slot${active === i ? ' is-on' : ''}`} onPointerEnter={() => setActive(i)}>
              {d.count > 0 && <i style={{ height: `${(d.count / top) * 100}%` }} />}
            </span>
          ))}
          {cur && (
            <span
              className={`a-chart__tip${active > days.length - 5 ? ' is-end' : active < 4 ? ' is-start' : ''}`}
              style={{ left: `${((active + 0.5) / days.length) * 100}%` }}
              role="status"
            >
              <strong>{fmt(cur.count)}</strong>
              <span>{formatDate(cur.day)}</span>
            </span>
          )}
        </div>
        <span aria-hidden="true" />
        <div className="a-chart__x" aria-hidden="true">
          <span>{formatDate(days[0].day)}</span>
          <span>{formatDate(days[days.length - 1].day)}</span>
        </div>
      </div>
      <details className="a-chart__table">
        <summary>Хүснэгтээр харах</summary>
        <table className="a-table">
          <thead><tr><th>Өдөр</th><th className="num">Үйлдэл</th></tr></thead>
          <tbody>
            {days.slice().reverse().map((d) => (
              <tr key={d.day}><td>{formatDate(d.day)}</td><td className="num">{d.count}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function Trend({ now, prev, against }) {
  if (!now && !prev) return <span className="a-trend">Өгөгдөл алга</span>;
  if (!prev) return <span className="a-trend is-up"><Icon name="up" size={14} />шинэ · {against}</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return (
    <span className={`a-trend is-${dir}`}>
      {dir !== 'flat' && <Icon name={dir} size={14} />}
      {dir === 'flat' ? 'Өөрчлөлтгүй' : `${Math.abs(pct)}%`} · {against}
    </span>
  );
}

function Spark({ values }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 36;
  const step = w / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`);
  return (
    <svg className="a-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,${h} ${pts.join(' ')} ${w},${h}`} className="a-spark__area" />
      <polyline points={pts.join(' ')} className="a-spark__line" />
    </svg>
  );
}

const TOPIC_ICON = {
  partner: 'handshake', price: 'tag', where: 'pin', order: 'inbox', delivery: 'send', usage: 'book', ingredients: 'layers',
  health: 'doctor', stock: 'question', info: 'help', other: 'chat',
};

function timeAgo(value) {
  const d = new Date(String(value || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'дөнгөж сая';
  if (min < 60) return `${min} мин өмнө`;
  if (min < 24 * 60) return `${Math.round(min / 60)} цагийн өмнө`;
  return formatDate(value);
}

/** What people ask on Messenger and Instagram, grouped by topic (last 30 days). */
function ChatInsights({ call }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState('');
  useEffect(() => {
    call('/messenger/insights').then(setData).catch((err) => setError(err.message));
  }, [call]);
  const topics = data ? data.topics.filter((t) => !['greeting', 'media'].includes(t.key)) : [];
  const max = Math.max(1, ...topics.map((t) => t.people));
  return (
    <section className="a-panel a-chatq" aria-labelledby="ov-chatq">
      <header className="a-panel__head">
        <h2 id="ov-chatq">Messenger, Instagram-аар юу асууж байна</h2>
        {data && (
          <span className="a-muted">
            30 хоног · {fmt(data.people)} хүн · {fmt(data.messages)} мессеж
          </span>
        )}
      </header>
      {error ? <p className="a-error">{error}</p> : !data ? <Skeleton rows={6} /> : data.messages === 0 ? (
        <Empty icon="chat" title="Сүүлийн 30 хоногт мессеж ирээгүй" />
      ) : (
        <div className="a-chatq__grid">
          <div>
            <p className="a-chatq__channels">
              <span className="a-channel a-channel--fb">FB</span> Messenger {fmt(data.channels.messenger || 0)} хүн
              <span className="a-channel a-channel--ig">IG</span> Instagram {fmt(data.channels.instagram || 0)} хүн
            </p>
            {data.partners_added > 0 && (
              <a className="a-alert a-alert--info a-chatq__new" href="#/partners">
                <Icon name="handshake" />
                <p><strong>Чатаас утасны дугаартай {data.partners_added} хамтын ажиллагааны хүсэлт нэмэгдлээ.</strong> Хамтын ажиллагаа хэсэгт харах</p>
              </a>
            )}
            <ol className="a-topics">
              {topics.map((t) => (
                <li key={t.key}>
                  <button type="button" aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? '' : t.key)}>
                    <span className="a-topics__icon"><Icon name={TOPIC_ICON[t.key] || 'chat'} size={16} /></span>
                    <span className="a-topics__label">{t.label}</span>
                    <span className="a-bars__track"><i style={{ width: `${(t.people / max) * 100}%` }} /></span>
                    <span className="a-bars__n">{fmt(t.people)} <small>хүн</small></span>
                  </button>
                  {open === t.key && (
                    <ul className="a-topics__ex">
                      {t.examples.map((x) => <li key={x}>«{x}»</li>)}
                      {t.key === 'partner' && <li><a href="#/partners">Хамтын ажиллагааны хүсэлтүүдийг харах →</a></li>}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="a-chatq__side">
            <h3>Олон давтагдсан асуулт</h3>
            <ol className="a-topq">
              {data.top_questions.slice(0, 8).map((q) => (
                <li key={q.text}><span>{q.text}</span><b>{fmt(q.people)} хүн</b></li>
              ))}
            </ol>
            <h3>Сүүлд ирсэн асуултууд</h3>
            <ul className="a-recentq">
              {data.recent.slice(0, 8).map((r) => (
                <li key={`${r.psid}-${r.at}`}>
                  <a href={`#/messenger/${encodeURIComponent(r.psid)}`}>
                    <span className="a-recentq__text">{r.text}</span>
                    <span className="a-muted">
                      {r.channel === 'instagram' ? 'IG' : 'FB'} · {r.name || `Хэрэглэгч …${String(r.psid).slice(-4)}`} · {timeAgo(r.at)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

const TODO = [
  ['messenger', 'messenger_unread', 'уншаагүй мессеж', 'Хариулах'],
  ['reviews', 'reviews_pending', 'сэтгэгдэл нийтлэхийг хүлээж байна', 'Шалгах'],
  ['questions', 'questions_new', 'эмчид ирсэн шинэ асуулт', 'Хариулах'],
  ['partners', 'partners_new', 'хамтын ажиллагааны шинэ хүсэлт', 'Холбогдох'],
  ['locations', 'locations_new', 'байршлын шинэ санал', 'Үзэх'],
];

function Overview({ call, summary, reload, go }) {
  const toast = useToast();
  const counts = (summary && summary.counts) || {};
  const ready = Boolean(summary && summary.full);
  const days = useMemo(() => {
    const map = new Map(((summary && summary.daily) || []).map((d) => [d.day, d.count]));
    return lastDays(30).map((day) => ({ day, count: map.get(day) || 0 }));
  }, [summary]);
  const series = days.map((d) => d.count);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const last7 = sum(series.slice(-7));
  const prev7 = sum(series.slice(-14, -7));
  const events = (summary && summary.events) || [];
  const topEvent = events[0];
  const maxEvent = Math.max(1, ...events.map((e) => e.count));
  const todo = TODO.filter(([, key]) => counts[key] > 0);

  const clear = async () => {
    try {
      const res = await call('/clear-samples', { method: 'POST', body: {} });
      toast(`${res.deleted} жишээ мөр устгалаа.`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="a-ov">
      <section className="a-kpis" aria-label="Гол үзүүлэлт">
        <div className="a-kpi a-kpi--hero">
          <span className="a-kpi__label">Сүүлийн 7 хоног</span>
          {ready ? <strong className="a-kpi__n">{fmt(last7)}</strong> : <Skeleton rows={1} />}
          <span className="a-kpi__sub">сайт дээрх үйлдэл</span>
          {ready && <Trend now={last7} prev={prev7} against="өмнөх 7 хоногоос" />}
          {ready && <Spark values={series.slice(-14)} />}
        </div>
        <div className="a-kpi">
          <span className="a-kpi__label">Өнөөдөр</span>
          {ready ? <strong className="a-kpi__n">{fmt(series[29])}</strong> : <Skeleton rows={1} />}
          <span className="a-kpi__sub">үйлдэл</span>
          {ready && <Trend now={series[29]} prev={series[28]} against="өчигдрөөс" />}
        </div>
        <div className="a-kpi">
          <span className="a-kpi__label">30 хоног</span>
          {ready ? <strong className="a-kpi__n">{fmt(sum(series))}</strong> : <Skeleton rows={1} />}
          <span className="a-kpi__sub">нийт үйлдэл</span>
        </div>
        <div className="a-kpi">
          <span className="a-kpi__label">Хамгийн их хийсэн</span>
          {ready ? (
            topEvent ? <strong className="a-kpi__n a-kpi__n--text">{EVENT_LABEL[topEvent.name] || topEvent.name}</strong> : <strong className="a-kpi__n">—</strong>
          ) : <Skeleton rows={1} />}
          <span className="a-kpi__sub">{topEvent ? `${fmt(topEvent.count)} удаа, 30 хоногт` : 'бүртгэл алга'}</span>
        </div>
      </section>

      <section className="a-panel a-todo" aria-labelledby="ov-todo">
        <header className="a-panel__head">
          <h2 id="ov-todo">Танд хийх зүйл</h2>
          {todo.length > 0 && <span className="a-badge">{sum(todo.map(([, k]) => counts[k]))}</span>}
        </header>
        {!summary ? <Skeleton rows={3} /> : todo.length === 0 ? (
          <Empty icon="check" title="Бүх зүйл шийдэгдсэн" text="Шинэ мессеж, хүсэлт ирвэл энд гарна." />
        ) : (
          <ul className="a-todo__list">
            {todo.map(([tab, key, text, action]) => (
              <li key={tab}>
                <button type="button" onClick={() => go(tab)}>
                  <span className="a-todo__icon"><Icon name={TAB[tab].icon} /></span>
                  <span className="a-todo__text"><b>{counts[key]}</b> {text}</span>
                  <span className="a-todo__go">{action}<Icon name="arrowRight" size={15} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {counts.samples > 0 && (
          <div className="a-alert">
            <Icon name="bolt" />
            <p><strong>{counts.samples} жишээ мөр</strong> (салбар, зөвлөгөө, видео) сайтад «Жишээ» тэмдэгтэй харагдаж байна. Бодит мэдээллээ оруулаад жишээг устгана уу.</p>
            <Confirm label="Жишээг устгах" onConfirm={clear} />
          </div>
        )}
      </section>

      <section className="a-panel a-events" aria-labelledby="ov-events">
        <header className="a-panel__head">
          <h2 id="ov-events">Хүмүүс сайт дээр юу хийсэн бэ</h2>
          <span className="a-muted">30 хоног</span>
        </header>
        {!ready ? <Skeleton rows={5} /> : events.length === 0 ? (
          <Empty icon="spark" title="Одоогоор бүртгэгдсэн үйлдэл алга" />
        ) : (
          <ol className="a-bars">
            {events.map((e) => (
              <li key={e.name}>
                <span className="a-bars__label">{EVENT_LABEL[e.name] || e.name}</span>
                <span className="a-bars__track"><i style={{ width: `${(e.count / maxEvent) * 100}%` }} /></span>
                <span className="a-bars__n">{fmt(e.count)}{e.people > 0 && <small>{fmt(e.people)} хүн</small>}</span>
              </li>
            ))}
          </ol>
        )}
        {ready && events.length > 0 && (
          <p className="a-hint a-bars__hint">Тоо: дарсан удаа. «хүн»: нэг хүн өдөрт олон дарсан ч нэг гэж тоолно (2026.11.12-ноос хойш бүртгэж эхэлсэн).</p>
        )}
      </section>

      <ChatInsights call={call} />

      <section className="a-panel a-daily" aria-labelledby="ov-daily">
        <header className="a-panel__head">
          <h2 id="ov-daily">Өдөр тутмын үйлдэл</h2>
          <span className="a-muted">Сүүлийн 30 хоног · нийт {fmt(sum(series))}</span>
        </header>
        {ready ? <DailyChart days={days} /> : <Skeleton rows={4} card />}
        <p className="a-hint">Онлайн дэлгүүрийн борлуулалттай холбогдоогүй тул холбоосын даралтыг борлуулалт гэж тооцохгүй.
          {' '}Өгөгдлийн сан: {summary ? (summary.driver === 'd1' ? 'Cloudflare D1' : 'Локал SQLite') : '…'}.</p>
      </section>
    </div>
  );
}

/* ---------------- Inbox (form submissions): list + detail ---------------- */
function inboxTitle(kind, r) {
  if (kind === 'partners') return r.org || r.contact_name || 'Нэргүй байгууллага';
  if (kind === 'locations') return [r.city, r.district].filter(Boolean).join(', ') || 'Байршил';
  return r.name || 'Нэргүй';
}
function inboxSnippet(kind, r) {
  if (kind === 'reviews') return r.body;
  if (kind === 'questions') return r.question;
  if (kind === 'partners') return [SOURCE_LABEL[r.source], KIND_LABEL[r.kind] || r.kind, r.message].filter(Boolean).join(' · ');
  return r.note;
}
const SOURCE_LABEL = { messenger: 'Messenger чатаас', instagram: 'Instagram чатаас' };

function contactLinks(r) {
  const out = [];
  const phone = r.phone || (/\d[\d\s-]{5,}/.test(r.contact || '') && !/@/.test(r.contact || '') ? r.contact : '');
  const email = r.email || (/@/.test(r.contact || '') ? r.contact : '');
  if (phone) out.push(['phone', `Залгах: ${phone}`, `tel:${String(phone).replace(/[^\d+]/g, '')}`]);
  if (email) out.push(['mail', 'И-мэйл бичих', `mailto:${email}`]);
  if (r.source_ref && /^(messenger|instagram):/.test(r.source_ref)) {
    out.push(['chat', 'Чатыг нээх', `#/messenger/${encodeURIComponent(r.source_ref.split(':').slice(1).join(':'))}`]);
  }
  return out;
}

function Inbox({ kind, call, onChange }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [error, setError] = useState('');
  const wide = useRef(typeof window !== 'undefined' && window.matchMedia('(min-width: 861px)').matches);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await call(`/inbox/${kind}`);
      setData(res);
      setSel((cur) => cur ?? (wide.current && res.items[0] ? res.items[0].id : null));
    } catch (err) {
      setError(err.message);
    }
  }, [call, kind]);
  useEffect(() => { load(); }, [load]);

  const items = (data && data.items) || [];
  const statuses = (data && data.statuses) || [];
  const byStatus = useMemo(() => items.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}), [items]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((r) => (!status || r.status === status)
      && (!needle || JSON.stringify(r).toLowerCase().includes(needle)));
  }, [items, status, q]);
  const current = items.find((r) => r.id === sel);

  const patch = async (id, next) => {
    const before = items;
    setData((d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, status: next } : r)) }));
    try {
      await call(`/inbox/${kind}/${id}`, { method: 'PATCH', body: { status: next } });
      toast(kind === 'reviews' && next === 'approved' ? 'Сэтгэгдэл сайтад нийтлэгдлээ.' : `Төлөв: ${STATUS_LABEL[next] || next}`);
      onChange();
    } catch (err) {
      setData((d) => ({ ...d, items: before }));
      toast(err.message, 'error');
    }
  };
  const savePhone = async (id, phone) => {
    await call(`/inbox/${kind}/${id}`, { method: 'PATCH', body: { phone } });
    const shown = phone.replace(/\D/g, '').length === 8 && !phone.trim().startsWith('+')
      ? `${phone.replace(/\D/g, '').slice(0, 4)}-${phone.replace(/\D/g, '').slice(4)}` : phone.trim();
    setData((d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, phone: shown || null } : r)) }));
    toast(`Утасны дугаар хадгаллаа: ${shown}`);
  };
  const remove = async (id) => {
    try {
      await call(`/inbox/${kind}/${id}`, { method: 'DELETE' });
      setData((d) => ({ ...d, items: d.items.filter((r) => r.id !== id) }));
      setSel(null);
      toast('Устгалаа.');
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (error && !data) return <p className="a-error" role="alert">{error}</p>;
  return (
    <div className={`a-split${current ? ' has-sel' : ''}`}>
      <section className="a-split__list" aria-label="Жагсаалт">
        <div className="a-split__tools">
          <SearchBox value={q} onChange={setQ} />
          <button type="button" className="a-icon-btn" onClick={load} aria-label="Шинэчлэх" title="Шинэчлэх"><Icon name="refresh" /></button>
          <button type="button" className="a-icon-btn" onClick={() => download(kind, shown)} disabled={!shown.length}
            aria-label="CSV татах" title="CSV татах"><Icon name="download" /></button>
        </div>
        <div className="a-chips" role="group" aria-label="Төлөвөөр шүүх">
          <button type="button" aria-pressed={!status} onClick={() => setStatus('')}>Бүгд <span>{items.length}</span></button>
          {statuses.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s] || s} <span>{byStatus[s] || 0}</span>
            </button>
          ))}
        </div>
        {!data ? <Skeleton rows={6} /> : shown.length === 0 ? (
          <Empty icon="inbox" title={items.length ? 'Тохирох зүйл олдсонгүй' : 'Одоогоор ирээгүй байна'}
            text={items.length ? 'Шүүлтүүр эсвэл хайлтаа өөрчилнө үү.' : 'Сайтаас илгээсэн хүсэлт энд гарна.'} />
        ) : (
          <ul className="a-mail">
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" aria-current={sel === r.id ? 'true' : undefined} onClick={() => setSel(r.id)}
                  className={r.status === 'new' || r.status === 'pending' ? 'is-unread' : ''}>
                  <Avatar name={inboxTitle(kind, r)} size={38} />
                  <span className="a-mail__main">
                    <span className="a-mail__top">
                      <strong>{inboxTitle(kind, r)}</strong>
                      <time>{formatDate(r.created_at)}</time>
                    </span>
                    {kind === 'reviews' && <span className="a-stars a-stars--sm" aria-label={`5-аас ${r.rating}`}>{'★'.repeat(r.rating)}<span>{'★'.repeat(5 - r.rating)}</span></span>}
                    <span className="a-mail__snip">{inboxSnippet(kind, r) || '—'}</span>
                    <span className="a-mail__pills">
                      <span className={`a-pill a-pill--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="a-split__detail" aria-label="Дэлгэрэнгүй" aria-live="polite">
        {!current ? (
          <Empty icon="inbox" title="Зүүн талаас сонгоно уу" text="Сонгосон хүсэлтийн дэлгэрэнгүй энд харагдана." />
        ) : (
          <article className="a-detail">
            <header className="a-detail__head">
              <button type="button" className="a-icon-btn a-back" onClick={() => setSel(null)} aria-label="Жагсаалт руу буцах"><Icon name="arrowLeft" /></button>
              <Avatar name={inboxTitle(kind, current)} size={44} />
              <div className="a-detail__who">
                <h2>{inboxTitle(kind, current)}</h2>
                <p className="a-muted">{formatDate(current.created_at)} · №{current.id}</p>
              </div>
              <span className={`a-pill a-pill--${current.status}`}>{STATUS_LABEL[current.status] || current.status}</span>
            </header>
            <div className="a-detail__body">
              <InboxBody kind={kind} r={current} />
              {kind === 'partners' && <PartnerPhone r={current} onSave={(phone) => savePhone(current.id, phone)} />}
            </div>
            {contactLinks(current).length > 0 && (
              <div className="a-detail__links">
                {contactLinks(current).map(([icon, label, href]) => (
                  <a key={href} className="a-btn a-btn--ghost a-btn--sm" href={href}><Icon name={icon} size={16} />{label}</a>
                ))}
              </div>
            )}
            <footer className="a-detail__foot">
              <div className="a-seg" role="group" aria-label="Төлөв өөрчлөх">
                {statuses.map((s) => (
                  <button key={s} type="button" aria-pressed={current.status === s} onClick={() => current.status !== s && patch(current.id, s)}>
                    {STATUS_LABEL[s] || s}
                  </button>
                ))}
              </div>
              <div className="a-detail__acts">
                {kind === 'reviews' && current.status !== 'approved' && (
                  <button type="button" className="a-btn a-btn--sm" onClick={() => patch(current.id, 'approved')}><Icon name="check" size={16} />Нийтлэх</button>
                )}
                <Confirm label="Устгах" onConfirm={() => remove(current.id)} />
              </div>
            </footer>
          </article>
        )}
      </section>
    </div>
  );
}

/** Partner requests are listed only with a phone; this lets the admin correct it. */
function PartnerPhone({ r, onSave }) {
  const [edit, setEdit] = useState(!r.phone);
  const [value, setValue] = useState(r.phone || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setEdit(!r.phone);
    setValue(r.phone || '');
    setError('');
  }, [r.id, r.phone]);
  if (!edit) {
    return <button type="button" className="a-link a-phonefix__edit" onClick={() => setEdit(true)}>Утасны дугаар засах</button>;
  }
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(value);
    } catch (err) {
      setError((err.fields && err.fields.phone) || err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`a-phonefix${r.phone ? '' : ' is-missing'}`} onSubmit={submit}>
      <div className="a-copy">
        <label className="sr" htmlFor={`pp-${r.id}`}>Утасны дугаар</label>
        <input id={`pp-${r.id}`} type="tel" inputMode="tel" autoComplete="off" placeholder="9911-2233" value={value}
          onChange={(e) => { setValue(e.target.value); setError(''); }} />
        <button type="submit" className="a-btn a-btn--sm" disabled={busy || value.trim() === (r.phone || '')}>Хадгалах</button>
        {r.phone && <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setEdit(false)}>Болих</button>}
      </div>
      {error && <p className="a-error">{error}</p>}
    </form>
  );
}

function Row({ label, value, href }) {
  if (!value) return null;
  return (
    <div className="a-kv"><dt>{label}</dt><dd>{href ? <a href={href}>{value}</a> : <span className="a-pre">{value}</span>}</dd></div>
  );
}

function InboxBody({ kind, r }) {
  if (kind === 'reviews') {
    return (
      <div>
        <p className="a-stars" aria-label={`5-аас ${r.rating}`}>{'★'.repeat(r.rating)}<span>{'★'.repeat(5 - r.rating)}</span></p>
        <dl>
          <Row label="Сэтгэгдэл" value={r.body} />
          <Row label="Нэр" value={r.name} />
          <Row label="Савлагаа" value={r.size && r.size !== 'unknown' ? `${r.size} мл` : ''} />
        </dl>
      </div>
    );
  }
  if (kind === 'questions') {
    return (
      <dl>
        <Row label="Асуулт" value={r.question} />
        <Row label="Нэр" value={r.name} />
        <Row label="Холбоо барих" value={r.contact} />
      </dl>
    );
  }
  if (kind === 'partners') {
    return (
      <dl>
        <Row label="Эх сурвалж" value={SOURCE_LABEL[r.source] || 'Сайтын маягт'} />
        <Row label="Төрөл" value={KIND_LABEL[r.kind] || r.kind} />
        <Row label="Байгууллага" value={r.org} />
        <Row label="Холбоо барих" value={r.contact_name} />
        <Row label="Утас" value={r.phone} href={r.phone ? `tel:${r.phone.replace(/\s/g, '')}` : ''} />
        <Row label="И-мэйл" value={r.email} href={r.email ? `mailto:${r.email}` : ''} />
        <Row label="Байршил" value={r.location} />
        {Object.entries(r.details || {}).filter(([k]) => k !== 'asked_phone').map(([k, v]) => <Row key={k} label={DETAIL_LABEL[k] || k} value={v} />)}
        <Row label="Мессеж" value={r.message} />
      </dl>
    );
  }
  return (
    <dl>
      <Row label="Байршил" value={[r.city, r.district].filter(Boolean).join(', ')} />
      <Row label="Санал" value={r.note} />
      <Row label="Холбоо барих" value={r.contact} />
    </dl>
  );
}

/* ---------------- Content tables ---------------- */
async function toWebp(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Зургийг уншиж чадсангүй.'));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
    const out = blob && blob.type === 'image/webp' ? blob : await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(out);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ImageField({ id, value, onChange, call, onError }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      onError('Зураг сонгоно уу.');
      return;
    }
    setBusy(true);
    try {
      const data = await toWebp(file);
      const res = await call('/media', { method: 'POST', body: { data } });
      onChange(res.url);
    } catch (err) {
      onError(err.fields?.file || err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-image">
      {value ? <img src={value} alt="" /> : <span className="a-image__empty">Зураг алга</span>}
      <div className="a-image__ctl">
        <label className="a-btn a-btn--ghost a-btn--sm a-image__pick">
          <input type="file" accept="image/*" onChange={pick} disabled={busy} />
          {busy ? 'Оруулж байна…' : value ? 'Зураг солих' : 'Зураг оруулах'}
        </label>
        {value && <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => onChange('')}>Хасах</button>}
        <input id={id} type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="эсвэл зургийн холбоос https://…" />
      </div>
    </div>
  );
}

function EditForm({ schema, row, onSave, onCancel, call, extra }) {
  const initial = {};
  schema.fields.forEach((f) => {
    const v = row ? row[f.k] : undefined;
    if (f.type === 'checkbox') initial[f.k] = row ? Boolean(v) : Boolean(f.def);
    else initial[f.k] = v == null ? (row ? '' : f.def ?? '') : String(v);
  });
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(values);
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form className="a-form" onSubmit={submit} noValidate>
      {schema.fields.map((f) => {
        const id = `ef-${f.k}`;
        const set = (val) => {
          setValues((s) => ({ ...s, [f.k]: val }));
          setErrors((s) => ({ ...s, [f.k]: undefined }));
          setError('');
        };
        return (
          <div key={f.k} className={`a-field${f.type === 'checkbox' ? ' a-field--check' : ''}${f.type === 'image' ? ' a-field--wide' : ''}${errors[f.k] ? ' has-error' : ''}`}>
            {f.type === 'checkbox' ? (
              <label htmlFor={id} className="a-switch-row">
                <span>{f.l}</span>
                <input id={id} type="checkbox" role="switch" className="a-switch" checked={values[f.k]} onChange={(e) => set(e.target.checked)} />
              </label>
            ) : (
              <>
                <label htmlFor={id}>{f.l}{f.req && <span className="req"> *</span>}</label>
                {f.type === 'image' ? (
                  <ImageField id={id} value={values[f.k]} onChange={set} call={call}
                    onError={(msg) => setErrors((s) => ({ ...s, [f.k]: msg }))} />
                ) : f.type === 'textarea' ? (
                  <textarea id={id} rows={f.rows || 3} value={values[f.k]} onChange={(e) => set(e.target.value)} />
                ) : f.type === 'select' ? (
                  <select id={id} value={values[f.k]} onChange={(e) => set(e.target.value)}>
                    {!f.req && !f.def && <option value="">—</option>}
                    {values[f.k] && !f.options.some(([v]) => v === values[f.k]) && <option value={values[f.k]}>{values[f.k]}</option>}
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <input id={id} type={f.type || 'text'} step={f.step} value={values[f.k]} onChange={(e) => set(e.target.value)} />
                )}
              </>
            )}
            {f.hint && !errors[f.k] && <p className="a-hint">{f.hint}</p>}
            {errors[f.k] && <p className="a-error">{errors[f.k]}</p>}
          </div>
        );
      })}
      {error && <p className="a-error" role="alert">{error}</p>}
      <div className="a-form__actions a-form__actions--sticky">
        <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Хадгалж байна…' : <><Icon name="check" size={16} />Хадгалах</>}</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={onCancel}>Болих</button>
        {extra && <span className="a-form__extra">{extra}</span>}
      </div>
    </form>
  );
}

const PAGE = 25;
const KIND_SHORT = { advice: 'Зөвлөгөө', minute: '1 минут', myth: 'Үнэн үү?', creator: 'Бүтээгч', family: 'Гэр бүл' };

function cellText(row, key) {
  const v = row[key];
  if (key === 'featured') return v ? 'Онцлох' : '';
  if (key === 'topic' && TOPIC_LABEL[v]) return TOPIC_LABEL[v];
  if (key === 'updated_at') return formatDate(v);
  if (key === 'kind') return KIND_SHORT[v] || v;
  if (key === 'price') return v == null || v === '' ? '—' : `${fmt(v)}₮`;
  if (key === 'volume_ml') return v == null ? '—' : `${v} мл`;
  if (key === 'online_url' && v) return String(v).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return v == null || v === '' ? '—' : String(v);
}

function compare(a, b) {
  const ea = a == null || a === '';
  const eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'mn', { numeric: true });
}

function TableView({ table, call }) {
  const schema = SCHEMAS[table];
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');
  const [vis, setVis] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ k: '', dir: 1 });
  const [limit, setLimit] = useState(PAGE);
  const activeLabel = (schema.fields.find((f) => f.k === 'active') || ACTIVE).l;

  const load = useCallback(async () => {
    setError('');
    try {
      setItems((await call(`/t/${table}`)).items);
    } catch (err) {
      setError(err.message);
    }
  }, [call, table]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLimit(PAGE); }, [q, vis, filters, sort]);

  const options = useMemo(() => Object.fromEntries((schema.filters || []).map((k) => [
    k, Array.from(new Set((items || []).map((r) => r[k]).filter(Boolean))).sort((a, b) => compare(a, b)),
  ])), [items, schema]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = (items || []).filter((r) => (!vis || Boolean(r.active) === (vis === 'on'))
      && Object.entries(filters).every(([k, v]) => !v || r[k] === v)
      && (!needle || Object.values(r).some((v) => (typeof v === 'string' || typeof v === 'number') && String(v).toLowerCase().includes(needle))));
    if (sort.k) list = [...list].sort((a, b) => compare(a[sort.k], b[sort.k]) * sort.dir);
    return list;
  }, [items, q, vis, filters, sort]);

  const save = async (values) => {
    const body = { ...values };
    if (editing && editing.id) await call(`/t/${table}/${editing.id}`, { method: 'PUT', body });
    else await call(`/t/${table}`, { method: 'POST', body });
    setEditing(null);
    toast(editing && editing.id ? 'Өөрчлөлтийг хадгаллаа.' : 'Шинэ мөр нэмлээ.');
    load();
  };
  const remove = async (id) => {
    try {
      await call(`/t/${table}/${id}`, { method: 'DELETE' });
      setItems((list) => list.filter((r) => r.id !== id));
      setEditing(null);
      toast('Устгалаа.');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const toggle = async (row) => {
    const next = !row.active;
    setItems((list) => list.map((r) => (r.id === row.id ? { ...r, active: next ? 1 : 0 } : r)));
    try {
      await call(`/t/${table}/${row.id}`, { method: 'PUT', body: { active: next } });
      toast(next ? `«${cellText(row, schema.titleKey)}» харагдана.` : `«${cellText(row, schema.titleKey)}» нуугдлаа.`);
    } catch (err) {
      setItems((list) => list.map((r) => (r.id === row.id ? { ...r, active: row.active } : r)));
      toast(err.message, 'error');
    }
  };
  const sortBy = (k) => setSort((s) => (s.k !== k ? { k, dir: 1 } : s.dir === 1 ? { k, dir: -1 } : { k: '', dir: 1 }));
  const hidden = (items || []).filter((r) => !r.active).length;
  const filtered = q || vis || Object.values(filters).some(Boolean);

  const Switch = ({ row }) => (
    <button type="button" role="switch" aria-checked={Boolean(row.active)} className="a-toggle"
      aria-label={`${activeLabel}: ${cellText(row, schema.titleKey)}`} title={row.active ? 'Харагдаж байна' : 'Нуусан'}
      onClick={(e) => { e.stopPropagation(); toggle(row); }}>
      <span />
    </button>
  );

  return (
    <div className="a-stack">
      <div className="a-toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={`${schema.title}-аас хайх…`} />
        {(schema.filters || []).map((k) => (
          <label key={k} className="a-select">
            <span className="sr">{FILTER_LABEL[k]}</span>
            <select value={filters[k] || ''} onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}>
              <option value="">{FILTER_LABEL[k]}</option>
              {options[k].map((v) => <option key={v} value={v}>{k === 'topic' ? TOPIC_LABEL[v] || v : v}</option>)}
            </select>
          </label>
        ))}
        <label className="a-select">
          <span className="sr">Харагдах байдал</span>
          <select value={vis} onChange={(e) => setVis(e.target.value)}>
            <option value="">Бүгд</option>
            <option value="on">Харагдаж буй</option>
            <option value="off">Нуусан{hidden ? ` (${hidden})` : ''}</option>
          </select>
        </label>
        <span className="a-toolbar__spacer" />
        <button type="button" className="a-icon-btn" onClick={load} aria-label="Шинэчлэх" title="Шинэчлэх"><Icon name="refresh" /></button>
        <button type="button" className="a-icon-btn" onClick={() => download(table, shown)} disabled={!shown.length} aria-label="CSV татах" title="CSV татах"><Icon name="download" /></button>
        <button type="button" className="a-btn" onClick={() => setEditing({})}><Icon name="plus" size={17} />Нэмэх</button>
      </div>
      {error && <p className="a-error" role="alert">{error}</p>}
      {!items ? <Skeleton rows={7} card /> : shown.length === 0 ? (
        <div className="a-panel">
          <Empty icon={TAB[table].icon} title={items.length ? 'Тохирох мөр олдсонгүй' : 'Одоогоор хоосон байна'}
            text={items.length ? 'Хайлт эсвэл шүүлтүүрээ өөрчилнө үү.' : 'Эхний мөрөө нэмээрэй.'}
            action={items.length ? (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => { setQ(''); setVis(''); setFilters({}); }}>Шүүлтүүр арилгах</button>
            ) : <button type="button" className="a-btn a-btn--sm" onClick={() => setEditing({})}><Icon name="plus" size={16} />Нэмэх</button>} />
        </div>
      ) : (
        <>
          <div className="a-scroll a-only-wide">
            <table className="a-table a-table--rows">
              <thead>
                <tr>
                  {schema.cols.map(([k, l]) => (
                    <th key={k} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="a-th" onClick={() => sortBy(k)}>
                        {l}<Icon name={sort.k === k && sort.dir === -1 ? 'down' : 'up'} size={13} className={sort.k === k ? 'is-on' : ''} />
                      </button>
                    </th>
                  ))}
                  <th>Харагдах</th>
                  <th><span className="sr">Үйлдэл</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((row) => (
                  <tr key={row.id} onClick={() => setEditing(row)} className={row.active ? '' : 'is-off'}>
                    {schema.cols.map(([k], i) => (
                      <td key={k} className={i === 0 ? 'a-td-main' : ''}>
                        {i === 0 ? (
                          <button type="button" className="a-rowlink" onClick={(e) => { e.stopPropagation(); setEditing(row); }}>{cellText(row, k)}</button>
                        ) : cellText(row, k)}
                        {i === 0 && row.is_sample ? <span className="a-pill a-pill--sample">Жишээ</span> : null}
                      </td>
                    ))}
                    <td><Switch row={row} /></td>
                    <td className="a-row-actions">
                      <button type="button" className="a-icon-btn" aria-label="Засах" title="Засах" onClick={(e) => { e.stopPropagation(); setEditing(row); }}><Icon name="edit" /></button>
                      <Confirm label="Устгах" compact onConfirm={() => remove(row.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="a-rowcards a-only-narrow">
            {shown.slice(0, limit).map((row) => (
              <li key={row.id} className={row.active ? '' : 'is-off'}>
                <button type="button" className="a-rowcard" onClick={() => setEditing(row)}>
                  <strong>{cellText(row, schema.titleKey)}{row.is_sample ? <span className="a-pill a-pill--sample">Жишээ</span> : null}</strong>
                  <span className="a-muted">
                    {schema.cols.filter(([k]) => k !== schema.titleKey).map(([k]) => cellText(row, k)).filter((v) => v && v !== '—').join(' · ')}
                  </span>
                </button>
                <Switch row={row} />
              </li>
            ))}
          </ul>
          <div className="a-tablefoot">
            <span className="a-muted">{filtered ? `${items.length}-аас ${shown.length} мөр` : `${shown.length} мөр`}{hidden && !vis ? ` · ${hidden} нуусан` : ''}</span>
            {shown.length > limit && (
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={() => setLimit((n) => n + PAGE)}>
                Цааш үзэх ({Math.min(PAGE, shown.length - limit)})
              </button>
            )}
          </div>
        </>
      )}
      {editing && (
        <Drawer title={editing.id ? cellText(editing, schema.titleKey) : 'Шинээр нэмэх'} subtitle={schema.title} onClose={() => setEditing(null)}>
          <EditForm schema={schema} row={editing.id ? editing : null} onSave={save} onCancel={() => setEditing(null)} call={call}
            extra={editing.id ? <Confirm label="Устгах" onConfirm={() => remove(editing.id)} /> : null} />
        </Drawer>
      )}
    </div>
  );
}

/* ---------------- Settings ---------------- */
function ContactSettings({ call }) {
  const toast = useToast();
  const [values, setValues] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call('/settings').then(setValues).catch((err) => setError(err.message));
  }, [call]);
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await call('/settings', { method: 'PUT', body: values });
      toast('Хадгаллаа. Сайт дээр 1 минутын дотор шинэчлэгдэнэ.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (!values) return error ? <p className="a-error">{error}</p> : <Skeleton rows={5} card />;
  return (
    <form className="a-form a-card" onSubmit={submit}>
      {SETTING_FIELDS.map(([k, l]) => (
        <div className="a-field" key={k}>
          <label htmlFor={`s-${k}`}>{l}</label>
          <input id={`s-${k}`} value={values[k] || ''} onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))} />
        </div>
      ))}
      {error && <p className="a-error" role="alert">{error}</p>}
      <div className="a-form__actions"><button className="a-btn" type="submit" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Хадгалах'}</button></div>
    </form>
  );
}

function AccountSettings({ call, account, onSession }) {
  const toast = useToast();
  const [values, setValues] = useState({ username: account ? account.user : '', current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (account) setValues((v) => (v.username ? v : { ...v, username: account.user }));
  }, [account]);
  const set = (k) => (e) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setErrors((s) => ({ ...s, [k]: undefined, form: undefined }));
  };
  const submit = async (e) => {
    e.preventDefault();
    if (values.next && values.next !== values.confirm) {
      setErrors({ confirm: 'Шинэ нууц үг таарахгүй байна.' });
      return;
    }
    setBusy(true);
    try {
      const res = await call('/account', {
        method: 'PUT',
        body: { username: values.username.trim(), current_password: values.current, new_password: values.next },
      });
      onSession(res);
      setValues({ username: res.user, current: '', next: '', confirm: '' });
      setErrors({});
      toast(values.next ? 'Нууц үг солигдлоо. Бусад төхөөрөмж дээрх нэвтрэлт хаагдана.' : 'Нэвтрэх нэр солигдлоо.');
    } catch (err) {
      const f = err.fields || {};
      setErrors({ username: f.username, current: f.current_password, next: f.new_password, form: err.fields ? '' : err.message });
    } finally {
      setBusy(false);
    }
  };
  const type = show ? 'text' : 'password';
  const field = (k, label, props = {}, hint = '') => (
    <div className={`a-field${errors[k] ? ' has-error' : ''}`}>
      <label htmlFor={`acc-${k}`}>{label}</label>
      <input id={`acc-${k}`} value={values[k]} onChange={set(k)} {...props} />
      {errors[k] ? <p className="a-error">{errors[k]}</p> : hint && <p className="a-hint">{hint}</p>}
    </div>
  );
  return (
    <form className="a-form a-card" onSubmit={submit} noValidate>
      {account && account.default_password && (
        <p className="a-alert a-field--wide"><Icon name="lock" />Та анхны нууц үгээр нэвтэрч байна. Хэн ч таах боломжтой тул шинэ нууц үг тохируулна уу.</p>
      )}
      {field('username', 'Нэвтрэх нэр', { autoComplete: 'username', autoCapitalize: 'none', spellCheck: false }, 'Том, жижиг үсэг ялгахгүй.')}
      {field('current', 'Одоогийн нууц үг', { type, autoComplete: 'current-password' })}
      {field('next', 'Шинэ нууц үг', { type, autoComplete: 'new-password' }, 'Хамгийн багадаа 8 тэмдэгт. Үсэг, тоо холивол илүү найдвартай.')}
      {field('confirm', 'Шинэ нууц үгээ давтах', { type, autoComplete: 'new-password' })}
      <div className="a-field a-field--check">
        <label htmlFor="acc-show"><input id="acc-show" type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Нууц үгийг харуулах</label>
      </div>
      {errors.form && <p className="a-error" role="alert">{errors.form}</p>}
      <div className="a-form__actions">
        <button className="a-btn" type="submit" disabled={busy || !values.current}>{busy ? 'Хадгалж байна…' : 'Хадгалах'}</button>
      </div>
    </form>
  );
}

const SETTING_TABS = [['contact', 'Холбоо барих', 'phone'], ['messenger', 'Messenger, Instagram', 'chat'], ['ai', 'AI туслах', 'spark'],
  ['notify', 'Мэдэгдэл, апп', 'bell'], ['account', 'Нэвтрэх, нууц үг', 'lock']];

function Settings({ call, tab, onTab, onChange, go, account, onSession }) {
  return (
    <div className="a-stack">
      <div className="a-tabs" role="tablist" aria-label="Тохиргоо">
        {SETTING_TABS.map(([id, label, icon]) => (
          <button key={id} type="button" role="tab" id={`st-tab-${id}`} aria-selected={tab === id} aria-controls={`st-panel-${id}`} onClick={() => onTab(id)}>
            <Icon name={icon} size={16} />{label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`st-panel-${tab}`} aria-labelledby={`st-tab-${tab}`}>
        {tab === 'messenger' && <MessengerSettings call={call} onChange={onChange} />}
        {tab === 'ai' && <AiSettings call={call} go={go} />}
        {tab === 'contact' && <ContactSettings call={call} />}
        {tab === 'notify' && <NotifySettings call={call} />}
        {tab === 'account' && <AccountSettings call={call} account={account} onSession={onSession} />}
      </div>
    </div>
  );
}

/* ---------------- Shell: sidebar, top bar, mobile tab bar, quick jump ---------------- */
function readHash() {
  const [t, s] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TAB[t] ? t : 'overview', sub: s || '' };
}

const WEEK = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];
function greeting() {
  const d = new Date();
  const h = d.getHours();
  return {
    hello: h < 5 ? 'Оройн мэнд' : h < 12 ? 'Өглөөний мэнд' : h < 18 ? 'Өдрийн мэнд' : 'Оройн мэнд',
    date: `${d.getFullYear()} оны ${d.getMonth() + 1}-р сарын ${d.getDate()}, ${WEEK[d.getDay()]} гараг`,
  };
}

function NavItem({ t, current, counts, onGo }) {
  const n = t.count ? counts[t.count] : 0;
  return (
    <a href={`#/${t.id}`} className="a-nav__item" aria-current={current ? 'page' : undefined} onClick={onGo}>
      <Icon name={t.icon} />
      <span className="a-nav__label">{t.label}</span>
      {n > 0 && <span className="a-badge">{n}</span>}
    </a>
  );
}

function Palette({ onClose, go }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const list = TABS.filter((t) => !q.trim() || `${t.label} ${t.sub}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (t) => { go(t.id); onClose(); };
  return (
    <Drawer title="Хаашаа очих вэ?" onClose={onClose} variant="cmd">
      <div className="a-cmd">
        <SearchBox value={q} onChange={(v) => { setQ(v); setI(0); }} placeholder="Цэсний нэр бичнэ үү…" label="Цэс хайх" autoFocus />
        <ul role="listbox" aria-label="Цэс">
          {list.map((t, idx) => (
            <li key={t.id} role="option" aria-selected={idx === i}>
              <button type="button" onClick={() => pick(t)} onMouseEnter={() => setI(idx)}>
                <Icon name={t.icon} />
                <span><strong>{t.label}</strong>{t.sub && <small>{t.sub}</small>}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="a-muted">Олдсонгүй.</li>}
        </ul>
        <p className="a-hint">↑ ↓ сонгоод Enter. Хаах: Esc.</p>
      </div>
      <PaletteKeys list={list} i={i} setI={setI} pick={pick} />
    </Drawer>
  );
}

function PaletteKeys({ list, i, setI, pick }) {
  const ref = useRef({ list, i });
  ref.current = { list, i };
  useEffect(() => {
    const onKey = (e) => {
      const { list: l, i: idx } = ref.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(l.length - 1, idx + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, idx - 1)); }
      if (e.key === 'Enter' && l[idx]) { e.preventDefault(); pick(l[idx]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setI, pick]);
  return null;
}

const MOBILE_TABS = [
  { id: 'overview', label: 'Тойм', icon: 'home' },
  { id: 'messenger', label: 'Чат', icon: 'chat', count: ['messenger_unread'] },
  { sheet: 'inbox', label: 'Хүсэлт', icon: 'inbox', count: ['partners_new', 'questions_new', 'reviews_pending', 'locations_new'] },
  { sheet: 'content', label: 'Агуулга', icon: 'layers' },
  { sheet: 'more', label: 'Цэс', icon: 'menu' },
];

const PROMPT_KEY = 'domch_admin_push_prompt';

function PushPrompt({ call }) {
  const toast = useToast();
  const [state, refresh] = usePushState();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(PROMPT_KEY) === 'no';
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  if (hidden || !(state === 'off' && typeof Notification !== 'undefined' && Notification.permission === 'default')) return null;
  const later = () => {
    try {
      localStorage.setItem(PROMPT_KEY, 'no');
    } catch {
      /* ignore */
    }
    setHidden(true);
  };
  const on = async () => {
    setBusy(true);
    try {
      await enablePush(call, ['messages', 'requests']);
      toast('Мэдэгдэл асаалаа. Шинэ мессеж, хүсэлт ирэхэд мэдэгдэнэ.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return (
    <div className="a-alert a-alert--top a-alert--info" role="status">
      <Icon name="bell" />
      <p><strong>Шинэ мессеж ирэхэд мэдэгдэл авах уу?</strong> Апп хаалттай байсан ч утас, компьютер дээр тань гарна.</p>
      <button type="button" className="a-btn a-btn--sm" onClick={on} disabled={busy}>Асаах</button>
      <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={later}>Дараа</button>
    </div>
  );
}

function Shell({ route, go, counts, logout, account, call, children }) {
  const { theme, cycle } = useTheme();
  const [sheet, setSheet] = useState('');
  const [palette, setPalette] = useState(false);
  const cur = TAB[route.tab];
  const hi = greeting();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const themeBtn = (
    <button type="button" className="a-side__btn" onClick={cycle} title="Өнгөний горим солих">
      <Icon name={THEME_ICON[theme]} /><span>{THEME_LABEL[theme]}</span>
    </button>
  );
  const sheetTabs = sheet === 'more' ? TABS.filter((t) => t.group === 'system') : TABS.filter((t) => t.group === sheet && t.id !== 'messenger');
  const inGroup = (m) => (m.id ? m.id === route.tab : (m.sheet === 'more' ? cur.group === 'system' : cur.group === m.sheet && route.tab !== 'messenger'));

  return (
    <div className={`admin a-shell is-${route.tab}`}>
      <a className="a-skip" href="#a-main">Үндсэн хэсэг рүү</a>
      <aside className="a-side" aria-label="Удирдлагын цэс">
        <a className="a-brand" href="#/overview">
          <img className="a-logo" src="/icons/logo-mark.png" alt="" width="36" height="36" />
          <span><strong>ДОМЧ</strong><small>{account ? account.user : 'Удирдлага'}</small></span>
        </a>
        <button type="button" className="a-jump" onClick={() => setPalette(true)}>
          <Icon name="search" size={16} /><span>Хайх, шилжих</span><kbd>⌘K</kbd>
        </button>
        <nav className="a-nav">
          {GROUPS.map(([g, label]) => (
            <div key={g} className="a-nav__group">
              {label && <p className="a-nav__title">{label}</p>}
              {TABS.filter((t) => t.group === g).map((t) => (
                <NavItem key={t.id} t={t} current={route.tab === t.id} counts={counts} />
              ))}
            </div>
          ))}
        </nav>
        <div className="a-side__foot">
          <a className="a-side__btn" href="/" target="_blank" rel="noopener noreferrer"><Icon name="external" /><span>Сайтыг нээх</span></a>
          {themeBtn}
          <button type="button" className="a-side__btn" onClick={logout}><Icon name="logout" /><span>Гарах</span></button>
        </div>
      </aside>

      <div className="a-page">
        <header className="a-top">
          <img className="a-logo a-only-narrow" src="/icons/logo-mark.png" alt="" width="36" height="36" />
          <div className="a-top__title">
            <h1>{route.tab === 'overview' ? hi.hello : cur.label}</h1>
            <p className="a-muted">{route.tab === 'overview' ? hi.date : cur.sub}</p>
          </div>
          <button type="button" className="a-icon-btn a-only-narrow" onClick={() => setPalette(true)} aria-label="Хайх, шилжих"><Icon name="search" /></button>
          <a className="a-icon-btn a-bell" href="#/settings/notify" aria-label="Мэдэгдлийн тохиргоо" title="Мэдэгдэл">
            <Icon name="bell" />
          </a>
        </header>
        <main id="a-main" className="a-main" tabIndex={-1}>
          {account && account.default_password && !(route.tab === 'settings' && route.sub === 'account') && (
            <div className="a-alert a-alert--top" role="status">
              <Icon name="lock" />
              <p><strong>Анхны нууц үгээ солино уу.</strong> Admin / admin123 нь хэн ч таах боломжтой нууц үг.</p>
              <a className="a-btn a-btn--sm" href="#/settings/account">Нууц үг солих</a>
            </div>
          )}
          {!(route.tab === 'settings' && route.sub === 'notify') && <PushPrompt call={call} />}
          {children}
        </main>
      </div>

      <nav className="a-tabbar" aria-label="Үндсэн цэс">
        {MOBILE_TABS.map((m) => {
          const n = (m.count || []).reduce((s, k) => s + (counts[k] || 0), 0);
          const on = inGroup(m);
          const inner = (<><span className="a-tabbar__ic"><Icon name={m.icon} size={22} />{n > 0 && <span className="a-badge">{n}</span>}</span><span>{m.label}</span></>);
          return m.id ? (
            <a key={m.label} href={`#/${m.id}`} aria-current={on ? 'page' : undefined}>{inner}</a>
          ) : (
            <button key={m.label} type="button" className={on ? 'is-on' : ''} onClick={() => setSheet(m.sheet)} aria-haspopup="dialog">{inner}</button>
          );
        })}
      </nav>

      {sheet && (
        <Drawer title={{ inbox: 'Ирсэн хүсэлт', content: 'Сайтын агуулга', more: 'Цэс' }[sheet]} onClose={() => setSheet('')} variant="sheet">
          <div className="a-sheet">
            {sheetTabs.map((t) => (
              <NavItem key={t.id} t={t} current={route.tab === t.id} counts={counts} onGo={() => setSheet('')} />
            ))}
            {sheet === 'more' && (
              <>
                <a className="a-nav__item" href="/" target="_blank" rel="noopener noreferrer"><Icon name="external" /><span className="a-nav__label">Сайтыг нээх</span></a>
                <button type="button" className="a-nav__item" onClick={cycle}><Icon name={THEME_ICON[theme]} /><span className="a-nav__label">Өнгө: {THEME_LABEL[theme]}</span></button>
                <button type="button" className="a-nav__item" onClick={logout}><Icon name="logout" /><span className="a-nav__label">Гарах</span></button>
              </>
            )}
          </div>
        </Drawer>
      )}
      {palette && <Palette onClose={() => setPalette(false)} go={go} />}
    </div>
  );
}

function AdminApp() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  });
  const [route, setRoute] = useState(readHash);
  const [summary, setSummary] = useState(null);
  const [account, setAccount] = useState(null);
  const [notice, setNotice] = useState('');
  const keep = useCallback((t) => {
    try {
      if (t) sessionStorage.setItem(KEY, t);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* private mode: the session lasts while the page is open */
    }
    setToken(t);
  }, []);
  const logout = useCallback(() => {
    setNotice('');
    setAccount(null);
    keep('');
  }, [keep]);
  const expired = useCallback(() => {
    setNotice('Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.');
    setAccount(null);
    keep('');
  }, [keep]);
  const onSession = useCallback((res) => {
    if (!res || !res.token) return;
    keep(res.token);
    setAccount({ user: res.user, default_password: res.default_password });
  }, [keep]);
  const call = useAdminApi(token, expired);
  useEffect(() => {
    if (token && !account) call('/account').then(setAccount).catch(() => {});
  }, [token, account, call]);
  const go = useCallback((tab, sub = '') => { window.location.hash = `/${tab}${sub ? `/${sub}` : ''}`; }, []);
  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadSummary = useCallback(() => {
    if (!token) return;
    call('/summary').then((s) => setSummary({ ...s, full: true })).catch(() => {});
  }, [call, token]);
  // badge counts only: the 30-day statistics are read when the overview opens, not on every refresh
  const loadCounts = useCallback(() => {
    if (!token) return;
    call('/summary?events=0').then((s) => setSummary((prev) => ({ ...(prev || { events: [], daily: [] }), ...s }))).catch(() => {});
  }, [call, token]);
  useEffect(() => { if (route.tab === 'overview') loadSummary(); else loadCounts(); }, [loadSummary, loadCounts, route.tab]);
  useEffect(() => {
    // keep the badges fresh while the admin is open (new Messenger messages, form requests)
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadCounts(); }, 60000);
    return () => clearInterval(id);
  }, [loadCounts]);

  const counts = (summary && summary.counts) || {};
  const unread = ['messenger_unread', 'partners_new', 'questions_new', 'reviews_pending', 'locations_new'].reduce((s, k) => s + (counts[k] || 0), 0);
  useAdminApp();
  useAppBadge(token ? unread : 0);
  const toast = useToast();
  const seen = useRef(null);
  useEffect(() => {
    if (!summary) return;
    const prev = seen.current;
    seen.current = counts;
    if (!prev) return;
    const grew = TODO.filter(([, k]) => (counts[k] || 0) > (prev[k] || 0));
    if (grew.length) toast(`Шинээр ирлээ: ${grew.map(([tab]) => TAB[tab].label).join(', ')}`);
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${unread ? `(${unread}) ` : ''}${token ? `${TAB[route.tab].label} · ` : ''}ДОМЧ удирдлага`;
  }, [unread, route.tab, token]);

  if (!token) {
    return (
      <Login notice={notice} onDone={(res) => { setNotice(''); onSession(res); }} />
    );
  }
  const cur = TAB[route.tab];
  const settingsTab = SETTING_TABS.some(([id]) => id === route.sub) ? route.sub : 'contact';
  return (
    <Shell route={route} go={go} counts={counts} logout={logout} account={account} call={call}>
      {route.tab === 'overview' && <Overview call={call} summary={summary} reload={loadSummary} go={go} />}
      {cur.inbox && <Inbox key={route.tab} kind={route.tab} call={call} onChange={loadCounts} />}
      {cur.table && <TableView key={route.tab} table={route.tab} call={call} />}
      {route.tab === 'messenger' && (
        <MessengerInbox call={call} onChange={loadCounts} openSettings={() => go('settings', 'messenger')} initial={route.sub} />
      )}
      {route.tab === 'settings' && (
        <Settings call={call} tab={settingsTab} onTab={(id) => go('settings', id)} onChange={loadSummary} go={go}
          account={account} onSession={onSession} />
      )}
    </Shell>
  );
}

export default function Admin() {
  return (
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  );
}
