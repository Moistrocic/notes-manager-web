import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * The wallpaper layer, behind everything else.
 *
 * It is a fixed, non-interactive element: the app's glass panels sit on top of
 * it, and a scrim keeps the text readable whatever the picture looks like.
 */
export function Wallpaper() {
  const wallpaper = useAppStore((s) => s.wallpaper);
  const url = useAppStore((s) => s.wallpaperUrl);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  // Only the blur compensation needs this, but it has to be the real size.
  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // A new source deserves a fresh attempt.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && wallpaper.kind === 'video') {
      video.play().catch(() => {
        /* autoplay may be blocked; the poster/first frame still shows */
      });
    }
  }, [url, wallpaper.kind]);

  if (wallpaper.kind === 'none' || !url || failed) return null;

  // A blur samples past the element's edges, so the outer band fades to
  // transparent and the page background shows through: the picture looks like it
  // has shrunk away from the frame, worst in the corners, and zooming does not
  // fix it at 1x. A centred scale pushes that faded band off screen instead.
  // Scaling is used rather than stretching the box, because the box has to keep
  // the window's aspect ratio for object-fit: cover to crop the way it should.
  const zoom = wallpaper.blur > 0 ? 1 + (5 * wallpaper.blur) / Math.max(320, Math.min(viewport.w, viewport.h)) : 1;
  const totalScale = wallpaper.scale * zoom;

  const mediaStyle = {
    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
    transform: totalScale !== 1 ? `scale(${totalScale.toFixed(4)})` : undefined,
    // Which slice of an over-tall or over-wide picture survives the crop.
    objectPosition: `${wallpaper.focusX}% ${wallpaper.focusY}%`,
  } as CSSProperties;

  return (
    <div className="wallpaper-layer" aria-hidden>
      {wallpaper.kind === 'video' ? (
        <video
          ref={videoRef}
          key={url}
          className="wallpaper-media"
          style={mediaStyle}
          src={url}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          key={url}
          className="wallpaper-media"
          style={mediaStyle}
          src={url}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
      <div className="wallpaper-scrim" style={{ opacity: wallpaper.dim }} />
    </div>
  );
}
