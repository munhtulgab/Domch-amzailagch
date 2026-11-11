import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoBox } from './Media.jsx';
import { Arrow, Video } from './Icons.jsx';

// Videos run in one row that scrolls sideways on every screen; on desktop the arrows step one card at a time.
function useRail(count) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ prev: false, next: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update, count]);
  const step = (dir) => {
    const el = ref.current;
    const card = el && el.firstElementChild;
    if (!card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: dir * (card.getBoundingClientRect().width + gap), behavior: 'smooth' });
  };
  return { ref, edge, step };
}

export function People({ videos, actions }) {
  const rail = useRail(videos.length);
  return (
    <section className="sec sec--surface" id="people" aria-labelledby="people-title">
      <div className="wrap">
        <div className="sec__head">
          <div>
            <p className="eyebrow">Хэрэглэгчид</p>
            <h2 className="h2" id="people-title">Домчийг <em>сонгосон хүмүүс</em></h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => actions.open('partner', { kind: 'creator' })}>
            <Video size={18} /> Контент бүтээгчээр хамтрах
          </button>
        </div>
        {videos.length ? (
          <div className="reel-wrap">
            <button type="button" className="reel__nav reel__nav--prev" aria-label="Өмнөх бичлэгүүд" disabled={!rail.edge.prev} onClick={() => rail.step(-1)}>
              <Arrow size={20} />
            </button>
            <div className="reel" ref={rail.ref}>
            {videos.map((v) => (
              <article key={v.id}>
                <VideoBox
                  url={v.video_url}
                  image={v.image_url}
                  title={v.title}
                  ratio="tall"
                  sample={v.is_sample}
                  label={<span className={`badge${v.sponsored ? '' : ' badge--soft'}`}>{v.sponsored ? 'Хамтарсан контент' : 'Манай гэрийн Домч'}</span>}
                  meta={{ video: v.id }}
                />
                <h3>{v.author || v.title}</h3>
                <p>{v.topic || v.title}</p>
              </article>
            ))}
            </div>
            <button type="button" className="reel__nav reel__nav--next" aria-label="Дараагийн бичлэгүүд" disabled={!rail.edge.next} onClick={() => rail.step(1)}>
              <Arrow size={20} />
            </button>
          </div>
        ) : (
          <p className="body">Хэрэглэгчдийн видео түүхүүд удахгүй нэмэгдэнэ.</p>
        )}
      </div>
    </section>
  );
}
