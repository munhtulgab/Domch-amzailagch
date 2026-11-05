import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { CITIES } from '../data/static.js';
import { formatDate } from '../lib/util.js';
import { Modal } from '../components/Modal.jsx';
import { MessengerInbox, MessengerSettings } from './Messenger.jsx';
import { AiSettings } from './Ai.jsx';
import './admin.css';

const KEY = 'domch_admin_token';

const TABS = [
  { id: 'overview', label: 'Тойм' },
  { id: 'partners', label: 'Хамтын ажиллагаа', inbox: true, count: 'partners_new' },
  { id: 'questions', label: 'Эмчээс асуусан', inbox: true, count: 'questions_new' },
  { id: 'reviews', label: 'Сэтгэгдэл', inbox: true, count: 'reviews_pending' },
  { id: 'locations', label: 'Байршлын санал', inbox: true, count: 'locations_new' },
  { id: 'messenger', label: 'Messenger, Instagram', count: 'messenger_unread' },
  { id: 'branches', label: 'Салбарууд', table: true },
  { id: 'products', label: 'Бүтээгдэхүүн, үнэ', table: true },
  { id: 'tips', label: 'Эмчийн зөвлөгөө', table: true },
  { id: 'knowledge', label: 'Мэдлэгийн сан', table: true },
  { id: 'videos', label: 'Видео', table: true },
  { id: 'faqs', label: 'Түгээмэл асуулт', table: true },
  { id: 'settings', label: 'Тохиргоо' },
];

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
    cols: [['volume_ml', 'Хэмжээ (мл)'], ['price', 'Үнэ (₮)'], ['online_url', 'Онлайн холбоос']],
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
    cols: [['author', 'Нэр'], ['topic', 'Сэдэв'], ['kind', 'Төрөл']],
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
    cols: [['question', 'Асуулт'], ['sort', 'Эрэмбэ']],
    fields: [
      { k: 'question', l: 'Асуулт', req: true },
      { k: 'answer', l: 'Хариулт', type: 'textarea', req: true },
      SORT,
      ACTIVE,
    ],
  },
};

const SETTING_FIELDS = [
  ['phone', 'Утас'], ['email', 'И-мэйл'], ['address', 'Хаяг'], ['online_store', 'Онлайн дэлгүүрийн холбоос'],
  ['facebook', 'Facebook холбоос'], ['instagram', 'Instagram холбоос'], ['youtube', 'YouTube холбоос'],
];

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

function Confirm({ label, onConfirm, danger = true }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <button type="button" className={`a-btn${danger ? ' a-btn--danger' : ''}`} onClick={() => { setArmed(false); onConfirm(); }}>Тийм, {label.toLowerCase()}</button>
  ) : (
    <button type="button" className="a-btn a-btn--ghost" onClick={() => setArmed(true)}>{label}</button>
  );
}

function Login({ onDone }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/summary', { token: token.trim() });
      onDone(token.trim());
    } catch (err) {
      setError(err.status === 401 ? 'Нэвтрэх түлхүүр буруу байна.' : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="a-login">
      <form onSubmit={submit} className="a-card">
        <p className="a-mark">DOMCH</p>
        <h1>Удирдлагын хэсэг</h1>
        <label htmlFor="a-token">Нэвтрэх түлхүүр</label>
        <input id="a-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" required />
        {error && <p className="a-error" role="alert">{error}</p>}
        <button className="a-btn" type="submit" disabled={busy || !token.trim()}>{busy ? 'Шалгаж байна…' : 'Нэвтрэх'}</button>
        <a className="a-link" href="/">Сайт руу буцах</a>
      </form>
    </div>
  );
}

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
function DailyChart({ daily }) {
  const days = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, d.count]));
    return lastDays(30).map((day) => ({ day, count: map.get(day) || 0 }));
  }, [daily]);
  const [active, setActive] = useState(null);
  const top = niceMax(Math.max(...days.map((d) => d.count)));
  const total = days.reduce((s, d) => s + d.count, 0);
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
      <figcaption>
        <span>Өдөр тутмын үйлдэл, сүүлийн 30 хоног</span>
        <span className="a-muted">Нийт {total.toLocaleString('en-US')}</span>
      </figcaption>
      <div className="a-chart__plot">
        <div className="a-chart__y" aria-hidden="true"><span>{top.toLocaleString('en-US')}</span><span>0</span></div>
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
              <strong>{cur.count.toLocaleString('en-US')}</strong>
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

