import { useState } from 'react';
import { api, track } from '../lib/api.js';
import { CITIES, PARTNER_KINDS, UB, UB_DISTRICTS } from '../data/static.js';
import { Check } from './Icons.jsx';
import { Privacy } from './Privacy.jsx';

function useForm(initial, path, event) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const set = (key) => (e) => {
    const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues((s) => ({ ...s, [key]: v }));
    setErrors((s) => (s[key] ? { ...s, [key]: undefined } : s));
  };
  const submit = async (e, body = values, localCheck) => {
    e.preventDefault();
    const local = localCheck ? localCheck(body) : {};
    if (Object.keys(local).length) {
      setErrors(local);
      setStatus('error');
      setMessage('Маягтын алдааг засна уу.');
      focusFirst(local);
      return;
    }
    setStatus('sending');
    setMessage('');
    try {
      const data = await api(path, { method: 'POST', body });
      setStatus('done');
      setMessage(data.message || 'Хүлээн авлаа.');
      if (event) track(event.name, event.meta ? event.meta(body) : {});
    } catch (err) {
      setStatus('error');
      setErrors(err.fields || {});
      setMessage(err.message);
      if (err.fields) focusFirst(err.fields);
    }
  };
  return { values, set, setValues, errors, status, message, submit };
}

