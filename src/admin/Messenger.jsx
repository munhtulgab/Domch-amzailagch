import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate } from '../lib/util.js';

function timeOf(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const today = new Date();
  return d.toDateString() === today.toDateString() ? `${hh}:${mm}` : `${formatDate(value)} ${hh}:${mm}`;
}

function CopyField({ id, label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.getElementById(id);
      el.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="a-field a-field--wide">
      <label htmlFor={id}>{label}</label>
      <div className="a-copy">
        <input id={id} value={value} readOnly onFocus={(e) => e.target.select()} />
        <button type="button" className="a-btn a-btn--ghost" onClick={copy} disabled={!value}>{copied ? 'Хуулсан' : 'Хуулах'}</button>
      </div>
    </div>
  );
}

function SecretField({ id, label, saved, value, onChange, error, hint }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`a-field a-field--wide${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="a-copy">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={saved.set ? `Хадгалсан (${saved.hint || '••••'}). Солих бол шинээр оруулна уу.` : ''}
        />
        <button type="button" className="a-btn a-btn--ghost" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Нуух' : 'Харах'}</button>
      </div>
      {error ? <p className="a-error">{error}</p> : hint && <p className="a-hint">{hint}</p>}
    </div>
  );
}

function Steps({ steps }) {
  if (!steps || !steps.length) return null;
  const ok = steps.every((s) => s.ok);
  return (
    <div className={`a-card a-check${ok ? ' is-ok' : ' is-bad'}`} role="status">
      <h2>{ok ? 'Messenger холбогдлоо' : 'Холболт дуусаагүй'}</h2>
      <ul>
        {steps.map((s) => (
          <li key={s.key} className={s.ok ? 'is-ok' : 'is-bad'}>
            <span className="a-check__icon" aria-hidden="true">{s.ok ? '✓' : '✕'}</span>
            <span>
              <strong>{s.label}</strong> <span className="sr">{s.ok ? 'амжилттай' : 'амжилтгүй'}</span>
              {s.message && <span className="a-check__msg">{s.message}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const EMPTY = { app_id: '', app_secret: '', page_token: '', page_link: '', button: true, auto_reply: '' };

export function MessengerSettings({ call, onChange }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [steps, setSteps] = useState(null);
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [armed, setArmed] = useState(false);

  const apply = useCallback((c) => {
    setCfg(c);
    setForm({
      app_id: c.app_id || '',
      app_secret: '',
      page_token: '',
      page_link: c.page_link || '',
      button: c.page_token.set ? Boolean(c.button) : true,
      auto_reply: c.auto_reply || '',
    });
  }, []);

  useEffect(() => {
    call('/messenger').then(apply).catch((err) => setError(err.message));
  }, [call, apply]);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const run = async (kind, fn) => {
    setBusy(kind);
    setError('');
    try {
      await fn();
    } catch (err) {
      setErrors(err.fields || {});
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const save = (e) => {
    e.preventDefault();
    run('save', async () => {
      const res = await call('/messenger', { method: 'PUT', body: { ...form, connect: true } });
      apply(res.config);
      setSteps(res.steps);
      onChange?.();
    });
  };
  const test = () => run('test', async () => {
    const res = await call('/messenger/test', { method: 'POST', body: {} });
    apply(res.config);
    setSteps(res.steps);
  });
  const disconnect = () => run('off', async () => {
    const res = await call('/messenger', { method: 'DELETE' });
    apply(res.config);
    setSteps(null);
    setArmed(false);
    onChange?.();
  });

  if (!cfg) return error ? <p className="a-error">{error}</p> : <p className="a-muted">Ачаалж байна…</p>;
  const connected = Boolean(cfg.connected_at);
  const hasCreds = cfg.page_token.set && cfg.app_secret.set && cfg.app_id;
  return (
    <div className="a-stack">
      <div className={`a-card a-status${connected ? ' is-ok' : ''}`}>
        <span className="a-status__dot" aria-hidden="true" />
        <div>
          <strong>{connected ? `Холбогдсон: ${cfg.page_name}` : hasCreds ? 'Холболт дуусаагүй' : 'Холбогдоогүй'}</strong>
          <p className="a-muted">
            {connected
              ? `${formatDate(cfg.connected_at)}-нд холбосон. Page руу бичсэн мессеж «Messenger» цэсэнд ирнэ.`
              : 'Доорх 3 утгыг оруулаад «Хадгалаад холбох» дарна уу. Webhook автоматаар бүртгэгдэнэ.'}
          </p>
        </div>
        {cfg.link && <a className="a-link" href={cfg.link} target="_blank" rel="noopener noreferrer">{cfg.link.replace('https://', '')}</a>}
      </div>

      <Steps steps={steps} />

      <form className="a-form a-card" onSubmit={save} noValidate>
        <div className={`a-field${errors.app_id ? ' has-error' : ''}`}>
          <label htmlFor="m-app">App ID</label>
          <input id="m-app" inputMode="numeric" value={form.app_id} onChange={(e) => set('app_id')(e.target.value.trim())} autoComplete="off" />
          {errors.app_id ? <p className="a-error">{errors.app_id}</p> : <p className="a-hint">Meta апп → App settings → Basic</p>}
        </div>
        <SecretField id="m-secret" label="App Secret" saved={cfg.app_secret} value={form.app_secret} onChange={set('app_secret')}
          error={errors.app_secret} hint="App settings → Basic → App secret → Show" />
        <SecretField id="m-token" label="Page access token" saved={cfg.page_token} value={form.page_token} onChange={set('page_token')}
          error={errors.page_token} hint="Messenger → API Setup → Generate access tokens → Page-ээ сонгоод Generate" />
        <div className={`a-field a-field--wide${errors.page_link ? ' has-error' : ''}`}>
          <label htmlFor="m-link">Messenger холбоос (заавал биш)</label>
          <input id="m-link" type="url" value={form.page_link} onChange={(e) => set('page_link')(e.target.value)}
            placeholder={cfg.page_id ? `https://m.me/${cfg.page_id}` : 'https://m.me/domch.mn'} />
          {errors.page_link ? <p className="a-error">{errors.page_link}</p> : <p className="a-hint">Хоосон бол Page ID-гаар автоматаар үүснэ.</p>}
        </div>
        <div className={`a-field a-field--wide${errors.auto_reply ? ' has-error' : ''}`}>
          <label htmlFor="m-auto">Автомат хариу (заавал биш)</label>
          <textarea id="m-auto" rows={3} maxLength={640} value={form.auto_reply} onChange={(e) => set('auto_reply')(e.target.value)}
            placeholder="Сайн байна уу! Мессежийг тань хүлээн авлаа, удахгүй хариулна." />
          {errors.auto_reply ? <p className="a-error">{errors.auto_reply}</p> : <p className="a-hint">Хүн анх бичихэд нэг удаа илгээгдэнэ (12 цагт нэг удаа). {form.auto_reply.length}/640</p>}
        </div>
        <div className="a-field a-field--check">
          <label htmlFor="m-btn"><input id="m-btn" type="checkbox" checked={form.button} onChange={(e) => set('button')(e.target.checked)} /> Сайт дээр «Messenger-ээр бичих» товч харуулах</label>
        </div>
        {error && <p className="a-error" role="alert">{error}</p>}
        <div className="a-form__actions">
          <button type="submit" className="a-btn" disabled={Boolean(busy)}>{busy === 'save' ? 'Холбож байна…' : 'Хадгалаад холбох'}</button>
          <button type="button" className="a-btn a-btn--ghost" onClick={test} disabled={Boolean(busy) || !hasCreds}>{busy === 'test' ? 'Шалгаж байна…' : 'Холболт шалгах'}</button>
          {hasCreds && (armed ? (
            <button type="button" className="a-btn a-btn--danger" onClick={disconnect} disabled={Boolean(busy)}>Тийм, салгах</button>
          ) : (
            <button type="button" className="a-btn a-btn--ghost" onClick={() => { setArmed(true); setTimeout(() => setArmed(false), 4000); }}>Салгах</button>
          ))}
        </div>
      </form>

      <details className="a-card a-details">
        <summary>Webhook-ийг гараар тохируулах бол</summary>
        <p className="a-muted">Автомат бүртгэл амжилтгүй болбол Meta апп → Messenger → API Setup → Configure webhooks хэсэгт эдгээрийг хуулж оруулаад messages, messaging_postbacks талбарыг сонгоно.</p>
        <div className="a-form">
          <CopyField id="m-cb" label="Callback URL" value={cfg.webhook_url} />
          <CopyField id="m-vt" label="Verify token" value={cfg.verify_token || 'Эхлээд хадгална уу'} />
        </div>
      </details>

      <details className="a-card a-details">
        <summary>Token-уудыг хаанаас авах вэ?</summary>
        <ol className="a-guide">
          <li><a className="a-link" href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">developers.facebook.com/apps</a> → <b>Create app</b> → Messenger-ээр харилцагчтай холбогдох (Engage with customers on Messenger) хувилбарыг сонгоно.</li>
          <li><b>App settings → Basic</b> хэсгээс App ID, App Secret-ийг хуулна.</li>
          <li><b>Messenger → API Setup → Generate access tokens</b> хэсэгт ДОМЧ-ийн Facebook Page-ийг холбоод <b>Generate</b> дарж Page access token-ийг хуулна.</li>
          <li>Энд гурвыг нь оруулаад <b>Хадгалаад холбох</b> дарна. Webhook бүртгэх, Page холбох алхмыг систем өөрөө хийнэ.</li>
          <li>Апп <b>Development</b> горимд байхад зөвхөн апп дээр эрхтэй хүмүүсийн мессеж ирнэ. Бүх хүний мессежийг авахын тулд App Review-ээр <b>pages_messaging</b> эрхийг баталгаажуулж, аппыг <b>Live</b> болгоно.</li>
        </ol>
      </details>
    </div>
  );
}

