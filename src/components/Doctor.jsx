import { Arrow, Chat, Send } from './Icons.jsx';
import { VideoBox, coverOf } from './Media.jsx';
import { TIP_KINDS } from '../data/static.js';
import { formatDate } from '../lib/util.js';

function metaLine(t) {
  return [
    [t.doctor_name, t.doctor_title].filter(Boolean).join(', '),
    formatDate(t.published_at),
    t.source ? `Эх сурвалж: ${t.source}` : '',
  ].filter(Boolean).join(' · ');
}

export function Doctor({ tips, actions }) {
  const featured = tips.find((t) => t.featured) || tips[0];
  const rest = tips.filter((t) => t !== featured).slice(0, 2);
  return (
    <section className="sec" id="doctor" aria-labelledby="doc-title">
      <div className="wrap">
        <div className="sec__head">
          <div>
            <p className="eyebrow">Эмчийн булан</p>
            <h2 className="h2" id="doc-title">Эмчийн <em>зөвлөгөө</em></h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => actions.open('question')}>
            <Chat size={18} /> Эмчээс асууя
          </button>
        </div>
        {featured ? (
          <div className="bento">
            <article className="feature">
              <VideoBox
                url={featured.video_url}
                image={featured.image_url}
                title={featured.title}
                sample={featured.is_sample}
                label={<span className="ph__tag">Видео · {TIP_KINDS[featured.kind] || 'Эмчийн зөвлөгөө'}</span>}
                meta={{ tip: featured.id }}
              />
              <p className="tag">{TIP_KINDS[featured.kind] || 'Эмчийн зөвлөгөө'}</p>
              <h3>{featured.title}</h3>
              {featured.summary && <p className="body body--tight">{featured.summary}</p>}
              <p className="meta">{metaLine(featured)}</p>
              {featured.body && (
                <button type="button" className="tlink" onClick={() => actions.open('tip', { tip: featured })}>Унших <Arrow /></button>
              )}
            </article>
            <div className="tips">
              {rest.map((t) => (
                <article className="tip" key={t.id}>
                  {coverOf(t) && <img className="tip__cover" src={coverOf(t)} alt="" loading="lazy" decoding="async" />}
                  <div className="tip__top">
                    <p className="tag">{TIP_KINDS[t.kind] || 'Зөвлөгөө'}</p>
                    {t.is_sample ? <span className="badge badge--sample badge--inline">Жишээ</span> : null}
                  </div>
                  <h3>{t.title}</h3>
                  {t.summary && <p className="meta">{t.summary}</p>}
                  <p className="meta">{metaLine(t)}</p>
                  {(t.body || t.video_url) && (
                    <button type="button" className="tlink tip__more" onClick={() => actions.open('tip', { tip: t })}>Дэлгэрэнгүй <Arrow /></button>
                  )}
                </article>
              ))}
              <article className="tip tip--ask">
                <h3>Эмчээс асуух зүйл байна уу?</h3>
                <p className="meta">Асуултыг тань эмчийн дараагийн зөвлөгөөнд хариулах сэдэв болгон хүлээн авна.</p>
                <button type="button" className="btn btn--sm" onClick={() => actions.open('question')}><Send size={16} /> Асуулт илгээх</button>
              </article>
            </div>
          </div>
        ) : (
          <div className="empty">
            <div className="empty__icon"><Chat /></div>
            <h3>Эмчийн зөвлөгөө удахгүй нэмэгдэнэ</h3>
            <p>Асуух зүйлээ илгээвэл эмчийн дараагийн зөвлөгөөнд ашиглана.</p>
            <button type="button" className="btn" onClick={() => actions.open('question')}><Chat size={18} /> Эмчээс асууя</button>
          </div>
        )}
      </div>
    </section>
  );
}
