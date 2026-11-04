import { VideoBox } from './Media.jsx';

export function People({ videos, actions }) {
  return (
    <section className="sec sec--surface" id="people" aria-labelledby="people-title">
      <div className="wrap">
        <div className="sec__head">
          <div>
            <p className="eyebrow">Хэрэглэгчид</p>
            <h2 className="h2" id="people-title">Домчийг <em>сонгосон хүмүүс</em></h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => actions.open('partner', { kind: 'creator' })}>
            Контент бүтээгчээр хамтрах
          </button>
        </div>
        {videos.length ? (
          <div className="reel">
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
        ) : (
          <p className="body">Хэрэглэгчдийн видео түүхүүд удахгүй нэмэгдэнэ.</p>
        )}
      </div>
    </section>
  );
}
