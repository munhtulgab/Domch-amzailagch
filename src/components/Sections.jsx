import { Adult, Arrow, ArrowDown, CareDrop, Child, External, NoAlcohol, Pin, Plus, Swipe } from './Icons.jsx';
import { formatPrice, useInView } from '../lib/util.js';
import { track } from '../lib/api.js';

const BOTTLES_IMG = '/media/domch_bottles.webp';
const ING = {
  salt: { src: '/media/ing-salt.webp', w: 774, h: 460, alt: 'Монгол жамц давс' },
  clove: { src: '/media/ing-clove.webp', w: 754, h: 545, alt: 'Хадаасан цэцэг (башир цэцэг)' },
  mint: { src: '/media/ing-mint.webp', w: 519, h: 339, alt: 'Гааны навч' },
  water: { src: '/media/ing-water.svg' },
  glycerin: { src: '/media/ing-glycerin.svg' },
  blue: { src: '/media/ing-blue.svg' },
};

function IngPhoto({ kind }) {
  const [ref, inView] = useInView({ rootMargin: '0px 0px -10% 0px' });
  const img = ING[kind];
  return (
    <figure ref={ref} className={`ing-photo ing-photo--${kind}${inView ? ' is-in' : ''}`}>
      <img src={img.src} alt={img.alt} width={img.w} height={img.h} loading="lazy" decoding="async" />
    </figure>
  );
}

export function Hero({ actions }) {
  return (
    <section className="z3d" id="hero" data-pose="hero">
      <div className="wrap">
        <div className="copy">
          <p className="eyebrow">DOMCH · Жамц давсны уусмал</p>
          <h1 className="display">Амны хөндийн <em>өдөр тутмын</em> арчилгаа</h1>
          <p className="lead">
            Монгол жамц давс, башир цэцгийн ханд, гааны найрлагатай, спиртгүй ам зайлагч. Амны эвгүй үнэрийг дарж,
            амны хөндийг цэвэрлэн сэрүүцүүлнэ.
          </p>
          <ul className="chips">
            <li><NoAlcohol />Спирт агуулаагүй</li>
            <li><CareDrop />Ээлтэй бүтээгдэхүүн</li>
          </ul>
          <div className="actions">
            <a className="btn" href="#where" onClick={(e) => { e.preventDefault(); track('where_click', { from: 'hero' }); actions.goTo('where'); }}>
              <Pin /> Хаанаас авах вэ?
            </a>
            <a className="tlink" href="#ingredients" onClick={(e) => { e.preventDefault(); actions.goTo('ingredients'); }}>
              Найрлагатай танилцах <ArrowDown />
            </a>
          </div>
        </div>
      </div>
      <div className="visual" data-drag>
        <img src={BOTTLES_IMG} alt="DOMCH жамц давсны уусмал, 250 мл ба 500 мл савлагаа" width="1040" height="1492" />
      </div>
      <div className="wrap hero__foot">
        <a className="cue" href="#sizes" onClick={(e) => { e.preventDefault(); actions.goTo('sizes'); }}><i />Доош гүйлгэнэ үү</a>
        <span className="drag-hint"><Swipe />Савыг чирж эргүүлнэ үү</span>
      </div>
    </section>
  );
}

export function Sizes({ products, size, onSize, actions }) {
  const list = [...products].sort((a, b) => a.volume_ml - b.volume_ml);
  return (
    <section className="z3d" id="sizes" data-pose="sizes">
      <div className="wrap">
        <div className="copy">
          <p className="eyebrow">Бүтээгдэхүүн</p>
          <h2 className="h2">Хоёр хэмжээ, <em>нэг найрлага</em></h2>
          <p className="body">250 мл болон 500 мл савлагаатай. Өөрт тохирох хэмжээгээ сонгоорой.</p>
          <div className="opts" role="group" aria-label="Савлагааны хэмжээ">
            {list.map((p) => {
              const id = p.slug === 'small' || p.volume_ml < 400 ? 'small' : 'big';
              const price = formatPrice(p.price);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="opt"
                  aria-pressed={size === id}
                  onClick={() => { onSize(id); track('size_select', { size: p.volume_ml }); }}
                >
                  <span className="opt__vol">{p.volume_ml}<small>мл</small></span>
                  <span className="opt__meta">{p.name} · Гаа</span>
                  <span className={`opt__price${price ? '' : ' is-muted'}`}>{price || 'Үнийг салбараас лавлана уу'}</span>
                </button>
              );
            })}
          </div>
          {list.some((p) => p.price) && (
            <p className="price-note">Үйлдвэрийн үнэ. Эмийн сан, дэлгүүрт үүнээс өндөр үнээр зарагдаж болно.</p>
          )}
          <dl className="specs">
            <div><dt>Ангилал</dt><dd>Ам зайлагч</dd></div>
            <div><dt>Амт</dt><dd>Гаа</dd></div>
            <div><dt>Үйлдвэрлэж эхэлсэн</dt><dd>2020 он</dd></div>
          </dl>
          <div className="actions actions--tight">
            {(() => {
              const chosen = list.find((p) => (size === 'small' ? p.volume_ml < 400 : p.volume_ml >= 400));
              return chosen && chosen.online_url ? (
                <a className="btn" href={chosen.online_url} target="_blank" rel="noopener noreferrer" onClick={() => track('online_click', { from: 'sizes', size: chosen.volume_ml })}>
                  Онлайнаар авах <External />
                </a>
              ) : null;
            })()}
            <a className="tlink" href="#where" onClick={(e) => { e.preventDefault(); track('where_click', { from: 'sizes' }); actions.goTo('where'); }}>
              Худалдан авах цэг <Arrow />
            </a>
          </div>
        </div>
      </div>
      <div className="visual" data-drag>
        <img src={BOTTLES_IMG} alt="" width="1040" height="1492" />
      </div>
    </section>
  );
}

