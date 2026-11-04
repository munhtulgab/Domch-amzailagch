import { useEffect, useState } from 'react';
import { formatDate } from '../lib/util.js';
import { SecretField } from './Messenger.jsx';

export function AiSettings({ call, go }) {
  const [cfg, setCfg] = useState(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [instructions, setInstructions] = useState('');
  const [pause, setPause] = useState(30);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState('');
  const [question, setQuestion] = useState('');
  const [test, setTest] = useState(null);

  const apply = (c) => {
    setCfg(c);
    setModel(c.model || '');
    setEnabled(c.gemini_key.set ? c.enabled : true);
    setInstructions(c.instructions || '');
    setPause(c.pause_minutes ?? 30);
    setKey('');
  };

  useEffect(() => {
    call('/ai').then(apply).catch((err) => setNote({ ok: false, message: err.message }));
  }, [call]);

  const save = async (e, check = false) => {
    e?.preventDefault();
    setBusy(check ? 'check' : 'save');
    setNote(null);
    try {
      const res = await call('/ai', { method: 'PUT', body: { gemini_key: key, model, enabled, instructions, pause_minutes: Number(pause), check } });
      apply(res.config);
      setErrors({});
      setNote(res.check || { ok: true, message: 'Хадгаллаа.' });
    } catch (err) {
      setErrors(err.fields || {});
      setNote({ ok: false, message: err.message });
    } finally {
      setBusy('');
    }
  };

  const ask = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy('test');
    setTest(null);
    try {
      setTest(await call('/ai/test', { method: 'POST', body: { question } }));
    } catch (err) {
      setTest({ error: err.message });
    } finally {
      setBusy('');
    }
  };

  if (!cfg) return note ? <p className="a-error">{note.message}</p> : <p className="a-muted">Ачаалж байна…</p>;
  const ready = cfg.gemini_key.set && cfg.model;
  const on = ready && cfg.enabled;
  const models = cfg.models.includes(model) || !model ? cfg.models : [model, ...cfg.models];
  return (
    <div className="a-stack">
      <div className={`a-card a-status${on ? ' is-ok' : ''}`}>
        <span className="a-status__dot" aria-hidden="true" />
        <div>
          <strong>{on ? `AI идэвхтэй: ${cfg.model}` : ready ? 'AI унтраалттай' : 'AI тохируулаагүй'}</strong>
          <p className="a-muted">
            {on
              ? 'Messenger-ээр ирсэн асуултад мэдлэгийн сан, эмчийн зөвлөгөө, түгээмэл асуултад тулгуурлан автоматаар хариулна.'
              : 'Gemini API key оруулаад хадгална уу. Түлхүүрийг aistudio.google.com/apikey хаягаас үнэгүй авч болно.'}
          </p>
        </div>
        {cfg.last_error && cfg.last_error.message && (
          <p className="a-error a-status__err" role="alert">Сүүлийн алдаа ({formatDate(cfg.last_error.at)}, {cfg.last_error.context}): {cfg.last_error.message}</p>
        )}
      </div>

      <form className="a-form a-card" onSubmit={(e) => save(e)} noValidate>
        <SecretField id="ai-key" label="Gemini API key" saved={cfg.gemini_key} value={key} onChange={setKey}
          error={errors.gemini_key} hint="Google AI Studio → Get API key → Create API key" />
        <div className="a-field">
          <label htmlFor="ai-model">Загвар</label>
          <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.length}>
            {!models.length && <option value="">Key хадгалсны дараа гарна</option>}
            {models.map((m) => <option key={m} value={m}>{m}{/preview|exp|latest/.test(m) ? ' (туршилтын, ачаалал ихтэй байж болно)' : ''}</option>)}
          </select>
          <p className="a-hint">Тогтвортой «flash» загварыг санал болгоно. Сонгосон загвар ачаалалтай бол дараагийн тогтвортой flash загвар автоматаар хариулна.</p>
        </div>
        <div className={`a-field${errors.pause_minutes ? ' has-error' : ''}`}>
          <label htmlFor="ai-pause">Ажилтан хариулсны дараа AI чимээгүй байх</label>
          <select id="ai-pause" value={pause} onChange={(e) => setPause(e.target.value)}>
            {[[0, 'Чимээгүй болохгүй'], [15, '15 минут'], [30, '30 минут'], [60, '1 цаг'], [180, '3 цаг'], [720, '12 цаг']].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <p className="a-hint">Админаас эсвэл Facebook Page Inbox-оос хариулбал тухайн ярианд AI түр зогсоно.</p>
        </div>
        <div className="a-field a-field--check">
          <label htmlFor="ai-on"><input id="ai-on" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Messenger-т AI-аар хариулах</label>
        </div>
        <div className={`a-field a-field--wide${errors.instructions ? ' has-error' : ''}`}>
          <label htmlFor="ai-extra">Нэмэлт заавар (заавал биш)</label>
          <textarea id="ai-extra" rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="Жишээ: Хариултын төгсгөлд онлайн дэлгүүрийн холбоосыг санал болго. Хамтын ажиллагааны асуултад утасны дугаар өг." />
          {errors.instructions ? <p className="a-error">{errors.instructions}</p> : (
            <p className="a-hint">AI зөвхөн мэдлэгийн сан дахь мэдээллээр хариулж, мэдэхгүй зүйлээ ажилтанд шилжүүлнэ. Онош, эмчилгээ зөвлөхгүй.</p>
          )}
        </div>
        {note && <p className={note.ok ? 'a-note' : 'a-error'} role="status">{note.message}</p>}
        <div className="a-form__actions">
          <button type="submit" className="a-btn" disabled={Boolean(busy)}>{busy === 'save' ? 'Хадгалж байна…' : 'Хадгалах'}</button>
          <button type="button" className="a-btn a-btn--ghost" onClick={() => save(null, true)} disabled={Boolean(busy) || !cfg.gemini_key.set}>
            {busy === 'check' ? 'Шалгаж байна…' : 'Key шалгах'}
          </button>
        </div>
      </form>

      <div className="a-card a-stack">
        <h2>AI-ийн мэдлэг</h2>
        <div className="a-cards">
          <button type="button" className="a-stat" onClick={() => go('knowledge')}>
            <span className="a-stat__n">{cfg.counts.knowledge ?? 0}</span><span>Мэдлэгийн сан</span>
          </button>
          <button type="button" className="a-stat" onClick={() => go('tips')}>
            <span className="a-stat__n">{cfg.counts.tips ?? 0}</span><span>Эмчийн зөвлөгөө</span>
          </button>
          <button type="button" className="a-stat" onClick={() => go('faqs')}>
            <span className="a-stat__n">{cfg.counts.faqs ?? 0}</span><span>Түгээмэл асуулт</span>
          </button>
        </div>
        <p className="a-muted">«Жишээ» тэмдэгтэй эмчийн зөвлөгөөг AI ашиглахгүй. Messenger-ийн асуулт, бүтээгдэхүүний үнэ, холбоо барих мэдээллийг мөн ашиглана.</p>
      </div>

      <form className="a-card a-stack" onSubmit={ask}>
        <h2>Туршиж асуух</h2>
        <p className="a-muted">Messenger-т илгээхгүйгээр AI ямар хариулт өгөхийг шалгана.</p>
        <div className="a-reply">
          <label className="sr" htmlFor="ai-q">Асуулт</label>
          <textarea id="ai-q" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Хүүхэд хэдэн наснаас хэрэглэж болох вэ?" />
          <button type="submit" className="a-btn" disabled={busy === 'test' || !ready || !question.trim()}>{busy === 'test' ? 'Бодож байна…' : 'Асуух'}</button>
        </div>
        {test && (test.error ? <p className="a-error" role="alert">{test.error}</p> : (
          <div className="a-ai-answer" role="status">
            <p className="a-msg__text">{test.answer}</p>
            <p className="a-hint">{test.model} · {(test.ms / 1000).toFixed(1)} сек · {test.sources.length} эх сурвалж ашигласан</p>
            <details>
              <summary className="a-hint">Ашигласан мэдлэг</summary>
              <ul className="a-guide">{test.sources.map((s) => <li key={s}>{s}</li>)}</ul>
            </details>
          </div>
        ))}
      </form>
    </div>
  );
}
