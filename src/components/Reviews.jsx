import { Chat, Star } from './Icons.jsx';
import { SIZE_LABEL } from '../data/static.js';
import { formatDate } from '../lib/util.js';

export function Stars({ value, size = 'md' }) {
  const v = Math.round(Number(value) || 0);
  return (
    <span className={`stars stars--${size}`} role="img" aria-label={`5-аас ${Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1)}`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= v ? 'on' : ''} aria-hidden="true">★</span>)}
    </span>
  );
}

export function Reviews({ reviews, stats, actions }) {
  return (
    <section className="sec sec--surface" id="reviews" aria-labelledby="rev-title">
      <div className="wrap">
        <div className="sec__head">
          <div>
            <p className="eyebrow">Сэтгэгдэл</p>
            <h2 className="h2" id="rev-title">Хэрэглэгчдийн <em>сэтгэгдэл</em></h2>
          </div>
          {reviews.length > 0 && (
            <div className="rating-sum">
              <span className="rating-sum__n">{stats.average != null ? Number(stats.average).toFixed(1) : '—'}</span>
              <span>
                <Stars value={stats.average || 0} />
                <span className="meta">{stats.count} сэтгэгдэл</span>
              </span>
            </div>
          )}
        </div>
        {reviews.length === 0 ? (
          <div className="empty">
            <div className="empty__icon"><Chat /></div>
            <h3>Та анхны сэтгэгдлээ үлдээгээрэй</h3>
            <p>Домчийг хэрэглэсэн туршлагаа бусадтай хуваалцаарай.</p>
            <button type="button" className="btn" onClick={() => actions.open('review')}><Star /> Сэтгэгдэл үлдээх</button>
          </div>
        ) : (
          <>
            <div className="review-grid">
              {reviews.map((r) => (
                <article className="review" key={r.id}>
                  <Stars value={r.rating} size="sm" />
                  <p className="review__body">{r.body}</p>
                  <p className="meta">
                    {r.name} · {formatDate(r.created_at)}
                    {r.size && r.size !== 'unknown' ? ` · ${SIZE_LABEL[r.size] || r.size}` : ''}
                  </p>
                </article>
              ))}
            </div>
            <div className="center">
              <button type="button" className="btn" onClick={() => actions.open('review')}><Star /> Сэтгэгдэл үлдээх</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
