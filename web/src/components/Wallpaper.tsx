import { useEffect, useRef, useState } from 'react';
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

  const mediaStyle = {
    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
    transform: wallpaper.scale !== 1 ? `scale(${wallpaper.scale})` : undefined,
  } as const;

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
