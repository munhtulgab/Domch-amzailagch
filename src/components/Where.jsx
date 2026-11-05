import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, query, track } from '../lib/api.js';
import { CITIES, UB, UB_DISTRICTS } from '../data/static.js';
import { distanceKm, formatDate, useInView } from '../lib/util.js';
import { External, Info, Locate, Phone, Pin } from './Icons.jsx';

const BranchMap = lazy(() => import('./BranchMap.jsx'));

// "7585-3311/4, 7007-4411" → two numbers; "/4" is an extension, dialled after a pause
function phones(value) {
  return String(value || '').split(/\s*[,;]\s*/).map((label) => label.trim()).filter(Boolean).map((label) => {
    const [main, ext] = label.split('/');
    const dial = main.replace(/[^\d+]/g, '');
    return { label, dial: ext && /^\d+$/.test(ext.trim()) ? `${dial},${ext.trim()}` : dial };
  }).filter((p) => p.dial.length >= 6);
}

function directionsUrl(b) {
  if (b.lat != null && b.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([b.chain, b.name, b.address, b.city].filter(Boolean).join(' '))}`;
}

export function Where({ filters, settings, actions }) {
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [chain, setChain] = useState('');
  const [size, setSize] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState({ status: 'idle', items: [], error: '' });
  const [origin, setOrigin] = useState(null);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [mapRef, mapVisible] = useInView();

  const districts = useMemo(() => {
    if (!city) return [];
    const known = (filters.districts && filters.districts[city]) || [];
    return city === UB ? Array.from(new Set([...UB_DISTRICTS, ...known])) : known;
  }, [city, filters]);

  const search = async (overrides = {}, reason = 'search') => {
    const params = { city, district, chain, size, q, ...overrides };
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const data = await api(`/branches${query(params)}`);
      setState({ status: 'done', items: data.items || [], error: '' });
      if (reason === 'search') track('branch_search', { city: params.city, district: params.district, chain: params.chain, size: params.size });
    } catch (err) {
      setState({ status: 'error', items: [], error: err.message });
    }
  };

  useEffect(() => {
    search({}, 'initial');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    if (!origin) return state.items;
    return state.items
      .map((b) => ({ ...b, km: b.lat != null && b.lng != null ? distanceKm(origin, { lat: b.lat, lng: b.lng }) : null }))
      .sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
  }, [state.items, origin]);

  const locate = () => {
    if (!navigator.geolocation) {
      actions.toast('Таны төхөөрөмж байршил тодорхойлох боломжгүй байна. Дүүргээр хайна уу.', 'error');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        actions.toast('Байршлын зөвшөөрөл өгөөгүй тул ойрын салбарыг эрэмбэлж чадсангүй. Дүүргээр хайна уу.', 'error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const onSubmit = (e) => {
    e.preventDefault();
    search();
  };
  const pickChain = (value) => {
    const next = chain === value ? '' : value;
    setChain(next);
    search({ chain: next });
  };
  const onlineStore = settings.online_store;

  return (
    <section className="sec" id="where" aria-labelledby="where-title">
      <div className="wrap">
        <p className="eyebrow">Худалдаалах цэг</p>
        <h2 className="h2" id="where-title">Хаанаас <em>авах вэ?</em></h2>
        <p className="body">Хот, аймаг болон дүүргээ сонгоод ойрын салбараа олоорой.</p>
        <div className="where-panel">
          <div>
            <form className="find" onSubmit={onSubmit} role="search" aria-label="Салбар хайх">
              <div className="field">
                <label htmlFor="w-city">Хот / аймаг</label>
                <select id="w-city" value={city} onChange={(e) => { setCity(e.target.value); setDistrict(''); }}>
                  <option value="">Бүх байршил</option>
                  {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="w-district">Дүүрэг / сум</label>
                <select id="w-district" value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!districts.length}>
                  <option value="">{districts.length ? 'Бүгд' : 'Хот, аймгаа сонгоно уу'}</option>
                  {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="w-size">Савлагаа</label>
                <select id="w-size" value={size} onChange={(e) => setSize(e.target.value)}>
                  <option value="">Бүгд</option>
                  <option value="250">250 мл</option>
                  <option value="500">500 мл</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="w-q">Салбар, хаяг</label>
                <input id="w-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Жишээ: Зайсан" />
              </div>
              <button className="btn" type="submit" disabled={state.status === 'loading'}>
                {state.status === 'loading' ? 'Хайж байна…' : 'Салбар олох'}
              </button>
            </form>
            <button type="button" className="btn btn--ghost locate" onClick={locate} disabled={locating}>
              <Locate /> {locating ? 'Байршил тодорхойлж байна…' : origin ? 'Ойрын салбараар эрэмбэлсэн' : 'Миний ойролцоо'}
            </button>
            {filters.chains && filters.chains.length > 0 && (
              <div className="chains">
                <p>Хамтрагч эмийн сангууд</p>
                <div>
                  {filters.chains.map((c) => (
                    <button key={c} type="button" aria-pressed={chain === c} onClick={() => pickChain(c)}>{c}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="map-wrap" ref={mapRef}>
            {mapVisible ? (
              <Suspense fallback={<div className="map map--loading">Газрын зураг ачаалж байна…</div>}>
                <BranchMap items={items} selected={selected} onSelect={setSelected} origin={origin} />
              </Suspense>
            ) : (
              <div className="map map--loading">Газрын зураг</div>
            )}
          </div>
        </div>

        <div className="results" aria-live="polite">
          {state.status === 'error' && <p className="notice notice--error">{state.error}</p>}
          {state.status === 'done' && items.length === 0 && (
            <div className="notice">
              <p>Сонгосон байршилд одоогоор худалдаалах цэг бүртгэгдээгүй байна.</p>
              <button type="button" className="tlink" onClick={() => actions.open('location', { city, district })}>Миний ойролцоо байхгүй байна</button>
            </div>
          )}
          {items.length > 0 && (
            <p className="results__count">{items.length} салбар олдлоо</p>
          )}
          <div className="branches">
            {items.map((b) => (
              <article key={b.id} className={`branch${selected === b.id ? ' is-on' : ''}`} id={`branch-${b.id}`}>
                <div className="branch__top">
                  <p className="k">{b.chain}</p>
                  {b.is_sample ? <span className="badge badge--sample badge--inline">Жишээ</span> : null}
                </div>
                <h3>{b.name}</h3>
                <p>{[b.city, b.district].filter(Boolean).join(', ')}{b.address ? ` · ${b.address}` : ''}</p>
                <p className="branch__meta">
                  {b.hours && <span>{b.hours}</span>}
                  {b.sizes && <span>{b.sizes.split(',').map((s) => `${s.trim()} мл`).join(', ')}</span>}
                  {b.km != null && <span>{b.km < 1 ? `${Math.round(b.km * 1000)} м` : `${b.km.toFixed(1)} км`}</span>}
                </p>
                {b.verified_at && <p className="branch__date">Шалгасан: {formatDate(b.verified_at)}</p>}
                <div className="row">
                  <a className="btn btn--ghost" href={directionsUrl(b)} target="_blank" rel="noopener noreferrer" onClick={() => track('direction_click', { branch: b.id })}>
                    <Pin /> Зам заалгах
                  </a>
                  {phones(b.phone).map((p) => (
                    <a key={p.label} className="tlink tlink--sm" href={`tel:${p.dial}`} onClick={() => track('call_click', { branch: b.id })}>
                      <Phone /> {p.label}
                    </a>
                  ))}
                  {b.online_url && (
                    <a className="tlink tlink--sm" href={b.online_url} target="_blank" rel="noopener noreferrer" onClick={() => track('online_click', { branch: b.id })}>
                      Онлайнаар авах <External />
                    </a>
                  )}
                  {b.lat != null && b.lng != null && (
                    <button type="button" className="tlink tlink--sm" onClick={() => setSelected(b.id)}>Газрын зураг дээр</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="note">
          <span><Info />Барааны үлдэгдлийг худалдан авахаасаа өмнө салбараас лавлана уу.</span>
          <div className="note__links">
            {onlineStore && (
              <a className="tlink" href={onlineStore} target="_blank" rel="noopener noreferrer" onClick={() => track('online_click', { from: 'where' })}>
                Онлайнаар авах <External />
              </a>
            )}
            <button type="button" className="tlink" onClick={() => actions.open('location', { city, district })}>Миний ойролцоо байхгүй байна</button>
          </div>
        </div>
      </div>
    </section>
  );
}
