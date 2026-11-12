import { useCallback, useEffect, useState } from 'react';
import { Empty, Icon, Skeleton, useToast } from './ui.jsx';
import { formatDate } from '../lib/util.js';

/* ---------- Turning the admin into an installable app with push notifications ---------- */

const SCOPE = '/admin';
const KIND_LABEL = { messages: 'Messenger, Instagram мессеж', requests: 'Сайтаас ирсэн хүсэлт (асуулт, сэтгэгдэл, хамтын ажиллагаа, байршил)' };

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIos() && !/iPhone/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Төхөөрөмж';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return `${device}${browser ? ` · ${browser}` : ''}${isStandalone() ? ' (апп)' : ''}`;
}

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Points the page at the admin app manifest, registers the service worker, and opens pages a tapped notification asks for. */
export function useAdminApp() {
  useEffect(() => {
    const swap = (selector, attr, value) => {
      const el = document.querySelector(selector);
      if (!el) return () => {};
      const before = el.getAttribute(attr);
      el.setAttribute(attr, value);
      return () => el.setAttribute(attr, before);
    };
    const undo = [
      swap('link[rel="manifest"]', 'href', '/admin.webmanifest'),
      swap('meta[name="apple-mobile-web-app-title"]', 'content', 'ДОМЧ Удирдлага'),
      swap('meta[name="theme-color"]', 'content', '#024B42'),
    ];
    let capable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    if (!capable) {
      capable = document.createElement('meta');
      capable.name = 'apple-mobile-web-app-capable';
      capable.content = 'yes';
      document.head.appendChild(capable);
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: SCOPE }).catch(() => {});
    }
    const onMessage = (e) => {
      if (e.data && e.data.type === 'open' && typeof e.data.url === 'string') {
        const next = new URL(e.data.url, window.location.origin);
        if (next.origin === window.location.origin) window.location.hash = next.hash || '#/overview';
      }
    };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      undo.forEach((fn) => fn());
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);
}

/** The home-screen badge shows how many things are waiting (installed app, where supported). */
export function useAppBadge(count) {
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }, [count]);
  useEffect(() => {
    // opening the admin clears the notifications that brought you here
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration(SCOPE).then((reg) => reg && reg.getNotifications()
      .then((list) => list.forEach((n) => n.close()))).catch(() => {});
  }, [count]);
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SCOPE);
  return reg ? reg.pushManager.getSubscription() : null;
}