function Overview({ call, summary, reload, go }) {
  const [msg, setMsg] = useState('');
  const counts = (summary && summary.counts) || {};
  const cards = [
    ['reviews', 'Шалгах сэтгэгдэл', counts.reviews_pending],
    ['questions', 'Шинэ асуулт', counts.questions_new],
    ['partners', 'Шинэ хүсэлт', counts.partners_new],
    ['locations', 'Байршлын санал', counts.locations_new],
    ['messenger', 'Уншаагүй мессеж', counts.messenger_unread],
  ];
  const clear = async () => {
    try {
      const res = await call('/clear-samples', { method: 'POST', body: {} });
      setMsg(`${res.deleted} жишээ мөр устгалаа.`);
      reload();
    } catch (err) {
      setMsg(err.message);
    }
  };
  return (
    <div className="a-stack">
      <div className="a-cards">
        {cards.map(([tab, label, n]) => (
          <button key={tab} type="button" className="a-stat" onClick={() => go(tab)}>
            <span className="a-stat__n">{n ?? '—'}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {counts.samples > 0 && (
        <div className="a-card a-warn">
          <p><strong>{counts.samples} жишээ мөр</strong> (салбар, зөвлөгөө, видео) сайтад «Жишээ» тэмдэгтэй харагдаж байна. Бодит мэдээллээ оруулаад жишээг устгана уу. Жишээ мөрийг засахад бодит мөр болно.</p>
          <Confirm label="Жишээг устгах" onConfirm={clear} />
        </div>
      )}
      {msg && <p className="a-note">{msg}</p>}
      <div className="a-card">
        <h2>Сүүлийн 30 хоногийн үйлдэл</h2>
        {summary && summary.events.length ? (
          <table className="a-table">
            <thead><tr><th>Үйлдэл</th><th className="num">Тоо</th></tr></thead>
            <tbody>
              {summary.events.map((e) => (
                <tr key={e.name}><td>{EVENT_LABEL[e.name] || e.name}</td><td className="num">{e.count}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="a-muted">Одоогоор бүртгэгдсэн үйлдэл алга.</p>}
        {summary && <DailyChart daily={summary.daily || []} />}
        <p className="a-muted">Онлайн дэлгүүрийн борлуулалттай холбогдоогүй тул холбоосын даралтыг борлуулалт гэж тооцохгүй.</p>
      </div>
      <p className="a-muted">Өгөгдлийн сан: {summary ? (summary.driver === 'd1' ? 'Cloudflare D1' : 'Локал SQLite') : '…'}</p>
    </div>
  );
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

function Inbox({ kind, call, onChange }) {
  const [status, setStatus] = useState('');
  const [data, setData] = useState({ items: [], statuses: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await call(`/inbox/${kind}${status ? `?status=${status}` : ''}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [call, kind, status]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, next) => {
    try {
      await call(`/inbox/${kind}/${id}`, { method: 'PATCH', body: { status: next } });
      await load();
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };
  const remove = async (id) => {
    try {
      await call(`/inbox/${kind}/${id}`, { method: 'DELETE' });
      await load();
      onChange();
    } catch (err) {
      setError(err.message);
    }
  };
  const download = () => {
    const blob = new Blob(['﻿' + toCsv(data.items)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `domch-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="a-stack">
      <div className="a-toolbar">
        <label htmlFor="a-status">Төлөв</label>
        <select id="a-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Бүгд</option>
          {data.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
        </select>
        <button type="button" className="a-btn a-btn--ghost" onClick={load}>Шинэчлэх</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={download} disabled={!data.items.length}>CSV татах</button>
      </div>
      {error && <p className="a-error" role="alert">{error}</p>}
      {loading ? <p className="a-muted">Ачаалж байна…</p> : data.items.length === 0 ? (
        <p className="a-muted">Мэдээлэл алга.</p>
      ) : (
        <ul className="a-inbox">
          {data.items.map((r) => (
            <li key={r.id} className="a-card">
              <div className="a-inbox__head">
                <span className={`a-pill a-pill--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
                <span className="a-muted">{formatDate(r.created_at)} · №{r.id}</span>
              </div>
              <InboxBody kind={kind} r={r} />
              <div className="a-inbox__actions">
                <label className="sr" htmlFor={`st-${r.id}`}>Төлөв өөрчлөх</label>
                <select id={`st-${r.id}`} value={r.status} onChange={(e) => patch(r.id, e.target.value)}>
                  {data.statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
                </select>
                {kind === 'reviews' && r.status !== 'approved' && (
                  <button type="button" className="a-btn" onClick={() => patch(r.id, 'approved')}>Нийтлэх</button>
                )}
                <Confirm label="Устгах" onConfirm={() => remove(r.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value, href }) {
  if (!value) return null;
  return (
    <p className="a-kv"><span>{label}</span>{href ? <a href={href}>{value}</a> : <span className="a-pre">{value}</span>}</p>
  );
}

function InboxBody({ kind, r }) {
  if (kind === 'reviews') {
    return (
      <div>
        <p className="a-stars" aria-label={`5-аас ${r.rating}`}>{'★'.repeat(r.rating)}<span>{'★'.repeat(5 - r.rating)}</span></p>
        <Row label="Нэр" value={r.name} />
        <Row label="Савлагаа" value={r.size && r.size !== 'unknown' ? `${r.size} мл` : ''} />
        <Row label="Сэтгэгдэл" value={r.body} />
      </div>
    );
  }
  if (kind === 'questions') {
    return (
      <div>
        <Row label="Асуулт" value={r.question} />
        <Row label="Нэр" value={r.name} />
        <Row label="Холбоо барих" value={r.contact} />
      </div>
    );
  }
  if (kind === 'partners') {
    return (
      <div>
        <Row label="Төрөл" value={KIND_LABEL[r.kind] || r.kind} />
        <Row label="Байгууллага" value={r.org} />
        <Row label="Холбоо барих" value={r.contact_name} />
        <Row label="Утас" value={r.phone} href={r.phone ? `tel:${r.phone.replace(/\s/g, '')}` : ''} />
        <Row label="И-мэйл" value={r.email} href={r.email ? `mailto:${r.email}` : ''} />
        <Row label="Байршил" value={r.location} />
        {Object.entries(r.details || {}).map(([k, v]) => <Row key={k} label={DETAIL_LABEL[k] || k} value={v} />)}
        <Row label="Мессеж" value={r.message} />
      </div>
    );
  }
  return (
    <div>
      <Row label="Байршил" value={[r.city, r.district].filter(Boolean).join(', ')} />
      <Row label="Санал" value={r.note} />
      <Row label="Холбоо барих" value={r.contact} />
    </div>
  );
}

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
        <label className="a-btn a-btn--ghost a-image__pick">
          <input type="file" accept="image/*" onChange={pick} disabled={busy} />
          {busy ? 'Оруулж байна…' : value ? 'Зураг солих' : 'Зураг оруулах'}
        </label>
        {value && <button type="button" className="a-btn a-btn--ghost" onClick={() => onChange('')}>Хасах</button>}
        <input id={id} type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="эсвэл зургийн холбоос https://…" />
      </div>
    </div>
  );
}

function EditForm({ schema, row, onSave, onCancel, call }) {
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
              <label htmlFor={id}><input id={id} type="checkbox" checked={values[f.k]} onChange={(e) => set(e.target.checked)} /> {f.l}</label>
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
      <div className="a-form__actions">
        <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Хадгалах'}</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={onCancel}>Болих</button>
      </div>
    </form>
  );
}

function TableView({ table, call }) {
  const schema = SCHEMAS[table];
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems((await call(`/t/${table}`)).items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [call, table]);
  useEffect(() => { load(); }, [load]);

  const save = async (values) => {
    const body = { ...values };
    if (editing && editing.id) await call(`/t/${table}/${editing.id}`, { method: 'PUT', body });
    else await call(`/t/${table}`, { method: 'POST', body });
    setEditing(null);
    load();
  };
  const remove = async (id) => {
    try {
      await call(`/t/${table}/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  const cell = (row, key) => {
    const v = row[key];
    if (key === 'featured') return v ? 'Тийм' : '';
    if (key === 'topic') return TOPIC_LABEL[v] || v;
    if (key === 'updated_at') return formatDate(v);
    if (key === 'kind') return { advice: 'Зөвлөгөө', minute: '1 минут', myth: 'Үнэн үү?', creator: 'Бүтээгч', family: 'Гэр бүл' }[v] || v;
    if (key === 'price') return v == null ? '—' : Number(v).toLocaleString('en-US');
    return v == null || v === '' ? '—' : String(v);
  };

  return (
    <div className="a-stack">
      <div className="a-toolbar">
        <button type="button" className="a-btn" onClick={() => setEditing({})}>Шинээр нэмэх</button>
        <button type="button" className="a-btn a-btn--ghost" onClick={load}>Шинэчлэх</button>
      </div>
      {error && <p className="a-error" role="alert">{error}</p>}
      {loading ? <p className="a-muted">Ачаалж байна…</p> : items.length === 0 ? <p className="a-muted">Мөр алга.</p> : (
        <div className="a-scroll">
          <table className="a-table">
            <thead>
              <tr>
                {schema.cols.map(([k, l]) => <th key={k}>{l}</th>)}
                <th>Төлөв</th>
                <th aria-label="Үйлдэл" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  {schema.cols.map(([k]) => <td key={k}>{cell(row, k)}</td>)}
                  <td>
                    {row.is_sample ? <span className="a-pill a-pill--sample">Жишээ</span> : null}
                    {row.active ? <span className="a-pill a-pill--approved">Харагдана</span> : <span className="a-pill">Нуусан</span>}
                  </td>
                  <td className="a-row-actions">
                    <button type="button" className="a-btn a-btn--ghost" onClick={() => setEditing(row)}>Засах</button>
                    <Confirm label="Устгах" onConfirm={() => remove(row.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? 'Засах' : 'Шинээр нэмэх'} onClose={() => setEditing(null)} wide>
          <EditForm schema={schema} row={editing.id ? editing : null} onSave={save} onCancel={() => setEditing(null)} call={call} />
        </Modal>
      )}
    </div>
  );
}

function ContactSettings({ call }) {
  const [values, setValues] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    call('/settings').then(setValues).catch((err) => setError(err.message));
  }, [call]);
  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    setError('');
    try {
      await call('/settings', { method: 'PUT', body: values });
      setMsg('Хадгаллаа. Сайт дээр 1 минутын дотор шинэчлэгдэнэ.');
    } catch (err) {
      setError(err.message);
    }
  };
  if (!values) return error ? <p className="a-error">{error}</p> : <p className="a-muted">Ачаалж байна…</p>;
  return (
    <form className="a-form a-card" onSubmit={submit}>
      {SETTING_FIELDS.map(([k, l]) => (
        <div className="a-field" key={k}>
          <label htmlFor={`s-${k}`}>{l}</label>
          <input id={`s-${k}`} value={values[k] || ''} onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))} />
        </div>
      ))}
      {error && <p className="a-error" role="alert">{error}</p>}
      {msg && <p className="a-note" role="status">{msg}</p>}
      <div className="a-form__actions"><button className="a-btn" type="submit">Хадгалах</button></div>
    </form>
  );
}

const SETTING_TABS = [['contact', 'Холбоо барих'], ['messenger', 'Messenger, Instagram'], ['ai', 'AI']];

function Settings({ call, tab, onTab, onChange, go }) {
  return (
    <div className="a-stack">
      <div className="a-tabs" role="tablist" aria-label="Тохиргоо">
        {SETTING_TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`st-tab-${id}`} aria-selected={tab === id} aria-controls={`st-panel-${id}`} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`st-panel-${tab}`} aria-labelledby={`st-tab-${tab}`}>
        {tab === 'messenger' && <MessengerSettings call={call} onChange={onChange} />}
        {tab === 'ai' && <AiSettings call={call} go={go} />}
        {tab === 'contact' && <ContactSettings call={call} />}
      </div>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  });
  const [tab, setTab] = useState('overview');
  const [settingsTab, setSettingsTab] = useState('contact');
  const [summary, setSummary] = useState(null);
  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setToken('');
  }, []);
  const call = useAdminApi(token, logout);
  const loadSummary = useCallback(() => {
    if (!token) return;
    call('/summary').then(setSummary).catch(() => {});
  }, [call, token]);
  useEffect(() => { loadSummary(); }, [loadSummary, tab]);
  useEffect(() => {
    // keep the badges fresh while the admin is open (new Messenger messages, form requests)
    const id = setInterval(() => { if (document.visibilityState === 'visible') loadSummary(); }, 30000);
    return () => clearInterval(id);
  }, [loadSummary]);

  useEffect(() => {
    document.title = 'ДОМЧ удирдлага';
  }, []);

  if (!token) {
    return (
      <Login onDone={(t) => {
        try {
          sessionStorage.setItem(KEY, t);
        } catch {
          /* ignore */
        }
        setToken(t);
      }}
      />
    );
  }
  const current = TABS.find((t) => t.id === tab);
  const counts = (summary && summary.counts) || {};
  return (
    <div className="admin">
      <header className="a-head">
        <a className="a-mark" href="/">DOMCH</a>
        <span className="a-muted">Удирдлагын хэсэг</span>
        <button type="button" className="a-btn a-btn--ghost" onClick={logout}>Гарах</button>
      </header>
      <div className="a-body">
        <nav className="a-nav" aria-label="Удирдлагын цэс">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
              {t.count && counts[t.count] > 0 && <span className="a-badge">{counts[t.count]}</span>}
            </button>
          ))}
        </nav>
        <main className="a-main">
          <h1>{current.label}</h1>
          {tab === 'overview' && <Overview call={call} summary={summary} reload={loadSummary} go={setTab} />}
          {current.inbox && <Inbox key={tab} kind={tab} call={call} onChange={loadSummary} />}
          {current.table && <TableView key={tab} table={tab} call={call} />}
          {tab === 'messenger' && (
            <MessengerInbox call={call} onChange={loadSummary} openSettings={() => { setSettingsTab('messenger'); setTab('settings'); }} />
          )}
          {tab === 'settings' && <Settings call={call} tab={settingsTab} onTab={setSettingsTab} onChange={loadSummary} go={setTab} />}
        </main>
      </div>
    </div>
  );
}
