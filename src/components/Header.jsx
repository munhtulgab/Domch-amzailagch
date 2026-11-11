import { useEffect, useRef, useState } from 'react';
import { Arrow, Chevron, Close, Menu, Pin, Search } from './Icons.jsx';
import { track } from '../lib/api.js';

export const NAV = [
  {
    id: 'product', label: 'Бүтээгдэхүүн',
    blurb: 'Монгол жамц давс, башир цэцгийн ханд, гааны найрлагатай, спиртгүй ам зайлагч.',
    items: [
      { label: 'Домч ам зайлагч', desc: '250 мл ба 500 мл савлагаа', go: 'sizes' },
      { label: 'Орц, найрлага', desc: 'Жамц давс, башир цэцгийн ханд, гаа', go: 'ingredients' },
      { label: 'Хэрэглэх заавар', desc: 'Хэмжих, зайлах, нулимах', go: 'usage' },
      { label: 'Үйлдвэрлэл ба чанар', desc: 'Лабораторийн хяналт, стандарт', go: 'quality' },
      { label: 'Түгээмэл асуулт', desc: 'Спирт, савлагаа, хадгалалт', go: 'faq' },
    ],
  },
  {
    id: 'family', label: 'Гэр бүлийн хэрэглээ',
    blurb: 'Хэрэглэгчийн насанд тохирсон зааврыг сонгоно уу. Гэр бүлийн гишүүн бүр тусдаа хэмжүүр хэрэглэнэ.',
    items: [
      { label: 'Насанд хүрэгчдийн хэрэглээ', desc: 'Хэмжээ, алхам', go: 'usage', tab: 'adult' },
      { label: 'Хүүхдийн хэрэглээ', desc: 'Насны заалт, эцэг эхийн хяналт', go: 'usage', tab: 'kid' },
    ],
  },
  {
    id: 'doctor', label: 'Эмчийн булан',
    blurb: 'Нийтлэл бүрд бичсэн эмч, огноо, эх сурвалж харагдана.',
    items: [
      { label: 'Эмчийн зөвлөгөө', desc: 'Видео болон нийтлэл', go: 'doctor' },
      { label: 'Эмчээс асууя', desc: 'Дараагийн зөвлөгөөнд асуулт илгээх', open: 'question' },
    ],
  },
  {
    id: 'people', label: 'Хэрэглэгчид',
    blurb: 'Хамтарсан контент болон худалдан авагчдын сэтгэгдлийг тусад нь харуулна.',
    items: [
      { label: 'Домчийг сонгосон хүмүүс', desc: 'Видео түүхүүд', go: 'people' },
      { label: 'Хэрэглэгчдийн сэтгэгдэл', desc: 'Бодит сэтгэгдлүүд', go: 'reviews' },
      { label: 'Сэтгэгдэл үлдээх', desc: 'Үнэлгээ, туршлагаа хуваалцах', open: 'review' },
    ],
  },
  { id: 'where', label: 'Хаанаас авах вэ?', go: 'where' },
  {
    id: 'partner', label: 'Хамтран ажиллах',
    blurb: 'Төрлөө сонгоод тохирох маягтыг бөглөнө үү. Илгээсний дараа баталгаажуулалт харагдана.',
    items: [
      { label: 'Эмийн сан, борлуулагч', desc: 'Нийлүүлэлтийн хүсэлт', open: 'partner', kind: 'pharmacy' },
      { label: 'Шүдний эмнэлэг', desc: 'Танилцуулга, контентын хамтын ажиллагаа', open: 'partner', kind: 'clinic' },
      { label: 'Байгууллагын захиалга', desc: 'Тоо хэмжээ, хэрэгцээ', open: 'partner', kind: 'corporate' },
      { label: 'Контент бүтээгч', desc: 'Сошиал хаяг, хамтрах санаа', open: 'partner', kind: 'creator' },
    ],
  },
];