/** State of push on this device: 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'. */
export function usePushState() {
  const [state, setState] = useState('loading');
  const refresh = useCallback(async () => {
    if (!pushSupported()) {
      setState(isIos() && !isStandalone() ? 'needs-install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    try {
      setState((await currentSubscription()) ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return [state, refresh];
}

export async function enablePush(call, kinds) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Мэдэгдлийг хориглосон байна. Браузерын тохиргооноос энэ сайтад зөвшөөрнө үү.'
    : 'Мэдэгдлийг зөвшөөрөөгүй байна.');
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: SCOPE });
  await navigator.serviceWorker.ready;
  const { public_key: key } = await call('/push');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const current = sub.options && sub.options.applicationServerKey;
    const same = current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key;
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await call('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), label: deviceLabel(), kinds } });
  return sub;
}

/* ---------- Settings → Мэдэгдэл ---------- */

export function NotifySettings({ call }) {
  const toast = useToast();
  const [state, refresh] = usePushState();
  const [info, setInfo] = useState(null);
  const [mine, setMine] = useState('');
  const [kinds, setKinds] = useState(['messages', 'requests']);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await call('/push'));
    } catch (err) {
      toast(err.message, 'error');
    }
    const sub = await currentSubscription().catch(() => null);
    setMine(sub ? sub.endpoint.slice(-16) : '');
  }, [call, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const own = info && info.devices.find((d) => d.endpoint_id === mine);
    if (own) setKinds(own.kinds);
  }, [info, mine]);

  const run = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      refresh();
      load();
    }
  };
  const turnOn = () => run(() => enablePush(call, kinds), 'Энэ төхөөрөмж дээр мэдэгдэл асаалаа.');
  const turnOff = () => run(async () => {
    const sub = await currentSubscription();
    if (sub) {
      await call('/push/unsubscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      await sub.unsubscribe();
    }
  }, 'Энэ төхөөрөмж дээр мэдэгдэл унтарлаа.');
  const test = () => run(async () => {
    const sub = await currentSubscription();
    await call('/push/test', { method: 'POST', body: { endpoint: sub ? sub.endpoint : '' } });
  }, 'Туршилтын мэдэгдэл илгээлээ. Хэдэн секундэд ирнэ.');
  const forget = (id) => run(() => call(`/push/devices/${id}`, { method: 'DELETE' }), 'Төхөөрөмжийг хаслаа.');
  const toggleKind = (k) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    setKinds(next);
    if (state === 'on' && next.length) run(() => enablePush(call, next), 'Хадгаллаа.');
  };

  return (
    <div className="a-stack">
      <section className="a-card a-notify">
        <div className={`a-status${state === 'on' ? ' is-ok' : ''}`}>
          <span className="a-status__dot" aria-hidden="true" />
          <div>
            <strong>{state === 'on' ? 'Энэ төхөөрөмж мэдэгдэл авна' : 'Энэ төхөөрөмж дээр мэдэгдэл унтраастай'}</strong>
            <p className="a-muted">Шинэ мессеж, хүсэлт ирэхэд апп хаалттай байсан ч утас, компьютер дээр тань мэдэгдэл гарна.</p>
          </div>
          {state === 'on' && (
            <div className="a-notify__btns">
              <button type="button" className="a-btn a-btn--sm" onClick={test} disabled={busy}><Icon name="bell" size={16} />Туршиж үзэх</button>
              <button type="button" className="a-btn a-btn--ghost a-btn--sm" onClick={turnOff} disabled={busy}>Унтраах</button>
            </div>
          )}
          {state === 'off' && (
            <button type="button" className="a-btn" onClick={turnOn} disabled={busy || !kinds.length}><Icon name="bell" size={17} />Мэдэгдэл асаах</button>
          )}
        </div>
        {state === 'needs-install' && (
          <div className="a-install">
            <p><strong>iPhone, iPad дээр эхлээд апп болгон суулгана:</strong></p>
            <ol className="a-guide">
              <li>Safari-ийн доод хэсгийн <b>Хуваалцах</b> (□↑) товчийг дарна.</li>
              <li><b>«Нүүр дэлгэцэнд нэмэх»</b> (Add to Home Screen) → <b>Нэмэх</b>.</li>
              <li>Нүүр дэлгэц дээрх <b>ДОМЧ</b> аппыг нээж нэвтрээд энд буцаж ирээд <b>Мэдэгдэл асаах</b>-ыг дарна.</li>
            </ol>
          </div>
        )}
        {state === 'denied' && <p className="a-note">Мэдэгдлийг хориглосон байна. Утас/браузерын тохиргооноос domch.gem.mn-д мэдэгдэл зөвшөөрөөд хуудсаа дахин ачаална уу.</p>}
        {state === 'unsupported' && <p className="a-note">Энэ браузер мэдэгдэл дэмжихгүй байна. Chrome, Edge, Safari-ийн шинэ хувилбар ашиглана уу.</p>}
        {(state === 'on' || state === 'off') && (
          <fieldset className="a-notify__kinds">
            <legend>Юуны талаар мэдэгдэх вэ</legend>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <label key={k} className="a-switch-row">
                <span>{label}</span>
                <input type="checkbox" role="switch" className="a-switch" checked={kinds.includes(k)} onChange={() => toggleKind(k)} disabled={busy} />
              </label>
            ))}
          </fieldset>
        )}
      </section>

      {state !== 'needs-install' && !isStandalone() && (
        <section className="a-card a-install">
          <h2>Апп болгон суулгах</h2>
          <p className="a-muted">Нүүр дэлгэц дээр ДОМЧ дүрстэй апп болж, браузерын хаяг мөргүйгээр нээгдэнэ.</p>
          <ul className="a-guide">
            <li><b>iPhone, iPad (Safari):</b> Хуваалцах (□↑) → «Нүүр дэлгэцэнд нэмэх».</li>
            <li><b>Android (Chrome):</b> ⋮ цэс → «Апп суулгах» эсвэл «Нүүр дэлгэцэнд нэмэх».</li>
            <li><b>Компьютер (Chrome, Edge):</b> хаягийн мөрний баруун талын суулгах (⊕) дүрс.</li>
          </ul>
        </section>
      )}

      <section className="a-card">
        <h2>Мэдэгдэл авдаг төхөөрөмжүүд</h2>
        {!info ? <Skeleton rows={2} /> : info.devices.length === 0 ? (
          <Empty icon="bell" title="Одоогоор бүртгэлтэй төхөөрөмж алга" text="Мэдэгдэл асаасан утас, компьютер энд жагсана." />
        ) : (
          <ul className="a-devices">
            {info.devices.map((d) => (
              <li key={d.id}>
                <Icon name={/iPhone|Android|iPad/.test(d.label || '') ? 'phone' : 'monitor'} />
                <div>
                  <strong>{d.label || 'Төхөөрөмж'}{d.endpoint_id === mine && <span className="a-pill a-pill--done">Энэ төхөөрөмж</span>}</strong>
                  <span className="a-muted">
                    {d.kinds.map((k) => (k === 'messages' ? 'Мессеж' : 'Хүсэлт')).join(', ')} · {formatDate(d.created_at)}-нд нэмсэн
                    {d.last_error ? ` · Сүүлд алдаа: ${d.last_error}` : d.last_ok_at ? ` · Сүүлд ${formatDate(d.last_ok_at)}` : ''}
                  </span>
                </div>
                <button type="button" className="a-icon-btn" aria-label="Хасах" title="Хасах" onClick={() => forget(d.id)} disabled={busy}><Icon name="trash" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
