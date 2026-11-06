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

export function SecretField({ id, label, saved, value, onChange, error, hint }) {
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

function stepState(s) {
  return s.ok ? 'ok' : s.warn ? 'warn' : 'bad';
}

const STEP_ICON = { ok: '✓', warn: '!', bad: '✕' };
const STEP_WORD = { ok: 'амжилттай', warn: 'гараар хийх алхам', bad: 'амжилтгүй' };

function Steps({ steps }) {
  if (!steps || !steps.length) return null;
  const states = steps.map(stepState);
  const overall = states.includes('bad') ? 'bad' : states.includes('warn') ? 'warn' : 'ok';
  const title = { ok: 'Messenger холбогдлоо', warn: 'Бараг бэлэн: нэг алхмыг гараар хийнэ', bad: 'Холболт дуусаагүй' }[overall];
  return (
    <div className={`a-card a-check is-${overall}`} role="status">
      <h2>{title}</h2>
      <ul>
        {steps.map((s) => {
          const st = stepState(s);
          return (
            <li key={s.key} className={`is-${st}`}>
              <span className="a-check__icon" aria-hidden="true">{STEP_ICON[st]}</span>
              <span>
                <strong>{s.label}</strong><span className="sr"> — {STEP_WORD[st]}. </span>
                {s.message && <span className="a-check__msg">{s.message}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const EMPTY = { app_id: '', app_secret: '', page_token: '', ig_token: '', page_link: '', button: true };

const DEFAULT_GREETING = 'ДОМЧ — Монгол жамц давстай, спирт агуулаагүй ам зайлагч. Асуух зүйлээ бичээрэй!';
const DEFAULT_WELCOME = 'Сайн байна уу! ДОМЧ ам зайлагчийн хуудсанд тавтай морил. Доорх асуултаас сонгох эсвэл асуултаа бичээрэй, бид удахгүй хариулна.';
const defaultFaq = (site) => [
  { q: 'Хаанаас авах вэ?', a: `Худалдаалах цэгүүдийг газрын зурагтай нь эндээс харна уу: ${site}/#where` },
  { q: 'Үнэ хэд вэ?', a: `Домч 250 мл болон 500 мл савлагаатай. Үнийг ойрын салбараас лавлана уу: ${site}/#where` },
  { q: 'Орц найрлага', a: `Шүүсэн ус, жамц давс, хадаасан цэцгийн ханд (башир цэцэг), гаа, глицерин, FD&C Blue No.1. Спирт агуулаагүй. Дэлгэрэнгүй: ${site}/#ingredients` },
  { q: 'Хэрэглэх заавар', a: `Шошгонд заасан хэмжээгээр хэмжиж, амаа сайтар зайлаад нулимна, залгихгүй. Хүүхэд эцэг эхийн хяналтан дор хэрэглэнэ. Дэлгэрэнгүй: ${site}/#usage` },
];

function WelcomeSettings({ cfg, call, onSaved }) {
  const [greeting, setGreeting] = useState(cfg.greeting || '');
  const [welcome, setWelcome] = useState(cfg.auto_reply || '');
  const [faq, setFaq] = useState(cfg.faq && cfg.faq.length ? cfg.faq : []);
  const [errors, setErrors] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const empty = !greeting.trim() && !welcome.trim() && faq.length === 0;

  const fillDefaults = () => {
    setGreeting(DEFAULT_GREETING);
    setWelcome(DEFAULT_WELCOME);
    setFaq(defaultFaq(cfg.site_url));
    setResult(null);
  };
  const setItem = (i, key, value) => {
    setFaq((list) => list.map((item, j) => (j === i ? { ...item, [key]: value } : item)));
    setErrors((e) => ({ ...e, [`faq.${i}.${key}`]: undefined }));
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await call('/messenger/welcome', { method: 'PUT', body: { greeting, auto_reply: welcome, faq } });
      setErrors({});
      setResult(res.sync);
      onSaved(res.config);
    } catch (err) {
      setErrors(err.fields || {});
      setResult({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };
  const shown = faq.filter((f) => f.q.trim());
  return (
    <form className="a-card a-welcome" onSubmit={save} noValidate>
      <div className="a-welcome__form">
        <h2>Мэндчилгээ ба автомат хариу</h2>
        <p className="a-muted">
          Хэн нэгэн Page руу анх бичихэд (эсвэл 24 цагаас дээш завсарлаад дахин бичихэд) мэндчилгээ болон асуултын товчнууд
          автоматаар очно. Товч дарахад тухайн хариулт шууд илгээгдэнэ.
        </p>
        {empty && (
          <button type="button" className="a-btn a-btn--ghost" onClick={fillDefaults}>ДОМЧ-ийн жишээ мэдээллээр бөглөх</button>
        )}
        <div className={`a-field${errors.greeting ? ' has-error' : ''}`}>
          <label htmlFor="w-greet">Эхлэх дэлгэцийн текст</label>
          <input id="w-greet" maxLength={160} value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={DEFAULT_GREETING} />
          {errors.greeting ? <p className="a-error">{errors.greeting}</p> : <p className="a-hint">Шинэ хүн чат нээхэд мессеж бичихээс өмнө харагдана. {greeting.length}/160</p>}
        </div>
        <div className={`a-field${errors.auto_reply ? ' has-error' : ''}`}>
          <label htmlFor="w-text">Мэндчилгээ мессеж</label>
          <textarea id="w-text" rows={3} maxLength={640} value={welcome} onChange={(e) => setWelcome(e.target.value)} placeholder={DEFAULT_WELCOME} />
          {errors.auto_reply ? <p className="a-error">{errors.auto_reply}</p> : <p className="a-hint">Анх бичсэн хүнд автоматаар очно. {welcome.length}/640</p>}
        </div>
        <fieldset className="a-faq">
          <legend>Түгээмэл асуулт, хариулт (4 хүртэл)</legend>
          {faq.map((item, i) => (
            <div className="a-faq__row" key={i}>
              <div className={`a-field${errors[`faq.${i}.q`] ? ' has-error' : ''}`}>
                <label htmlFor={`w-q${i}`}>Асуулт {i + 1}</label>
                <input id={`w-q${i}`} maxLength={20} value={item.q} onChange={(e) => setItem(i, 'q', e.target.value)} placeholder="Хаанаас авах вэ?" />
                {errors[`faq.${i}.q`] ? <p className="a-error">{errors[`faq.${i}.q`]}</p> : <p className="a-hint">Товчны бичиг. {item.q.length}/20</p>}
              </div>
              <div className={`a-field${errors[`faq.${i}.a`] ? ' has-error' : ''}`}>
                <label htmlFor={`w-a${i}`}>Хариулт {i + 1}</label>
                <textarea id={`w-a${i}`} rows={2} maxLength={640} value={item.a} onChange={(e) => setItem(i, 'a', e.target.value)} />
                {errors[`faq.${i}.a`] && <p className="a-error">{errors[`faq.${i}.a`]}</p>}
              </div>
              <button type="button" className="a-btn a-btn--ghost a-faq__del" onClick={() => setFaq((list) => list.filter((_, j) => j !== i))}
                aria-label={`Асуулт ${i + 1}-ийг хасах`}>Хасах</button>
            </div>
          ))}
          {faq.length < 4 && (
            <button type="button" className="a-btn a-btn--ghost" onClick={() => setFaq((list) => [...list, { q: '', a: '' }])}>Асуулт нэмэх</button>
          )}
        </fieldset>
        {result && <p className={result.ok ? 'a-note' : 'a-error'} role="status">{result.ok ? `Хадгаллаа. ${result.message} Туршихын тулд Page руу бичээд үзээрэй.` : result.message}</p>}
        <div className="a-form__actions">
          <button type="submit" className="a-btn" disabled={busy}>{busy ? 'Хадгалж байна…' : 'Хадгалах'}</button>
        </div>
      </div>
      <div className="a-welcome__preview" aria-label="Messenger дээр харагдах байдал">
        <p className="a-hint">Урьдчилан харах</p>
        <div className="a-phone">
          <p className="a-phone__page">{cfg.page_name || 'ДОМЧ'}</p>
          {greeting.trim() && <p className="a-phone__greet">{greeting}</p>}
          {shown.length > 0 && (
            <div className="a-phone__ice">{shown.map((f, i) => <span key={i} className="a-chip">{f.q}</span>)}</div>
          )}
          {welcome.trim() && <p className="a-phone__bubble">{welcome}</p>}
          {welcome.trim() && shown.length > 0 && (
            <div className="a-phone__quick">{shown.map((f, i) => <span key={i} className="a-chip a-chip--accent">{f.q}</span>)}</div>
          )}
          {!greeting.trim() && !welcome.trim() && shown.length === 0 && <p className="a-phone__greet">Мэндчилгээ тохируулаагүй байна.</p>}
        </div>
      </div>
    </form>
  );
}

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
      ig_token: '',
      page_link: c.page_link || '',
      button: c.page_token.set ? Boolean(c.button) : true,
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
  const clearIgToken = () => run('save', async () => {
    const res = await call('/messenger', { method: 'PUT', body: { ig_token_clear: true, connect: true } });
    apply(res.config);
    setSteps(res.steps);
  });
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
          <strong>{connected ? `Холбогдсон: ${cfg.page_name || `Page ${cfg.page_id}`}` : hasCreds ? 'Холболт дуусаагүй' : 'Холбогдоогүй'}</strong>
          <p className="a-muted">
            {!connected
              ? 'Доорх 3 утгыг оруулаад «Хадгалаад холбох» дарна уу. Webhook автоматаар бүртгэгдэнэ.'
              : cfg.last_event_at
                ? `Ажиллаж байна. Facebook-ээс сүүлд ${formatDate(cfg.last_event_at)}-нд мэдээлэл ирсэн.`
                : cfg.page_subscribed === 'manual'
                  ? 'Meta апп дээр Page-ийн «Add subscriptions»-ийг хийсний дараа Page руу нэг мессеж бичиж шалгаарай. Ирсэн мессеж «Messenger» цэсэнд гарна.'
                  : `${formatDate(cfg.connected_at)}-нд холбосон. Page руу бичсэн мессеж «Messenger» цэсэнд ирнэ.`}
          </p>
        </div>
        {cfg.link && <a className="a-link" href={cfg.link} target="_blank" rel="noopener noreferrer">{cfg.link.replace('https://', '')}</a>}
        {cfg.last_error && cfg.last_error.message && (
          <p className="a-error a-status__err" role="alert">Сүүлийн алдаа ({timeOf(cfg.last_error.at)}, {cfg.last_error.context}): {cfg.last_error.message}</p>
        )}
        {cfg.page_token.set && (
          <p className={`a-status__err ${cfg.ig_status === '1' ? 'a-note' : 'a-muted'}`}>
            {cfg.ig_status === '1'
              ? `Instagram холбогдсон: ${cfg.ig_username ? `@${cfg.ig_username}` : cfg.ig_id}. Instagram-ийн DM мөн «Messenger» цэсэнд ирж, AI хариулна.`
              : cfg.ig_status === 'pending'
                ? 'Instagram-ийн webhook бүртгэгдсэн. Instagram-аас ДОМЧ руу нэг DM ирэхэд аккаунтыг автоматаар танина.'
                : cfg.ig_status === 'error'
                  ? 'Instagram-ийг холбож чадсангүй. Доорх алхмын тайлбарыг харна уу.'
                  : 'Instagram холбогдоогүй. Доорх «Instagram-ийг холбох» зааврыг харна уу.'}
          </p>
        )}
        {connected && cfg.webhook_saved && cfg.webhook_saved !== cfg.webhook_url && (
          <p className="a-muted a-status__err">
            Webhook одоогоор хуучин хаяг дээр бүртгэлтэй ({cfg.webhook_saved.replace('https://', '').replace('/api/messenger/webhook', '')}).
            Дараагийн мессеж ирэхэд {cfg.webhook_url.replace('https://', '').replace('/api/messenger/webhook', '')} руу автоматаар шилжинэ, эсвэл «Холболт шалгах» дарна уу.
          </p>
        )}
        {cfg.last_decision && cfg.last_decision.reason && (
          <p className="a-muted a-status__err">Сүүлийн мессеж ({timeOf(cfg.last_decision.at)}): {cfg.last_decision.reason}</p>
        )}
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
          error={errors.page_token}
          hint="Нэг token Messenger, Instagram хоёуланд: апп-ийн админ аккаунтаар Graph API Explorer → User Token (pages_show_list, pages_messaging, pages_manage_metadata, instagram_basic, instagram_manage_messages). Систем хугацаагүй Page token болгоно." />
        <details className="a-field a-field--wide a-details a-details--inline" open={Boolean(cfg.ig_token && cfg.ig_token.set)}>
          <summary>Instagram-д тусдаа token (заавал биш)</summary>
          <SecretField id="m-igtoken" label="Instagram token" saved={cfg.ig_token || { set: false }} value={form.ig_token}
            onChange={set('ig_token')} error={errors.ig_token}
            hint="Ихэвчлэн хэрэггүй. Дээрх token Instagram-ийн эрхгүй бол энд System user эсвэл Graph API Explorer-ийн token оруулна. Messenger дээрх token-оороо ажилласаар байна." />
          {cfg.ig_token && cfg.ig_token.set && (
            <p className="a-hint">
              <button type="button" className="a-link" onClick={clearIgToken} disabled={Boolean(busy)}>Instagram token-ийг арилгах</button>
              {' '}— Instagram дээрх нэг token-оор ажиллана.
            </p>
          )}
        </details>
        <div className={`a-field a-field--wide${errors.page_link ? ' has-error' : ''}`}>
          <label htmlFor="m-link">Messenger холбоос (заавал биш)</label>
          <input id="m-link" type="url" value={form.page_link} onChange={(e) => set('page_link')(e.target.value)}
            placeholder={cfg.page_id ? `https://m.me/${cfg.page_id}` : 'https://m.me/domch.mn'} />
          {errors.page_link ? <p className="a-error">{errors.page_link}</p> : <p className="a-hint">Хоосон бол Page ID-гаар автоматаар үүснэ.</p>}
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

      {hasCreds && <WelcomeSettings cfg={cfg} call={call} onSaved={setCfg} />}

      <details className="a-card a-details" open={cfg.page_token.set && cfg.ig_status !== '1'}>
        <summary>Instagram-ийг холбох</summary>
        <p className="a-muted">Instagram-ийн DM нь энэ Facebook Page-ийн token-оор, Messenger-тэй нэг дор ажиллана. Тусдаа token хэрэггүй.</p>
        <ol className="a-guide">
          <li>Instagram аккаунтаа <b>professional</b> (Business эсвэл Creator) болгож, ДОМЧ-ийн Facebook Page-тэй холбоно: Meta Business Suite → Тохиргоо → Instagram аккаунт.</li>
          <li>Instagram апп → Тохиргоо → <b>Мессеж ба story-ийн хариу</b> → <b>Холбогдсон хэрэгслүүд</b> → <b>Allow access to messages</b>-ийг асаана.</li>
          <li>ДОМЧ апп-ийн <b>админ</b> Facebook аккаунтаар нэвтэрч <a className="a-link" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer">Graph API Explorer</a>-ийг нээж: <b>Meta App</b> — өөрийн апп, <b>User or Page</b> — User Token, <b>Permissions</b> — pages_show_list, pages_messaging, pages_manage_metadata, instagram_basic, instagram_manage_messages. <b>Generate Access Token</b> дарна.</li>
          <li>Нээгдэх Facebook-ийн цонхонд ДОМЧ-ийн <b>Page</b>-ийг болон <b>Instagram аккаунтыг</b> сонгож зөвшөөрнө. Өмнө нь зөвшөөрсөн бол «Edit previous settings» дарж Instagram аккаунтыг нэмж сонгоно.</li>
          <li>Гарсан token-ийг хуулж дээрх «Page access token» талбарт оруулаад <b>Хадгалаад холбох</b> дарна. Систем түүнийг хугацаагүй Page token болгож хадгална. «Instagram DM» алхам ✓ болно.</li>
          <li className="a-muted">Messenger-ийн «Generate access tokens» товчоор үүсгэсэн token-д Instagram-ийн эрх ордоггүй, Business Settings-ийн System user token-оор Messenger зөвхөн апп дээр эрхтэй хүмүүст хариулдаг. Тиймээс админ аккаунтын Graph API Explorer-ийн token хамгийн тохиромжтой.</li>
          <li>Instagram-аас ДОМЧ руу нэг мессеж бичиж шалгаарай. Апп Development горимд байхад зөвхөн апп дээр эрхтэй хүний мессеж ирнэ.</li>
        </ol>
      </details>

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

function Channel({ value }) {
  const ig = value === 'instagram';
  return <span className={`a-channel a-channel--${ig ? 'ig' : 'fb'}`} title={ig ? 'Instagram' : 'Messenger'}>{ig ? 'IG' : 'FB'}</span>;
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

  const toggleAi = async (paused) => {
    try {
      const res = await call(`/messenger/threads/${encodeURIComponent(active)}/ai`, { method: 'POST', body: { paused } });
      setConvo((c) => ({ ...c, ai_paused_until: res.ai_paused_until }));
    } catch (err) {
      setError(err.message);
    }
  };

  const sendWelcome = async () => {
    setSending(true);
    setError('');
    try {
      await call(`/messenger/threads/${encodeURIComponent(active)}/welcome`, { method: 'POST', body: {} });
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
                  <span className="a-chat__name">
                    <Channel value={t.channel} />{label(t)}{t.unread > 0 && <span className="a-badge">{t.unread}</span>}
                  </span>
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
              <strong className="a-chat__who"><Channel value={convo.channel} />{convo.name || label({ psid: convo.psid })}</strong>
              {convo.can_reply && cfg.auto_reply && (
                <button type="button" className="a-btn a-btn--ghost" onClick={sendWelcome} disabled={sending}>Мэндчилгээ илгээх</button>
              )}
            </div>
            {convo.ai_on && (
              <div className={`a-ai-state${convo.ai_paused_until ? ' is-paused' : ''}`}>
                <span>
                  {convo.ai_paused_until
                    ? (convo.ai_paused_until > '2100' ? 'Энэ ярианд AI зогссон.' : `AI ${timeOf(convo.ai_paused_until)} хүртэл түр зогссон (ажилтан хариулсан).`)
                    : 'AI энэ ярианд автоматаар хариулна.'}
                </span>
                <button type="button" className="a-btn a-btn--ghost" onClick={() => toggleAi(!convo.ai_paused_until)} disabled={sending}>
                  {convo.ai_paused_until ? 'AI-г үргэлжлүүлэх' : 'AI-г зогсоох'}
                </button>
              </div>
            )}
            <ol className="a-msgs">
              {convo.items.map((m) => (
                <li key={m.id} className={`a-msg a-msg--${m.direction}`}>
                  <span className="a-msg__text">{m.text}</span>
                  <span className="a-msg__meta">{{ auto: 'Автомат хариу · ', ai: 'AI хариу · ', inbox: 'Page Inbox · ' }[m.kind] || ''}{timeOf(m.created_at)}</span>
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
