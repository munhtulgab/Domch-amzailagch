import { useState } from 'react';
import { External, Play } from './Icons.jsx';
import { youtubeId } from '../lib/util.js';
import { track } from '../lib/api.js';

/** Click-to-play video: YouTube loads only after a tap; other links open in a new tab. */
export function VideoBox({ url, title, ratio = 'wide', label, sample, meta }) {
  const [playing, setPlaying] = useState(false);
  const id = youtubeId(url);
  const cls = `ph ph--${ratio}`;
  if (playing && id) {
    return (
      <div className={`${cls} ph--video`}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&cc_load_policy=1&rel=0`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <div className={cls} style={id ? { backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` } : undefined}>
      {sample ? <span className="badge badge--sample">Жишээ</span> : label}
      {id ? (
        <button
          type="button"
          className="play"
          aria-label={`Видео тоглуулах: ${title}`}
          onClick={() => { setPlaying(true); track('video_play', meta || {}); }}
        >
          <Play />
        </button>
      ) : url ? (
        <a className="play" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Видео үзэх: ${title}`} onClick={() => track('video_play', meta || {})}>
          <External size={20} />
        </a>
      ) : (
        <span className="ph__soon">Видео удахгүй</span>
      )}
    </div>
  );
}
