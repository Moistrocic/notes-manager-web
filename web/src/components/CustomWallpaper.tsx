import { useEffect, useRef } from 'react';
import {
  customBackdrop,
  customParticleCount,
  resolveCssColor,
  type WallpaperColors,
} from '../lib/wallpaper';

/**
 * The custom wallpaper, drawn by the app itself.
 *
 * A wallpaper is usually a file the browser decodes and shows. This one is code:
 * three slowly wandering colour fields and a handful of particles on a canvas,
 * shaped by a palette and three numbers. Nothing is downloaded, nothing is
 * stored but those numbers, and "the wallpaper" is a few hundred bytes of
 * JavaScript rather than forty megabytes of video.
 *
 * Three things are deliberately true of it:
 *
 * - It renders without a canvas. The server (SSR), jsdom and any browser with
 *   no 2D context get a CSS gradient of the same picture, so the background is
 *   never a hole in the page.
 * - It respects reduced motion. Someone who asked their system not to animate
 *   things gets the still gradient, not a slower version of the animation.
 * - It costs what it says: particles are capped, the device pixel ratio is
 *   capped, the drawing surface is measured on resize rather than every frame,
 *   and a tab nobody is looking at does not draw at all.
 */

/** One drifting speck of light. */
interface Particle {
  /** Position in picture units, 0-1, so a resize does not reseed them. */
  x: number;
  y: number;
  /** Radius in CSS pixels. */
  size: number;
  alpha: number;
  /** Personal pace, so they do not move as one sheet. */
  speed: number;
  /** How far it sways sideways, as a fraction of the drift amplitude. */
  sway: number;
  phase: number;
  /** 0 draws with the first colour, 1 with the second. */
  tint: number;
}

/** Everything one frame is drawn from. */
export interface CustomFrame {
  /** CSS pixels: the context is already scaled by the device pixel ratio. */
  width: number;
  height: number;
  /** Seconds of simulated drift, already multiplied by the speed setting. */
  time: number;
  /** The palette with its CSS variables resolved (a canvas cannot read them). */
  colors: { a: string; b: string; surface: string };
  dark: boolean;
  /** Drift amplitude, 0 - 1. */
  drift: number;
  particles: Particle[];
}

/** What to paint if the theme's own colours cannot be read. */
const THEME_COLORS = { a: '#6d4cff', b: '#0ea5e9', surface: '#060a16' };

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5);

/** Keeps a drifting coordinate inside the picture instead of off the edge. */
const wrap = (value: number, size: number) => ((value % size) + size) % size;

/**
 * One frame of the custom wallpaper.
 *
 * Exported because it is the part worth asserting, and not with a screenshot:
 * a moving background has no stable picture to compare. A recording stand-in
 * for the 2D context can say how many particles were drawn and with which
 * colours, which is the contract this component actually has.
 */