function focusFirst(fields) {
  const first = Object.keys(fields)[0];
  if (!first) return;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-field="${first}"] input, [data-field="${first}"] textarea, [data-field="${first}"] select`);
    if (el) el.focus();
  });
}

export function Field({ name, label, error, required, hint, children }) {
  const id = `f-${name}`;
  return (
    <div className={`field${error ? ' has-error' : ''}`} data-field={name}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span className="req" aria-hidden="true"> *</span>}
        </label>
      )}
      {children(id, {
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined,
      })}
      {hint && !error && <p className="field__hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field__error" id={`${id}-err`}>{error}</p>}
    </div>
  );
}

function Honeypot({ value, onChange }) {
  return (
    <div className="hp" aria-hidden="true">
      <label htmlFor="f-website">Вэбсайт</label>
      <input id="f-website" tabIndex={-1} autoComplete="off" value={value} onChange={onChange} />
    </div>
  );
}

function Consent({ checked, onChange, error, text }) {
  const [policy, setPolicy] = useState(false);
  return (
    <div className={`field field--check${error ? ' has-error' : ''}`} data-field="consent">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={onChange} aria-invalid={error ? true : undefined} />
        <span>{text}</span>
      </label>
      <button type="button" className="linklike" aria-expanded={policy} onClick={() => setPolicy(!policy)}>
        {policy ? 'Нууцлалын бодлогыг хураах' : 'Нууцлалын бодлого'}
      </button>
      {policy && <div className="policy-inline"><Privacy /></div>}
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}

function Done({ message, onClose, again }) {
  return (
    <div className="done" role="status">
      <div className="done__icon"><Check /></div>
      <h3>{message}</h3>
      <div className="done__actions">
        <button type="button" className="btn" onClick={onClose}>Хаах</button>
        {again && <button type="button" className="tlink" onClick={again}>Дахин илгээх</button>}
      </div>
    </div>
  );
}

function FormFoot({ status, message }) {
  return (
    <>
      {status === 'error' && message && <p className="notice notice--error" role="alert">{message}</p>}
      <button className="btn btn--block" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Илгээж байна…' : 'Илгээх'}
      </button>
    </>
  );
}

const len = (v) => String(v || '').trim().length;

export function ReviewForm({ onClose }) {
  const f = useForm({ name: '', rating: 0, size: 'unknown', body: '', consent: false, website: '' }, '/reviews', { name: 'review_submit', meta: (b) => ({ rating: b.rating }) });
  const check = (v) => {
    const e = {};
    if (len(v.name) < 2) e.name = 'Нэрээ оруулна уу.';
    if (!v.rating) e.rating = 'Үнэлгээгээ сонгоно уу.';
    if (len(v.body) < 10) e.body = 'Сэтгэгдлээ 10-аас дээш тэмдэгтээр бичнэ үү.';
    if (!v.consent) e.consent = 'Нийтлэх зөвшөөрлөө тэмдэглэнэ үү.';
    return e;
  };
  if (f.status === 'done') return <Done message={f.message} onClose={onClose} />;
  return (
    <form className="form" onSubmit={(e) => f.submit(e, f.values, check)} noValidate>
      <p className="form__intro">Сэтгэгдлийг шалгасны дараа нийтэлнэ. Үнэлгээ, нэрийг тань сэтгэгдлийн хамт харуулна.</p>
      <Field name="name" label="Нэр эсвэл дэлгэцийн нэр" required error={f.errors.name}>
        {(id, a) => <input id={id} value={f.values.name} onChange={f.set('name')} maxLength={60} autoComplete="nickname" {...a} />}
      </Field>
      <div className={`field${f.errors.rating ? ' has-error' : ''}`} data-field="rating">
        <fieldset className="rate">
          <legend>Үнэлгээ <span className="req" aria-hidden="true">*</span></legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= f.values.rating ? 'on' : ''}>
              <input type="radio" name="rating" value={n} checked={f.values.rating === n} onChange={() => f.set('rating')(n)} />
              <span aria-hidden="true">★</span>
              <span className="sr">{n} од</span>
            </label>
          ))}
        </fieldset>
        {f.errors.rating && <p className="field__error">{f.errors.rating}</p>}
      </div>
      <Field name="size" label="Хэрэглэсэн савлагаа">
        {(id, a) => (
          <select id={id} value={f.values.size} onChange={f.set('size')} {...a}>
            <option value="unknown">Сонгоогүй</option>
            <option value="250">250 мл</option>
            <option value="500">500 мл</option>
          </select>
        )}
      </Field>
      <Field name="body" label="Сэтгэгдэл" required error={f.errors.body} hint={`${len(f.values.body)}/1000`}>
        {(id, a) => <textarea id={id} rows={4} value={f.values.body} onChange={f.set('body')} maxLength={1000} {...a} />}
      </Field>
      <Consent checked={f.values.consent} onChange={f.set('consent')} error={f.errors.consent}
        text="Сэтгэгдлээ сайтад нийтлэхийг зөвшөөрч байна." />
      <Honeypot value={f.values.website} onChange={f.set('website')} />
      <FormFoot status={f.status} message={f.message} />
    </form>
  );
}

export function QuestionForm({ onClose }) {
  const f = useForm({ name: '', contact: '', question: '', consent: false, website: '' }, '/questions', { name: 'question_submit' });
  const check = (v) => {
    const e = {};
    if (len(v.question) < 10) e.question = 'Асуултаа 10-аас дээш тэмдэгтээр бичнэ үү.';
    if (!v.consent) e.consent = 'Мэдээллээ ашиглахыг зөвшөөрнө үү.';
    return e;
  };
  if (f.status === 'done') return <Done message={f.message} onClose={onClose} />;
  return (
    <form className="form" onSubmit={(e) => f.submit(e, f.values, check)} noValidate>
      <p className="form__intro">
        Ирсэн асуултуудаас эмчийн дараагийн зөвлөгөө, видеоны сэдвийг сонгоно. Хувийн хариу өгөх хугацааг амлахгүй.
        Яаралтай шинж тэмдэг байвал эмчид шууд хандана уу.
      </p>
      <Field name="question" label="Таны асуулт" required error={f.errors.question}>
        {(id, a) => <textarea id={id} rows={4} value={f.values.question} onChange={f.set('question')} maxLength={1000} {...a} />}
      </Field>
      <div className="form__row">
        <Field name="name" label="Нэр" error={f.errors.name}>
          {(id, a) => <input id={id} value={f.values.name} onChange={f.set('name')} maxLength={60} autoComplete="name" {...a} />}
        </Field>
        <Field name="contact" label="Утас эсвэл и-мэйл" error={f.errors.contact} hint="Заавал биш">
          {(id, a) => <input id={id} value={f.values.contact} onChange={f.set('contact')} maxLength={120} autoComplete="email" {...a} />}
        </Field>
      </div>
      <Consent checked={f.values.consent} onChange={f.set('consent')} error={f.errors.consent}
        text="Асуултаа эмчийн зөвлөгөөнд ашиглахыг зөвшөөрч байна." />
      <Honeypot value={f.values.website} onChange={f.set('website')} />
      <FormFoot status={f.status} message={f.message} />
    </form>
  );
}

const PARTNER_FIELDS = {
  pharmacy: { org: 'Байгууллагын нэр', location: 'Салбарын байршил', message: 'Хүсэлт' },
  clinic: { org: 'Эмнэлгийн нэр', location: 'Байршил', message: 'Нэмэлт мэдээлэл' },
  corporate: { org: 'Байгууллагын нэр', location: '', message: 'Нэмэлт мэдээлэл' },
  creator: { org: '', location: '', message: 'Хамтрах санаа' },
};

export function PartnerForm({ kind: initialKind = 'pharmacy', onClose }) {
  const f = useForm({
    kind: initialKind, org: '', contact_name: '', phone: '', email: '', location: '', message: '',
    direction: '', size: '', quantity: '', timeline: '', social: '', focus: '', consent: false, website: '',
  }, '/partners', { name: 'partner_submit', meta: (b) => ({ kind: b.kind }) });
  const v = f.values;
  const labels = PARTNER_FIELDS[v.kind];
  const body = () => ({
    kind: v.kind, org: v.org, contact_name: v.contact_name, phone: v.phone, email: v.email, location: v.location,
    message: v.message, consent: v.consent, website: v.website,
    details: { direction: v.direction, size: v.size, quantity: v.quantity, timeline: v.timeline, social: v.social, focus: v.focus },
  });
  const check = () => {
    const e = {};
    if (v.kind !== 'creator' && len(v.org) < 2) e.org = 'Байгууллагын нэрээ оруулна уу.';
    if (len(v.contact_name) < 2) e.contact_name = v.kind === 'creator' ? 'Нэрээ оруулна уу.' : 'Холбоо барих ажилтны нэрийг оруулна уу.';
    if (!len(v.phone) && !len(v.email)) e.phone = 'Утас эсвэл и-мэйлийн аль нэгийг оруулна уу.';
    if (v.kind === 'clinic' && !len(v.direction)) e.direction = 'Хамтрах чиглэлээ бичнэ үү.';
    if (v.kind === 'corporate' && !len(v.quantity)) e.quantity = 'Ойролцоо тоо хэмжээг оруулна уу.';
    if (v.kind === 'creator') {
      if (!len(v.social)) e.social = 'Сошиал хаягаа оруулна уу.';
      if (!len(v.focus)) e.focus = 'Контентын чиглэлээ бичнэ үү.';
      if (len(v.message) < 10) e.message = 'Хамтрах санаагаа 10-аас дээш тэмдэгтээр бичнэ үү.';
    }
    if (!v.consent) e.consent = 'Мэдээллээ ашиглахыг зөвшөөрнө үү.';
    return e;
  };
  if (f.status === 'done') return <Done message={f.message} onClose={onClose} />;
  return (
    <form className="form" onSubmit={(e) => f.submit(e, body(), check)} noValidate>
      <fieldset className="kinds">
        <legend>Хамтын ажиллагааны төрөл</legend>
        {PARTNER_KINDS.map((k) => (
          <label key={k.id} className={v.kind === k.id ? 'on' : ''}>
            <input type="radio" name="kind" value={k.id} checked={v.kind === k.id} onChange={() => f.set('kind')(k.id)} />
            <span className="kinds__t">{k.label}</span>
            <span className="kinds__d">{k.hint}</span>
          </label>
        ))}
      </fieldset>
      {labels.org && (
        <Field name="org" label={labels.org} required error={f.errors.org}>
          {(id, a) => <input id={id} value={v.org} onChange={f.set('org')} maxLength={120} autoComplete="organization" {...a} />}
        </Field>
      )}
      {v.kind === 'clinic' && (
        <Field name="direction" label="Хамтрах чиглэл" required error={f.errors.direction} hint="Жишээ: бүтээгдэхүүн танилцуулах, эмчийн контент">
          {(id, a) => <input id={id} value={v.direction} onChange={f.set('direction')} maxLength={300} {...a} />}
        </Field>
      )}
      {v.kind === 'corporate' && (
        <div className="form__row form__row--3">
          <Field name="size" label="Савлагаа">
            {(id, a) => (
              <select id={id} value={v.size} onChange={f.set('size')} {...a}>
                <option value="">Сонгох</option>
                <option value="250">250 мл</option>
                <option value="500">500 мл</option>
                <option value="both">Хоёулаа</option>
              </select>
            )}
          </Field>
          <Field name="quantity" label="Ойролцоо тоо" required error={f.errors.quantity}>
            {(id, a) => <input id={id} value={v.quantity} onChange={f.set('quantity')} maxLength={300} placeholder="Жишээ: 200 ширхэг" {...a} />}
          </Field>
          <Field name="timeline" label="Хугацаа">
            {(id, a) => <input id={id} value={v.timeline} onChange={f.set('timeline')} maxLength={300} placeholder="Жишээ: 12-р сар" {...a} />}
          </Field>
        </div>
      )}
      {v.kind === 'creator' && (
        <div className="form__row">
          <Field name="social" label="Сошиал хаяг" required error={f.errors.social}>
            {(id, a) => <input id={id} value={v.social} onChange={f.set('social')} maxLength={300} placeholder="@нэр эсвэл холбоос" {...a} />}
          </Field>
          <Field name="focus" label="Контентын чиглэл" required error={f.errors.focus}>
            {(id, a) => <input id={id} value={v.focus} onChange={f.set('focus')} maxLength={300} placeholder="Жишээ: гэр бүл, эрүүл мэнд" {...a} />}
          </Field>
        </div>
      )}
      {labels.location && (
        <Field name="location" label={labels.location} error={f.errors.location}>
          {(id, a) => <input id={id} value={v.location} onChange={f.set('location')} maxLength={200} {...a} />}
        </Field>
      )}
      <Field name="contact_name" label={v.kind === 'creator' ? 'Нэр' : 'Холбоо барих ажилтан'} required error={f.errors.contact_name}>
        {(id, a) => <input id={id} value={v.contact_name} onChange={f.set('contact_name')} maxLength={80} autoComplete="name" {...a} />}
      </Field>
      <div className="form__row">
        <Field name="phone" label="Утас" error={f.errors.phone}>
          {(id, a) => <input id={id} type="tel" value={v.phone} onChange={f.set('phone')} maxLength={40} autoComplete="tel" {...a} />}
        </Field>
        <Field name="email" label="И-мэйл" error={f.errors.email}>
          {(id, a) => <input id={id} type="email" value={v.email} onChange={f.set('email')} maxLength={120} autoComplete="email" {...a} />}
        </Field>
      </div>
      <Field name="message" label={labels.message} required={v.kind === 'creator'} error={f.errors.message}>
        {(id, a) => <textarea id={id} rows={3} value={v.message} onChange={f.set('message')} maxLength={2000} {...a} />}
      </Field>
      <Consent checked={v.consent} onChange={f.set('consent')} error={f.errors.consent}
        text="Хүсэлтэд хариулах зорилгоор мэдээллээ ашиглахыг зөвшөөрч байна." />
      <Honeypot value={v.website} onChange={f.set('website')} />
      <FormFoot status={f.status} message={f.message} />
    </form>
  );
}

export function LocationForm({ city = '', district = '', onClose }) {
  const f = useForm({ city: city || UB, district: district || '', note: '', contact: '', consent: false, website: '' }, '/location-requests', { name: 'location_request', meta: (b) => ({ city: b.city }) });
  const v = f.values;
  const check = (b) => (len(b.contact) && !b.consent ? { consent: 'Холбоо барих мэдээллээ ашиглахыг зөвшөөрнө үү.' } : {});
  if (f.status === 'done') return <Done message={f.message} onClose={onClose} />;
  return (
    <form className="form" onSubmit={(e) => f.submit(e, v, check)} noValidate>
      <p className="form__intro">Хаана Домч худалдаалахыг хүсэж байгаагаа бидэнд хэлээрэй. Борлуулалтын баг саналыг тань судална.</p>
      <div className="form__row">
        <Field name="city" label="Хот / аймаг" required error={f.errors.city}>
          {(id, a) => (
            <select id={id} value={v.city} onChange={(e) => { f.set('city')(e); f.setValues((s) => ({ ...s, district: '' })); }} {...a}>
              {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <Field name="district" label={v.city === UB ? 'Дүүрэг' : 'Сум'} error={f.errors.district}>
          {(id, a) => (v.city === UB ? (
            <select id={id} value={v.district} onChange={f.set('district')} {...a}>
              <option value="">Сонгох</option>
              {UB_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <input id={id} value={v.district} onChange={f.set('district')} maxLength={60} {...a} />
          ))}
        </Field>
      </div>
      <Field name="note" label="Хаана авах боломжтой бол тохиромжтой вэ?" error={f.errors.note} hint="Жишээ: ойролцоох эмийн сан, дэлгүүрийн нэр">
        {(id, a) => <textarea id={id} rows={3} value={v.note} onChange={f.set('note')} maxLength={500} {...a} />}
      </Field>
      <Field name="contact" label="Утас эсвэл и-мэйл" error={f.errors.contact} hint="Заавал биш. Салбар нээгдэхэд мэдэгдэх боломжтой.">
        {(id, a) => <input id={id} value={v.contact} onChange={f.set('contact')} maxLength={120} {...a} />}
      </Field>
      {len(v.contact) > 0 && (
        <Consent checked={v.consent} onChange={f.set('consent')} error={f.errors.consent}
          text="Салбар нээгдэхэд надтай холбогдохын тулд утас, и-мэйлийг минь ашиглахыг зөвшөөрч байна." />
      )}
      <Honeypot value={v.website} onChange={f.set('website')} />
      <FormFoot status={f.status} message={f.message} />
    </form>
  );
}
