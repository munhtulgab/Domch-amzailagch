import { useState } from 'react';
import { External, Play } from './Icons.jsx';
import { facebookVideo, useInView, youtubeId } from '../lib/util.js';
import { track } from '../lib/api.js';

const FALLBACK_IMG = '/media/domch_bottles.webp';

function fbEmbed(href, autoplay) {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false&width=560${autoplay ? '&autoplay=true' : ''}`;
}

/**
 * Video or cover image.
 * YouTube: thumbnail, the player loads after a tap (youtube-nocookie).
 * Facebook video/reel: the cover image with a play button, or Facebook's own player when there is no cover.
 * Other links open in a new tab. Without any media a product photo keeps the box from looking empty.
 */
export function VideoBox({ url, image, title, ratio = 'wide', label, sample, meta }) {
  const [playing, setPlaying] = useState(false);
  const [ref, inView] = useInView({ rootMargin: '400px' });
  const yt = youtubeId(url);
  const fb = yt ? null : facebookVideo(url);
  const cls = `ph ph--${ratio}`;
  const play = () => { setPlaying(true); track('video_play', meta || {}); };

  if (playing && (yt || fb)) {
    return (
      <div className={`${cls} ph--video`}>
        <iframe
          src={yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&cc_load_policy=1&rel=0` : fbEmbed(fb, true)}
          title={title}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }
  if (fb && !image) {
    // no cover: Facebook's player shows its own preview frame (loaded when the card comes near the screen)
    return (
      <div ref={ref} className={`${cls} ph--video`}>
        {inView ? (
          <iframe src={fbEmbed(fb, false)} title={title} loading="lazy" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen />
        ) : <span className="ph__soon">Видео ачаалж байна…</span>}
        {sample ? <span className="badge badge--sample">Жишээ</span> : label}
      </div>
    );
  }
  const poster = image || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '');
  const empty = !poster;
  return (
    <div className={`${cls}${empty ? ' ph--fallback' : ''}`} style={{ backgroundImage: `url(${poster || FALLBACK_IMG})` }}>
      {sample ? <span className="badge badge--sample">Жишээ</span> : label}
      {yt || fb ? (
        <button type="button" className="play" aria-label={`Видео тоглуулах: ${title}`} onClick={play}>
          <Play />
        </button>
      ) : url ? (
        <a className="play" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Видео үзэх: ${title}`} onClick={() => track('video_play', meta || {})}>
          <External size={20} />
        </a>
      ) : empty ? (
        <span className="ph__soon">Видео удахгүй</span>
      ) : null}
    </div>
  );
}

/** Small cover for a tip card: its own image or the video's thumbnail. */
export function coverOf(item) {
  if (item.image_url) return item.image_url;
  const yt = youtubeId(item.video_url);
  return yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
}