export function paintCustomFrame(ctx: CanvasRenderingContext2D, frame: CustomFrame): void {
  const { width, height, time, colors, dark, particles } = frame;
  const reach = Math.max(width, height) * 0.62;
  const swing = (0.02 + clamp01(frame.drift) * 0.09) * Math.min(width, height);

  // The surface first, opaque: the decorative aurora sits behind this layer,
  // and a wallpaper that let it show through would be two backgrounds fighting.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, height);

  // Three colour fields. On a dark theme they add light; on a light one adding
  // light would only make white, so they tint the surface instead.
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  ctx.globalAlpha = dark ? 0.85 : 0.5;
  const fields = [
    { color: colors.a, x: 0.28, y: 0.3, phase: 0, swayX: 0.9, swayY: 0.7 },
    { color: colors.b, x: 0.74, y: 0.62, phase: 2.1, swayX: 0.7, swayY: 1 },
    { color: colors.a, x: 0.5, y: 0.92, phase: 4.2, swayX: 1, swayY: 0.6 },
  ];
  for (const field of fields) {
    const x = field.x * width + Math.sin(time * 0.16 + field.phase) * swing * field.swayX;
    const y = field.y * height + Math.cos(time * 0.12 + field.phase) * swing * field.swayY;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, reach);
    glow.addColorStop(0, field.color);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  // The particles: small, slow, and few. They rise and wrap around, which reads
  // as depth without asking the eye to track anything.
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  for (const particle of particles) {
    const x = wrap(
      particle.x * width + Math.sin(time * 0.3 * particle.speed + particle.phase) * swing * particle.sway,
      width,
    );
    const y = wrap(particle.y * height - time * 12 * particle.speed, height);
    ctx.globalAlpha = dark ? particle.alpha : particle.alpha * 0.7;
    ctx.fillStyle = particle.tint === 1 ? colors.b : colors.a;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** A 2D context, or null where there is none (jsdom, SSR-rehydrated pages, old browsers). */
function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

export interface CustomWallpaperProps {
  /** The two colours, as CSS (a var() reference is allowed and resolved here). */
  colors: WallpaperColors;
  /** Drift amplitude, 0 - 1. */
  drift: number;
  /** Drift speed, 0.2 - 2. */
  speed: number;
  /** Particle count, 0 - 120. */
  density: number;
}

export function CustomWallpaper({ colors, drift, speed, density }: CustomWallpaperProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Rendered on the server, before the effect runs, in jsdom, and anywhere a 2D
  // context is unavailable. The canvas draws over it once it can.
  const backdrop = customBackdrop(colors);
  const { a, b } = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = context2d(canvas);
    // No 2D canvas: the gradient is the wallpaper, and there is nothing to stop.
    if (!context) return undefined;

    const root = document.documentElement;
    const reduced =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const frame: CustomFrame = {
      width: 1,
      height: 1,
      time: 0,
      colors: { ...THEME_COLORS },
      dark: root.classList.contains('dark'),
      drift: clamp01(drift),
      particles: [],
    };

    const readVariable = (name: string) => {
      try {
        return getComputedStyle(root).getPropertyValue(name);
      } catch {
        return '';
      }
    };
    /**
     * Resolve the palette.
     *
     * Once per layout and once per theme change - not once per frame. Reading
     * computed style is a style-and-layout question, and asking it sixty times
     * a second is how an animated background becomes a janky one.
     */
    const refreshPalette = () => {
      frame.colors = {
        a: resolveCssColor(a, readVariable, THEME_COLORS.a),
        b: resolveCssColor(b, readVariable, THEME_COLORS.b),
        surface: readVariable('--surface').trim() || THEME_COLORS.surface,
      };
      frame.dark = root.classList.contains('dark');
      frame.drift = clamp01(drift);
    };

    const count = customParticleCount(density);
    frame.particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.6 + Math.random() * 1.5,
      alpha: 0.12 + Math.random() * 0.38,
      speed: 0.4 + Math.random() * 1.2,
      sway: 0.3 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
      tint: index % 2,
    }));

    let width = 1;
    let height = 1;
    let raf = 0;
    let running = false;
    let last = 0;
    const pace = Number.isFinite(speed) ? Math.min(2, Math.max(0.2, speed)) : 1;

    const draw = () => {
      paintCustomFrame(context, { ...frame, width, height });
    };

    const layout = () => {
      // A retina screen is worth two pixels per CSS pixel and no more: at 3x
      // the same wallpaper costs more than twice the fill rate for a difference
      // nobody can see on a blurred background.
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      width = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
      height = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      refreshPalette();
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // A tab that was asleep hands back a huge delta; cap it, or the background
      // jumps across the screen the moment it wakes up.
      const delta = Math.min(64, Math.max(0, now - last));
      last = now;
      frame.time += (delta / 1000) * pace;
      draw();
    };

    const start = () => {
      if (running || document.hidden || (reduced !== null && reduced.matches)) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };

    layout();
    draw();
    start();

    const onResize = () => {
      layout();
      draw();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    const onMotion = () => {
      if (reduced?.matches) stop();
      draw();
      start();
    };
    const listenMotion = (on: boolean) => {
      if (!reduced) return;
      if (typeof reduced.addEventListener === 'function') {
        if (on) reduced.addEventListener('change', onMotion);
        else reduced.removeEventListener('change', onMotion);
        return;
      }
      // Older Safari spells it addListener/removeListener.
      const legacy = reduced as MediaQueryList & {
        addListener?: (listener: () => void) => void;
        removeListener?: (listener: () => void) => void;
      };
      if (on) legacy.addListener?.(onMotion);
      else legacy.removeListener?.(onMotion);
    };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    listenMotion(true);

    // Switching between the light and dark themes repaints: the surface and the
    // theme's own accents are different colours in each.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        refreshPalette();
        draw();
      });
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    }

    return () => {
      // Nothing keeps drawing after the wallpaper is gone.
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      listenMotion(false);
      observer?.disconnect();
    };
    // The colours are strings, and the three numbers are what shapes the frame:
    // a change to any of them is a different wallpaper.
  }, [a, b, drift, speed, density]);

  return (
    <div className="absolute inset-0" data-custom-wallpaper style={{ background: backdrop }}>
      <canvas ref={canvasRef} className="wallpaper-media h-full w-full" aria-hidden />
    </div>
  );
}