export default function Header({ actions }) {
  const [open, setOpen] = useState(null);
  const [mobile, setMobile] = useState(false);
  const [mobileGroup, setMobileGroup] = useState('product');
  const headRef = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', mobile);
    return () => document.documentElement.classList.remove('menu-open');
  }, [mobile]);

  useEffect(() => {
    if (!open && !mobile) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(null);
        setMobile(false);
      }
    };
    const onDown = (e) => {
      if (headRef.current && !headRef.current.contains(e.target)) {
        setOpen(null);
        setMobile(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, mobile]);

  useEffect(() => {
    const bar = progressRef.current;
    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.transform = `scaleX(${h > 0 ? Math.min(1, window.scrollY / h) : 0})`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const run = (item) => {
    setOpen(null);
    setMobile(false);
    actions.runItem(item);
  };
  const active = NAV.find((n) => n.id === open && n.items);

  return (
    <header className="head" ref={headRef}>
      <div className="wrap head__in">
        <a className="mark" href="#hero" aria-label="DOMCH, нүүр" onClick={(e) => { e.preventDefault(); run({ go: 'hero' }); }}>DOMCH</a>
        <nav className="nav" aria-label="Үндсэн цэс">
          {NAV.map((n) => (n.items ? (
            <button
              key={n.id}
              type="button"
              className={`nav__btn${open === n.id ? ' is-open' : ''}`}
              aria-expanded={open === n.id}
              aria-controls="mega"
              onClick={() => setOpen(open === n.id ? null : n.id)}
            >
              {n.label}
              <Chevron open={open === n.id} />
            </button>
          ) : (
            <a key={n.id} className="nav__btn" href={`#${n.go}`} onClick={(e) => { e.preventDefault(); track('where_click', { from: 'nav' }); run(n); }}>
              {n.label}
            </a>
          )))}
        </nav>
        <button type="button" className="icon-btn" aria-label="Хайх" onClick={() => { setOpen(null); setMobile(false); actions.open('search'); }}>
          <Search />
        </button>
        <a className="btn btn--sm head__cta" href="#where" onClick={(e) => { e.preventDefault(); track('where_click', { from: 'header' }); run({ go: 'where' }); }}>
          <Pin size={16} /> Хаанаас авах вэ?
        </a>
        <button
          type="button"
          className="icon-btn menu-btn"
          aria-expanded={mobile}
          aria-controls="mobile-menu"
          aria-label={mobile ? 'Цэс хаах' : 'Цэс нээх'}
          onClick={() => { setOpen(null); setMobile(!mobile); }}
        >
          {mobile ? <Close size={20} /> : <Menu />}
        </button>
      </div>
      <div className="progress" ref={progressRef} />

      {active && (
        <div className="mega" id="mega">
          <div className="wrap mega__in">
            <div className="mega__list">
              <p className="eyebrow">{active.label}</p>
              <ul>
                {active.items.map((item) => (
                  <li key={item.label}>
                    <button type="button" onClick={() => run(item)}>
                      <span className="mega__t">{item.label}</span>
                      <span className="mega__d">{item.desc}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mega__side">
              <p className="mega__blurb">{active.blurb}</p>
              <button type="button" className="tlink" onClick={() => run(active.items[0])}>
                Дэлгэрэнгүй <Arrow />
              </button>
            </div>
          </div>
        </div>
      )}

      {mobile && (
        <div className="mnav" id="mobile-menu">
          <ul>
            {NAV.map((n) => (
              <li key={n.id}>
                {n.items ? (
                  <>
                    <button type="button" className="mnav__top" aria-expanded={mobileGroup === n.id} onClick={() => setMobileGroup(mobileGroup === n.id ? null : n.id)}>
                      {n.label}
                      <Chevron size={18} open={mobileGroup === n.id} />
                    </button>
                    {mobileGroup === n.id && (
                      <ul className="mnav__sub">
                        {n.items.map((item) => (
                          <li key={item.label}>
                            <button type="button" onClick={() => run(item)}>{item.label}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <button type="button" className="mnav__top" onClick={() => { track('where_click', { from: 'mobile-nav' }); run(n); }}>{n.label}</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