export function Ingredients() {
  return (
    <section className="deep" id="ingredients" aria-labelledby="ing-title">
      <div className="z3d" data-pose="intro">
        <div className="wrap">
          <div className="copy">
            <p className="eyebrow">Орц, найрлага</p>
            <h2 className="h2" id="ing-title">Гурван үндсэн <em>найрлага</em></h2>
            <p className="body">Найрлага бүр бүтээгдэхүүнд тодорхой зориулалтаар орсон. Доош гүйлгэж танилцаарай.</p>
          </div>
        </div>
        <div className="visual">
          <img src={BOTTLES_IMG} alt="" width="1040" height="1492" />
        </div>
      </div>
      <div className="z3d" data-pose="salt">
        <div className="wrap">
          <div className="copy">
            <IngPhoto kind="salt" />
            <p className="step__n"><span>01</span> / 03</p>
            <h3 className="step__t">Монгол жамц давс</h3>
            <p className="body">Нян бактери устгаж, амны хөндий, хоолойн үрэвслийг намдаана.</p>
          </div>
        </div>
      </div>
      <div className="z3d" data-pose="drop">
        <div className="wrap">
          <div className="copy">
            <IngPhoto kind="clove" />
            <p className="step__n"><span>02</span> / 03</p>
            <h3 className="step__t">Башир цэцгийн ханд</h3>
            <p className="step__sub">Хадаасан цэцгийн ханд</p>
            <p className="body">Амны эвгүй үнэрийг арилгаж, хоолойн өвчнийг намдаана.</p>
          </div>
        </div>
      </div>
      <div className="z3d" data-pose="mint">
        <div className="wrap">
          <div className="copy">
            <IngPhoto kind="mint" />
            <p className="step__n"><span>03</span> / 03</p>
            <h3 className="step__t">Гаа</h3>
            <p className="body">Амны хөндийг ариутгаж, сэрүүн амт өгнө.</p>
          </div>
        </div>
      </div>
      <div className="z3d" data-pose="full">
        <div className="wrap">
          <div className="copy">
            <p className="eyebrow">Бүрэн найрлага</p>
            <ul className="ing-list">
              <li><img src={ING.water.src} alt="" width="40" height="26" loading="lazy" />Шүүсэн ус</li>
              <li><img src={ING.salt.src} alt="" width="40" height="24" loading="lazy" />Жамц давс</li>
              <li><img src={ING.clove.src} alt="" width="40" height="29" loading="lazy" />Хадаасан цэцгийн ханд (башир цэцэг)</li>
              <li><img src={ING.mint.src} alt="" width="40" height="26" loading="lazy" />Гаа</li>
              <li><img src={ING.glycerin.src} alt="" width="40" height="26" loading="lazy" />Глицерин</li>
              <li><img src={ING.blue.src} alt="" width="40" height="26" loading="lazy" />FD&amp;C Blue No.1</li>
            </ul>
            <p className="no-alcohol"><NoAlcohol />Спирт агуулаагүй</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = {
  adult: [
    ['Хэмжих', 'Хэмжүүрээр шошгонд заасан хэмжээгээр хэмжинэ.'],
    ['Зайлах', 'Шошгонд заасан хугацаанд амаа сайтар зайлна.'],
    ['Нулимах', 'Залгихгүй, бүрэн нулимна.'],
  ],
  kid: [
    ['Хэмжих', 'Эцэг эх нь шошгонд заасан хэмжээгээр хэмжиж өгнө.'],
    ['Зайлах', 'Эцэг эхийн хяналтан дор зайлна.'],
    ['Нулимах', 'Залгихгүй, бүрэн нулимна.'],
  ],
};

export function Usage({ tab, onTab }) {
  const tabs = [['adult', 'Насанд хүрэгчид', Adult], ['kid', 'Хүүхдийн хэрэглээ', Child]];
  const select = (id) => {
    onTab(id);
    track('usage_view', { tab: id });
  };
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tab === 'adult' ? 'kid' : 'adult';
    select(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <section className="z3d" id="usage" data-pose="usage">
      <div className="wrap">
        <div className="copy copy--right">
          <p className="eyebrow">Гэр бүлийн хэрэглээ</p>
          <h2 className="h2">Гэр бүлийн <em>зөв хэрэглээ</em></h2>
          <p className="body">Хэрэглэгчийн насанд тохирох зааврыг сонгоно уу.</p>
          <div className="tabs" role="tablist" aria-label="Хэрэглэгч" onKeyDown={onKey}>
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls="usage-panel"
                tabIndex={tab === id ? 0 : -1}
                className="tab"
                onClick={() => select(id)}
              >
                <Icon size={18} />{label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="usage-panel" aria-labelledby={`tab-${tab}`}>
            {tab === 'kid' && <p className="age">Насны заалтыг шошгоноос шалгаад хэрэглэнэ үү.</p>}
            <ol className="steps">
              {STEPS[tab].map(([t, d], i) => (
                <li key={t}>
                  <span className="n">{String(i + 1).padStart(2, '0')}</span>
                  <span><strong>{t}</strong><span className="d">{d}</span></span>
                </li>
              ))}
            </ol>
          </div>
          <p className="fine">Гэр бүлийн гишүүн бүр тусдаа хэмжүүр хэрэглэнэ.</p>
          <figure className="quote">
            <figcaption>Шошгон дээрх зөвлөмж</figcaption>
            <blockquote>
              Намар, өвөл, хаврын улиралд Домч уусмалаар амны хөндий, хоолойгоо тогтмол зайлснаар амны хөндий, буйл,
              хоолой, залгиурын бактери, вирусын гаралтай үрэвсэлт өвчин, ханиад томуунаас сэргийлнэ.
            </blockquote>
          </figure>
        </div>
      </div>
      <div className="visual visual--left" data-drag>
        <img src={BOTTLES_IMG} alt="" width="1040" height="1492" />
      </div>
    </section>
  );
}

// Certification marks shown with the guarantees they back (images supplied by Жем Интернэшнл)
const CERTS = {
  mnas: { src: '/media/cert-mnas.webp', w: 182, h: 240, alt: 'MNAS — Монголын итгэмжлэлийн тогтолцоо, TL 49-1, MNS ISO/IEC 17025' },
  gem: { src: '/media/cert-gem.webp', w: 258, h: 240, alt: 'Жем Интернэшнл ХХК' },
  iso: { src: '/media/cert-iso9001.webp', w: 240, h: 240, alt: 'ISO 9001:2015' },
};

export function Quality() {
  const items = [
    ['mnas', 'Өдөр бүрийн лабораторийн хяналт',
      'Дотоод хяналтын итгэмжлэгдсэн лабораторийн өдөр тутмын хяналтаар бүтээгдэхүүний чанар, аюулгүй байдлыг баталгаажуулсан.'],
    ['gem', 'Байгууллагын дотоод лабораторийн стандарт',
      'Жем Интернэшнл ХХК-ийн чанарын бодлогод нийцүүлэн Монгол Улсын стандартаас илүү өндөр шаардлага бүхий «Байгууллагын стандарт»-ын шаардлагыг хангасан.'],
    ['iso', 'Аюулгүйн тэмдэг · ISO 9001',
      'Бүтээгдэхүүний чанарыг Стандарт, хэмжил зүйн газраас олгодог «Аюулгүйн тэмдгийн гэрчилгээ»-гээр, үйл ажиллагааны чанарыг ISO 9001 стандартаар баталгаажуулсан.'],
  ];
  return (
    <section className="sec sec--surface" id="quality" aria-labelledby="q-title">
      <div className="wrap">
        <p className="eyebrow">Чанар хангалт</p>
        <h2 className="h2" id="q-title">Чанар, аюулгүй байдлын <em>баталгаа</em></h2>
        <div className="q-grid">
          {items.map(([cert, title, text]) => (
            <article className="q" key={title}>
              <div className="q__top">
                <img className={`q__logo q__logo--${cert}`} src={CERTS[cert].src} alt={CERTS[cert].alt}
                  width={CERTS[cert].w} height={CERTS[cert].h} loading="lazy" decoding="async" />
                <h3>{title}</h3>
              </div>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Faq({ faqs }) {
  return (
    <section className="sec" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <div>
          <p className="eyebrow">Түгээмэл асуулт</p>
          <h2 className="h2" id="faq-title">Хамгийн их <em>асуудаг</em></h2>
        </div>
        <div className="faq-list">
          {faqs.map((f, i) => (
            <details key={f.id} open={i === 0}>
              <summary>{f.question}<span className="pm" aria-hidden="true"><Plus /></span></summary>
              <p>{f.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
