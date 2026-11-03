import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';
import { Privacy } from './Privacy.jsx';
import { LocationForm, PartnerForm, QuestionForm, ReviewForm } from './Forms.jsx';
import { VideoBox } from './Media.jsx';
import { Arrow, Search } from './Icons.jsx';
import { api, query, track } from '../lib/api.js';
import { SECTIONS, TIP_KINDS } from '../data/static.js';
import { fold, formatDate } from '../lib/util.js';

function TipView({ tip }) {
  return (
    <div className="prose">
      {tip.video_url && <VideoBox url={tip.video_url} title={tip.title} meta={{ tip: tip.id }} />}
      <p className="meta">
        {[TIP_KINDS[tip.kind], [tip.doctor_name, tip.doctor_title].filter(Boolean).join(', '), formatDate(tip.published_at)].filter(Boolean).join(' · ')}
      </p>
      {tip.summary && <p className="lead lead--sm">{tip.summary}</p>}
      {tip.body ? tip.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <p>Дэлгэрэнгүй тайлбарыг удахгүй нэмнэ.</p>}
      {tip.source && <p className="meta">Эх сурвалж: {tip.source}</p>}
    </div>
  );
}

function SearchView({ content, onPick }) {
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const local = useMemo(() => {
    const needle = fold(q.trim());
    if (needle.length < 2) return [];
    const out = SECTIONS.filter((s) => fold(`${s.title} ${s.keys}`).includes(needle)).map((s) => ({ type: 'section', ...s }));
    content.faqs.forEach((f) => {
      if (fold(`${f.question} ${f.answer}`).includes(needle)) out.push({ type: 'faq', title: f.question, snippet: f.answer, go: 'faq' });
    });
    return out;
  }, [q, content.faqs]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setRemote([]);
      return undefined;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api(`/search${query({ q: needle })}`, { signal: ctrl.signal });
        setRemote((data.results || []).filter((r) => r.type === 'branch' || r.type === 'tip'));
        track('search', { q: needle.slice(0, 40) });
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const results = [...local, ...remote];
  const label = { section: 'Хэсэг', faq: 'Асуулт', tip: 'Зөвлөгөө', branch: 'Салбар' };
  return (
    <div className="search">
      <label className="search__box" htmlFor="site-search">
        <Search />
        <input id="site-search" ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найрлага, салбар, асуулт…" autoComplete="off" />
      </label>
      {q.trim().length >= 2 && (
        <div className="search__results" aria-live="polite">
          {results.length > 0 ? (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.type}-${r.title}-${i}`}>
                  <button type="button" onClick={() => onPick(r)}>
                    <span className="search__type">{label[r.type] || ''}</span>
                    <span className="search__t">{r.title}</span>
                    {r.snippet && <span className="search__s">{r.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <p className="meta">Хайж байна…</p>
          ) : (
            <div className="search__empty">
              <p>«{q.trim()}» гэсэн илэрц олдсонгүй. Эдгээр хэсгийг үзнэ үү:</p>
              <div className="search__suggest">
                {[['where', 'Хаанаас авах вэ?'], ['ingredients', 'Орц, найрлага'], ['faq', 'Түгээмэл асуулт']].map(([go, title]) => (
                  <button key={go} type="button" className="tlink" onClick={() => onPick({ go })}>{title} <Arrow /></button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Dialogs({ dialog, onClose, actions, content }) {
  if (!dialog) return null;
  const { type, props = {} } = dialog;
  switch (type) {
    case 'review':
      return <Modal title="Сэтгэгдэл үлдээх" onClose={onClose}><ReviewForm onClose={onClose} /></Modal>;
    case 'question':
      return <Modal title="Эмчээс асууя" onClose={onClose}><QuestionForm onClose={onClose} /></Modal>;
    case 'partner':
      return <Modal title="Хамтран ажиллах хүсэлт" onClose={onClose} wide><PartnerForm kind={props.kind} onClose={onClose} /></Modal>;
    case 'location':
      return <Modal title="Миний ойролцоо байхгүй байна" onClose={onClose}><LocationForm city={props.city} district={props.district} onClose={onClose} /></Modal>;
    case 'tip':
      return <Modal title={props.tip.title} onClose={onClose} wide><TipView tip={props.tip} /></Modal>;
    case 'search':
      return (
        <Modal title="Хайх" onClose={onClose} wide>
          <SearchView
            content={content}
            onPick={(r) => {
              onClose();
              setTimeout(() => actions.goTo(r.go), 60);
            }}
          />
        </Modal>
      );
    case 'privacy':
      return (
        <Modal title="Нууцлалын бодлого" onClose={onClose}>
          <Privacy />
        </Modal>
      );
    default:
      return null;
  }
}
