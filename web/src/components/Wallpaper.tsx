import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { extractAccent } from '../lib/accent';
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
  const settings = useAppStore((s) => s.wallpaper);
  const ownUrl = useAppStore((s) => s.wallpaperUrl);
  const admin = useAppStore((s) => s.adminBackground);
  // While this is open the layer does not render: the dialog is rendering the
  // same scene for its own preview, and there is one main thread.
  const appearanceOpen = useAppStore((s) => s.appearanceOpen);

  /**
   * The administrator's background takes over while the switch is on.
   *
   * An overlay rather than a replacement: the user's own choice stays in the
   * settings untouched, so turning the switch off gives it straight back, and
   * nothing downstream has to know there are two sources.
   */
  const locked = settings.useAdminBackground && admin?.configured === true;
  const wallpaper = locked
    ? { ...settings, kind: admin?.kind ?? 'image', source: 'url' as const, url: admin?.url ?? '' }
    : settings;
  const url = locked ? (admin?.url ?? '') : ownUrl;
  const pushToast = useAppStore((s) => s.pushToast);
  const setAccent = useAppStore((s) => s.setAccent);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<ScenePlayer | null>(null);
  /** Diagnostics are worth saying once, not once per frame. */
  const diagnosticSaid = useRef(false);
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
    if (!video || wallpaper.kind !== 'video') return;
    // Held while the dialog is open, for the same reason the scene is: the
    // dialog is doing its own work and the picture behind it is not being
    // looked at.
    if (appearanceOpen) {
      video.pause();
      return;
    }
    video.play().catch(() => {
      /* autoplay may be blocked; the poster/first frame still shows */
    });
  }, [url, wallpaper.kind, appearanceOpen]);

  /**
   * A live scene.
   *
   * The renderer parses the container, decodes its textures and compiles its
   * shaders on the main thread, and it is not cheap: tens of megabytes and a
   * few seconds. The appearance dialog needs a picture of the same scene for
   * its crop editor, which costs the same again - and running both at once is
   * what made a wallpaper switch look like the server had died.
   *
   * So the layer stands down while the dialog is up. It keeps whatever frame it
   * last drew, which costs nothing, and starts again when the dialog closes.
   * One render at a time, on the one thread there is.
   */
  useEffect(() => {
    if (wallpaper.kind !== 'scene' || !url) return undefined;
    if (appearanceOpen) return undefined;
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
        // No size hints: the library sizes itself from the canvas, which the
        // layer has already laid out at the size the screen needs.
        player = await playScene(canvas, bytes, {
          onError: report,
          // Said once, and nothing is stopped. A scene that uses an effect the
          // library cannot compile still renders the rest of itself, and the
          // alternative - reporting it as a failure - took the whole wallpaper
          // down and repeated the same toast for as long as it kept drawing.
          onDiagnostic: (message) => {
            if (diagnosticSaid.current) return;
            diagnosticSaid.current = true;
            pushToast({ title: '场景里有部分效果无法渲染', message, tone: 'info' });
          },
        });
        if (cancelled) {
          player.stop();
          return;
        }
        playerRef.current = player;
        if (document.hidden) player.pause();

        // The crop editor's picture is rendered by the dialog now, from the
        // container itself. Capturing this canvas instead made the editor's
        // frame depend on the selection: the canvas is sized by the crop, so
        // narrowing the selection widened the canvas, which widened the capture,
        // which reshaped the frame the selection was being drawn in. Every drag
        // moved the ground it was measured against.

        // Nothing to warn about any more: the library keeps only the layers its
        // preset asks for and draws all of them, so there is no count of layers
        // that failed to resolve.
        void player.info;
      } catch (err) {
        report((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      playerRef.current = null;
      player?.stop();
    };
  }, [wallpaper.kind, url, appearanceOpen, pushToast]);

  /**
   * Take the interface colour from the picture.
   *
   * Delayed a little because a video has no frame and a live scene has no
   * canvas content until something has been drawn; sampling immediately would
   * read an empty buffer and give up. Failure is not an error - it means the
   * picture came from another origin, and the theme's colour stays.
   */
  useEffect(() => {
    if (wallpaper.kind === 'none' || !url || !wallpaper.autoAccent) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const media = document.querySelector('.wallpaper-media');
      if (!media) return;
      setAccent(extractAccent(media as unknown as CanvasImageSource));
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url, wallpaper.kind, wallpaper.autoAccent, setAccent]);

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
