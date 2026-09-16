import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { extractAccent } from '../lib/accent';
import { shownWallpaper } from '../lib/admin-background';
import { playScene, playsScenesLive, type ScenePlayer } from '../lib/scene/play-scene';
import { sceneStillUrl } from '../lib/scene/render-still';
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
  const identity = useAppStore((s) => s.wallpaperIdentity);
  const admin = useAppStore((s) => s.adminBackground);
  // Held while the dialog is open: it is doing its own work, and a video that
  // nobody is looking at is a video worth pausing.
  const appearanceOpen = useAppStore((s) => s.appearanceOpen);
  /**
   * The administrator's background takes over while the switch is on.
   *
   * An overlay rather than a replacement: the user's own choice stays in the
   * settings untouched, so turning the switch off gives it straight back, and
   * nothing downstream has to know there are two sources. Everything the layer
   * reads - kind, framing, darkness, whether a scene animates - comes from the
   * administrator while it is showing.
   */
  const wallpaper = shownWallpaper(settings, admin);
  const locked = wallpaper !== settings;
  const url = locked ? wallpaper.url : ownUrl;
  // A blob URL is different on every page load; a file in the server's
  // backgrounds folder is not, so the composed frame is remembered by name - and
  // by the server's hash of its contents when there is one, which is what says a
  // replaced file is a different wallpaper rather than the same name again.
  const identityKey = locked
    ? `admin:${admin?.hash ?? `${admin?.file ?? ''}:${admin?.bytes ?? 0}`}`
    : identity;
  /**
   * What the container may be remembered as, if anything.
   *
   * Only identities that come from the bytes: the administrator's file has a
   * hash from the server, and a file kept in this browser has its name, size and
   * timestamp. A plain URL has neither - the same address can serve something
   * else tomorrow - so those are downloaded as before and left to the browser's
   * own cache, which revalidates.
   */
  const containerIdentity = locked
    ? admin?.hash
      ? `admin:${admin.hash}`
      : null
    : identity && !/^https?:/i.test(identity)
      ? identity
      : null;
  const pushToast = useAppStore((s) => s.pushToast);
  const setAccent = useAppStore((s) => s.setAccent);
  const setLoading = useAppStore((s) => s.setWallpaperLoading);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playerRef = useRef<ScenePlayer | null>(null);
  /** Diagnostics are worth saying once, not once per frame. */
  const diagnosticSaid = useRef(false);
  const [failed, setFailed] = useState(false);
  const [still, setStill] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  /**
   * A scene is played live only where the switch says so and the browser can.
   *
   * Otherwise it is shown as a picture of itself - the same container
   * composited into one frame - which is the choice the switch is offering.
   * Deciding that here, rather than once when the wallpaper is picked, is what
   * lets the switch take effect on its own.
   */
  const live = playsScenesLive(wallpaper.kind, wallpaper.dynamicScene);

  /**
   * Says what went wrong, and whose background it was.
   *
   * A wallpaper that does not arrive is otherwise silence: the layer draws
   * nothing, which looks the same as a background nobody configured. When it is
   * the administrator's, name it and name the URL - a deployment under a sub
   * path asks the wrong server, and that 404 is the whole story.
   */
  const report = (message: string) => {
    setFailed(true);
    pushToast({
      title: locked ? '管理员设置的默认背景加载失败' : '动态场景已停止',
      message: locked ? `${message}（${url}）` : message,
      tone: 'error',
    });
  };

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
   * The library downloads and parses the container, decodes its textures,
   * compiles its shaders and draws every frame - in a worker, so the app's own
   * interface is not competing with a wallpaper for the main thread. Nothing
   * has to stand down while the appearance dialog is open: a worker renders
   * whether or not anybody is watching, and the dialog's own picture of the
   * scene is a separate, one-off render.
   *
   * One canvas per player: handing a canvas to a worker is a one-time move, so
   * the element is keyed on what it is showing and a new one is mounted for
   * every player.
   */
  useEffect(() => {
    if (!live || !url) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let cancelled = false;
    let player: ScenePlayer | null = null;
    /** Stops a load that is no longer the one being shown. */
    const controller = new AbortController();

    // A failure after the first frame used to be invisible: nothing was
    // listening, and the canvas simply froze on its last frame looking like a
    // still. Say so instead.
    const fail = (message: string) => {
      if (cancelled) return;
      report(message);
    };

    // The container is fetched here rather than by the worker, so that the wait
    // has a number; the worker's own download would be invisible from this side.
    setLoading({ label: '正在载入动态场景…', ratio: null });

    void (async () => {
      try {
        player = await playScene(canvas, url, {
          signal: controller.signal,
          cacheIdentity: containerIdentity,
          onProgress: (loaded, total) => {
            if (cancelled) return;
            const finished = total !== null && loaded >= total;
            setLoading(
              finished
                ? { label: '正在解析场景…', ratio: null }
                : { label: '正在下载场景…', ratio: total ? loaded / total : null },
            );
          },
          onError: fail,
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
        setLoading(null);
      } catch (err) {
        fail((err as Error).message);
        setLoading(null);
      }
    })();

    return () => {
      cancelled = true;
      // A scene that is still loading is stopped where it stands: letting it
      // finish means two containers being parsed for one background.
      controller.abort();
      playerRef.current = null;
      player?.stop();
      setLoading(null);
    };
  }, [live, url, containerIdentity, pushToast, setLoading]);

  /**
   * A scene that is not playing: one frame of the same container.
   *
   * The frame is remembered under the wallpaper's identity rather than its
   * blob URL, which is different on every page load - remembered under that,
   * it would never be found again and every visit would composite 45 MB on the
   * main thread.
   */
  useEffect(() => {
    if (wallpaper.kind !== 'scene' || live || !url) {
      setStill(null);
      return undefined;
    }
    let cancelled = false;
    let made: string | null = null;
    // A cached frame comes back at once; a first one is a download followed by
    // the container being parsed and its textures decoded, which is where the
    // seconds go. The bar covers the download, which is the part that has an
    // answer; the rest says what it is doing.
    setLoading({ label: '正在载入背景…', ratio: null });
    void (async () => {
      try {
        made = await sceneStillUrl(url, `still:${identityKey ?? url}`, (loaded, total) => {
          if (cancelled) return;
          const finished = total !== null && loaded >= total;
          setLoading(
            finished
              ? { label: '正在合成背景…', ratio: null }
              : { label: '正在下载背景…', ratio: total ? loaded / total : null },
          );
        });
        if (cancelled) {
          URL.revokeObjectURL(made);
          return;
        }
        setStill(made);
      } catch (err) {
        if (!cancelled) report((err as Error).message);
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
      setStill(null);
      setLoading(null);
    };
  }, [wallpaper.kind, live, url, identityKey, pushToast, setLoading]);

  /**
   * A picture or a video, while the browser is still fetching it.
   *
   * Nothing to measure here - the element is doing the loading - but a large
   * file over a slow line is the same silence as a scene, so it says the same
   * thing until it arrives.
   */
  useEffect(() => {
    if (wallpaper.kind === 'none' || wallpaper.kind === 'scene' || !url) return undefined;
    setLoading({ label: '正在载入背景…', ratio: null });
    return () => setLoading(null);
  }, [wallpaper.kind, url, setLoading]);

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
  }, [url, wallpaper.kind, wallpaper.autoAccent, live, still, setAccent]);

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

  const picture = wallpaper.kind === 'scene' && !live ? still : url;
  if (wallpaper.kind === 'none' || !picture || !url || failed) return null;

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
      {live ? (
        // Keyed by source and by mode: a canvas that has been handed to a
        // worker cannot be handed to the next one, so every player gets an
        // element of its own. The key changes exactly when the effect that
        // creates the player runs.
        <canvas
          key={`${url}:live`}
          ref={canvasRef}
          className="wallpaper-media"
          style={mediaStyle}
        />
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
          onLoadedData={() => setLoading(null)}
          onError={() => {
            setLoading(null);
            setFailed(true);
          }}
        />
      ) : (
        <img
          key={picture}
          className="wallpaper-media"
          style={mediaStyle}
          src={picture}
          alt=""
          onLoad={() => setLoading(null)}
          onError={() => {
            setLoading(null);
            setFailed(true);
          }}
        />
      )}
      <div className="wallpaper-scrim" style={{ opacity: wallpaper.dim }} />
    </div>
  );
}