import { useEffect, useRef, useState } from 'react';
import { External, Play } from './Icons.jsx';
import { facebookVideo, useInView, youtubeId } from '../lib/util.js';
import { track } from '../lib/api.js';

const FALLBACK_IMG = '/media/domch_bottles.webp';

function fbEmbed(href, autoplay, size) {
  return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`
    + `&width=${size.w}&height=${size.h}${autoplay ? '&autoplay=true' : ''}`;
}

/** Facebook's player draws at the width/height it is given, so it gets the box's exact size and stays centred. */
function FbPlayer({ href, title, autoplay }) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(220, Math.round(r.width));
      const h = Math.max(220, Math.round(r.height));
      setSize((s) => (s && Math.abs(s.w - w) < 16 && Math.abs(s.h - h) < 16 ? s : { w, h }));
    };
    measure();
    if (!('ResizeObserver' in window)) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="ph__frame">
      {size && (
        <iframe
          key={`${size.w}x${size.h}`}
          src={fbEmbed(href, autoplay, size)}
          width={size.w}
          height={size.h}
          title={title}
          loading="lazy"
          scrolling="no"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
        />
      )}
    </div>
  );
}

const isVideoPage = (url) => Boolean(url && (youtubeId(url) || facebookVideo(url) || /^https?:\/\/(www\.|m\.)?(facebook\.com|fb\.watch|youtube\.com|youtu\.be)\//i.test(url)));

/**
 * Video or cover image.
 * YouTube: thumbnail, the player loads after a tap (youtube-nocookie).
 * Facebook video/reel: the cover image with a play button, or Facebook's own player when there is no cover.
 * Other links open in a new tab. Without any media a product photo keeps the box from looking empty.
 */
export function VideoBox({ url, image: rawImage, title, ratio = 'wide', label, sample, meta }) {
  const [playing, setPlaying] = useState(false);
  const image = isVideoPage(rawImage) ? '' : rawImage; // a video link pasted into the image field is not an image
  const [ref, inView] = useInView({ rootMargin: '400px' });
  const yt = youtubeId(url);
  const fb = yt ? null : facebookVideo(url);
  // vertical Facebook reels get a taller box so the video is not a thin strip inside a 16:9 frame
  const reel = Boolean(fb && /\/reels?\/|\/share\/r\//.test(url)) && ratio === 'wide';
  const cls = `ph ph--${reel ? 'reel' : ratio}`;
  const play = () => { setPlaying(true); track('video_play', meta || {}); };

  if (playing && (yt || fb)) {
    return (
      <div className={`${cls} ph--video`}>
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&cc_load_policy=1&rel=0`}
            title={title}
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : <FbPlayer href={fb} title={title} autoplay />}
      </div>
    );
  }
  if (fb && !image) {
    // no cover: Facebook's player shows its own preview frame (loaded when the card comes near the screen)
    return (
      <div ref={ref} className={`${cls} ph--video`}>
        {inView ? <FbPlayer href={fb} title={title} /> : <span className="ph__soon">Видео ачаалж байна…</span>}
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
  if (item.image_url && !isVideoPage(item.image_url)) return item.image_url;
  const yt = youtubeId(item.video_url);
  return yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
}
