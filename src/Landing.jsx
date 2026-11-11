import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './components/Header.jsx';
import { Faq, Hero, Ingredients, Quality, Sizes, Usage } from './components/Sections.jsx';
import { Doctor } from './components/Doctor.jsx';
import { People } from './components/People.jsx';
import { Where } from './components/Where.jsx';
import { Reviews } from './components/Reviews.jsx';
import { Footer } from './components/Footer.jsx';
import { Dialogs } from './components/Dialogs.jsx';
import { FALLBACK } from './data/static.js';
import { api, track } from './lib/api.js';
import { scrollToId } from './lib/util.js';
import { Chat, Pin } from './components/Icons.jsx';

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  return [toasts, push];
}

export default function Landing() {
  const [content, setContent] = useState(FALLBACK);
  const [size, setSize] = useState('big');
  const [usageTab, setUsageTab] = useState('adult');
  const [dialog, setDialog] = useState(null);
  const [toasts, toast] = useToasts();
  const sceneRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api('/content')
      .then((data) => {
        if (!alive || !data) return;
        setContent({
          ...FALLBACK,
          ...data,
          products: data.products && data.products.length ? data.products : FALLBACK.products,
          faqs: data.faqs && data.faqs.length ? data.faqs : FALLBACK.faqs,
          filters: { ...FALLBACK.filters, ...(data.filters || {}) },
          settings: data.settings || {},
          messenger: data.messenger || { enabled: false, link: '' },
        });
      })
      .catch(() => {
        /* the page keeps its built-in content */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller = null;
    import('./three/scene.js')
      .then(({ createScene }) => createScene({ canvas: canvasRef.current, initialSize: 'big' }))
      .then((ctrl) => {
        if (!ctrl) return;
        if (cancelled) ctrl.dispose();
        else {
          controller = ctrl;
          sceneRef.current = ctrl;
        }
      })
      .catch(() => {
        /* the photo stays in place when 3D cannot start */
      });
    return () => {
      cancelled = true;
      if (controller) controller.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.setSize(size);
  }, [size]);

  useEffect(() => {
    const t = setTimeout(() => sceneRef.current && sceneRef.current.refresh(), 120);
    return () => clearTimeout(t);
  }, [content]);

  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (id && document.getElementById(id)) setTimeout(() => scrollToId(id), 300);
  }, []);

  const actions = useMemo(() => ({
    open: (type, props = {}) => setDialog({ type, props }),
    goTo: (id) => scrollToId(id === 'hero' ? 'hero' : id),
    toast,
    runItem: (item) => {
      if (item.tab) {
        setUsageTab(item.tab);
        track('usage_view', { tab: item.tab, from: 'nav' });
      }
      if (item.open) setDialog({ type: item.open, props: { kind: item.kind } });
      else if (item.go) setTimeout(() => scrollToId(item.go), 30);
    },
  }), [toast]);

  return (
    <>
      <a className="skip" href="#main">Үндсэн агуулга руу шилжих</a>
      <div className="gl" aria-hidden="true"><canvas ref={canvasRef} /></div>
      <Header actions={actions} />
      <main id="main">
        <Hero actions={actions} />
        <Sizes products={content.products} size={size} onSize={setSize} actions={actions} />
        <Ingredients />
        <Usage tab={usageTab} onTab={setUsageTab} />
        <div className="solid">
          <Quality />
          <Doctor tips={content.tips} actions={actions} />
          <People videos={content.videos} actions={actions} />
          <Where filters={content.filters} settings={content.settings} actions={actions} />
          <Reviews reviews={content.reviews} stats={content.reviewStats} actions={actions} />
          <Faq faqs={content.faqs} />
        </div>
      </main>
      <Footer settings={content.settings} messenger={content.messenger} actions={actions} />
      {content.messenger && content.messenger.enabled && (
        <a className="msgr" href={content.messenger.link} target="_blank" rel="noopener noreferrer" aria-label="Messenger-ээр бичих"
          onClick={() => track('messenger_click', { from: 'float' })}>
          <Chat size={22} />
          <span>Messenger-ээр бичих</span>
        </a>
      )}
      <div className="mcta">
        <a className="btn" href="#where" onClick={(e) => { e.preventDefault(); track('where_click', { from: 'mobile-bar' }); scrollToId('where'); }}>
          <Pin /> Хаанаас авах вэ?
        </a>
      </div>
      <Dialogs dialog={dialog} onClose={() => setDialog(null)} actions={actions} content={content} />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <p key={t.id} className={`toast toast--${t.kind}`}>{t.text}</p>)}
      </div>
    </>
  );
}
