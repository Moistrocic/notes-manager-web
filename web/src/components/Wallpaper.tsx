import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { canPlayScenes, playScene, type ScenePlayer } from '../lib/scene/play-scene';
import { cropMediaStyle } from '../lib/wallpaper';
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
  const pushToast = useAppStore((s) => s.pushToast);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<ScenePlayer | null>(null);
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

  // A live scene: the canvas is handed to the worker, which owns it from then
  // on - parsing, decoding textures, translating shaders and drawing all happen
  // off the main thread, which is what keeps the page smooth behind it.
  useEffect(() => {
    if (wallpaper.kind !== 'scene' || !url) return undefined;
    const canvas = canvasRef.current;
    if (!canvas || !canPlayScenes()) return undefined;

    let cancelled = false;
    let player: ScenePlayer | null = null;

    // A failure after the first frame used to be invisible: the worker reported
    // it, nothing was listening, and the canvas simply froze on its last frame
    // looking like a still. Say so instead.
    const report = (message: string) => {
      if (cancelled) return;
      setFailed(true);
      pushToast({ title: '动态场景已停止', message, tone: 'error' });
    };

    void (async () => {
      try {
        const bytes = await (await fetch(url)).arrayBuffer();
        if (cancelled) return;
        player = await playScene(canvas, bytes, { maxWidth: 1920, fps: 30, onError: report });
        if (cancelled) {
          player.stop();
          return;
        }
        playerRef.current = player;
        if (document.hidden) player.pause();
        const info = player.info;
        if (info.skipped > 0) {
          pushToast({
            title: '动态场景已渲染',
            message: `${info.resolved} 个图层已解析，${info.skipped} 个未能解析`,
            tone: 'info',
          });
        }
      } catch (err) {
        report((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current = null;
      player?.stop();
    };
  }, [wallpaper.kind, url, pushToast]);

  // Nothing should animate in a tab nobody is looking at.
  useEffect(() => {
    const onVisibility = () => {
      const player = playerRef.current;
      if (!player) return;
      if (document.hidden) player.pause();
      else player.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (wallpaper.kind === 'none' || !url || failed) return null;

  // A blur samples past the element's edges, so the outer band fades to
  // transparent and the page background shows through: the picture looks like it
  // has shrunk away from the frame, worst in the corners, and zooming does not
  // fix it at 1x. A centred scale pushes that faded band off screen instead.
  // Scaling is used rather than stretching the box, because the box has to keep
  // the window's aspect ratio for object-fit: cover to crop the way it should.
  const zoom = wallpaper.blur > 0 ? 1 + (5 * wallpaper.blur) / Math.max(320, Math.min(viewport.w, viewport.h)) : 1;

  // The selection fills the layer exactly.
  const mediaStyle = {
    ...cropMediaStyle(wallpaper.crop),
    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
    transform: zoom !== 1 ? `scale(${zoom.toFixed(4)})` : undefined,
  } as CSSProperties;

  return (
    <div className="wallpaper-layer" aria-hidden>
      {wallpaper.kind === 'scene' ? (
        // Keyed by url: a canvas can only be handed to a worker once, ever, so
        // each source needs its own element.
        <canvas key={url} ref={canvasRef} className="wallpaper-media" style={mediaStyle} />
      ) : wallpaper.kind === 'video' ? (
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