export function MessengerInbox({ call, onChange, openSettings }) {
  const [cfg, setCfg] = useState(null);
  const [threads, setThreads] = useState(null);
  const [active, setActive] = useState(null);
  const [convo, setConvo] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads((await call('/messenger/threads')).items);
    } catch (err) {
      setError(err.message);
    }
  }, [call]);

  const loadConvo = useCallback(async (psid, quiet = false) => {
    try {
      const data = await call(`/messenger/threads/${encodeURIComponent(psid)}`);
      setConvo(data);
      if (!quiet) onChange?.();
    } catch (err) {
      setError(err.message);
    }
  }, [call, onChange]);

  useEffect(() => {
    call('/messenger').then(setCfg).catch(() => setCfg({}));
    loadThreads();
  }, [call, loadThreads]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadThreads();
      if (active) loadConvo(active, true);
    }, 20000);
    return () => clearInterval(id);
  }, [active, loadThreads, loadConvo]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [convo]);

  const open = async (psid) => {
    setActive(psid);
    setConvo(null);
    setError('');
    await loadConvo(psid);
    loadThreads();
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !active) return;
    setSending(true);
    setError('');
    try {
      await call(`/messenger/threads/${encodeURIComponent(active)}/reply`, { method: 'POST', body: { text } });
      setText('');
      await loadConvo(active, true);
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (!cfg || threads === null) return error ? <p className="a-error">{error}</p> : <p className="a-muted">Ачаалж байна…</p>;
  if (!cfg.connected_at && threads.length === 0) {
    return (
      <div className="a-card a-empty">
        <h2>Messenger холбогдоогүй байна</h2>
        <p className="a-muted">Facebook Page-ийн мессежийг энд хүлээн авч, хариулахын тулд эхлээд token-уудаа оруулна уу.</p>
        <button type="button" className="a-btn" onClick={openSettings}>Тохиргоо → Facebook Messenger</button>
      </div>
    );
  }
  const label = (t) => t.name || `Хэрэглэгч …${String(t.psid).slice(-4)}`;
  return (
    <div className={`a-chat${active ? ' has-active' : ''}`}>
      <div className="a-chat__list a-card">
        <div className="a-chat__bar">
          <strong>Харилцан яриа</strong>
          <button type="button" className="a-btn a-btn--ghost" onClick={loadThreads}>Шинэчлэх</button>
        </div>
        {threads.length === 0 ? <p className="a-muted">Одоогоор мессеж ирээгүй байна.</p> : (
          <ul>
            {threads.map((t) => (
              <li key={t.psid}>
                <button type="button" aria-current={active === t.psid ? 'true' : undefined} onClick={() => open(t.psid)}>
                  <span className="a-chat__name">{label(t)}{t.unread > 0 && <span className="a-badge">{t.unread}</span>}</span>
                  <span className="a-chat__last">{t.last_direction === 'out' ? 'Та: ' : ''}{t.last_text}</span>
                  <span className="a-chat__time">{timeOf(t.last_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="a-chat__panel a-card">
        {!active ? <p className="a-muted">Зүүн талаас харилцан яриа сонгоно уу.</p> : !convo ? <p className="a-muted">Ачаалж байна…</p> : (
          <>
            <div className="a-chat__bar">
              <button type="button" className="a-btn a-btn--ghost a-chat__back" onClick={() => { setActive(null); setConvo(null); }}>← Буцах</button>
              <strong>{convo.name || label({ psid: convo.psid })}</strong>
            </div>
            <ol className="a-msgs">
              {convo.items.map((m) => (
                <li key={m.id} className={`a-msg a-msg--${m.direction}`}>
                  <span className="a-msg__text">{m.text}</span>
                  <span className="a-msg__meta">{m.kind === 'auto' ? 'Автомат хариу · ' : ''}{timeOf(m.created_at)}</span>
                </li>
              ))}
              <li ref={endRef} aria-hidden="true" />
            </ol>
            {convo.can_reply ? (
              <form className="a-reply" onSubmit={send}>
                <label className="sr" htmlFor="m-reply">Хариулт</label>
                <textarea id="m-reply" rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e); }} placeholder="Хариултаа бичнэ үү…" />
                <button type="submit" className="a-btn" disabled={sending || !text.trim()}>{sending ? 'Илгээж байна…' : 'Илгээх'}</button>
              </form>
            ) : (
              <p className="a-note">Сүүлийн мессежээс хойш 24 цаг өнгөрсөн тул Facebook-ийн дүрмээр эндээс хариулах боломжгүй. Facebook Page Inbox-оос хариулна уу.</p>
            )}
            {error && <p className="a-error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
