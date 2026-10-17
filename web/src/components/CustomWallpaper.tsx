import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  CUSTOM_WALLPAPER_SLIDERS,
  customBackdrop,
  resolveCssColor,
  resolveCustomWallpaper,
  type CustomWallpaperParams,
  type ResolvedCustomWallpaper,
} from '../lib/wallpaper';

/**
 * The custom wallpaper: an imported picture that drifts slowly, with particles
 * floating over it.
 *
 * It exists to answer one problem: Wallpaper Engine scenes look good and cost
 * forty megabytes. Here the same kind of look is made of code - the picture is
 * shrunk once in the browser (see wallpaper.ts shrinkWallpaperImage), the drift
 * is a CSS transform the compositor can animate for free, and the particles are
 * a two-dimensional re-implementation of the engine's particle system. What is
 * stored is a few hundred kilobytes of WebP and a dozen numbers.
 *
 * The particle model follows the Wallpaper Engine defaults this repository's
 * own scene renderer encodes (lib/wallpaper-scene-layers/packages/we-scene/src/
 * render/particles.ts and particle-defaults.ts): value noise on a fixed
 * permutation lattice, a divergence-free curl field built from it, a lifetime
 * initialiser, an alpha fade and a size ramp. The numbers that can be traced to
 * the engine are named in wallpaper.ts CUSTOM_DEFAULTS.
 *
 * Everything degrades: no 2D context (SSR, jsdom, an old browser) keeps the
 * picture and the CSS backdrop; reduced motion keeps the picture and draws one
 * still frame of particles; a hidden tab and an unmounted component stop the
 * loop.
 */

/* -------------------------------------------------------------------------- */
/* The particle system                                                        */
/* -------------------------------------------------------------------------- */

/** One particle, in CSS pixels and seconds. */
export interface CustomParticle {
  x: number;
  y: number;
  /** Base drift velocity, px/s. */
  vx: number;
  vy: number;
  /** Radius, px. */
  size: number;
  /** Starting opacity, before the fade in/out multiplies it. */
  alpha: number;
  lifeMax: number;
  age: number;
  seed: number;
  /** How hard the curl field pushes this one, px/s. */
  turbulence: number;
  phase: number;
}

export type CustomParticleConfig = ResolvedCustomWallpaper['particles'];

/*
 * 3D value noise and its curl, re-implemented from the scene renderer's
 * particles.ts (same permutation table, same construction) rather than imported:
 * that module pulls the whole Wallpaper Engine scene parser with it, and all
 * this needs is 40 lines of noise.
 */
const PERMUTATION = new Uint8Array(512);
(() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = i;
  // Deterministic shuffle, so the same wallpaper looks the same every run.
  let seed = 1337;
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    const swap = table[i];
    table[i] = table[j];
    table[j] = swap;
  }
  for (let i = 0; i < 512; i += 1) PERMUTATION[i] = table[i & 255];
})();

const fadeCurve = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

const lattice = (x: number, y: number, z: number): number =>
  PERMUTATION[(PERMUTATION[(PERMUTATION[x & 255] + (y & 255)) & 255] + (z & 255)) & 255] / 255;

/** 3D value noise in [-1, 1]; the third axis is the flow field's clock. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fadeCurve(x - xi);
  const v = fadeCurve(y - yi);
  const w = fadeCurve(z - zi);
  const c000 = lattice(xi, yi, zi);
  const c100 = lattice(xi + 1, yi, zi);
  const c010 = lattice(xi, yi + 1, zi);
  const c110 = lattice(xi + 1, yi + 1, zi);
  const c001 = lattice(xi, yi, zi + 1);
  const c101 = lattice(xi + 1, yi, zi + 1);
  const c011 = lattice(xi, yi + 1, zi + 1);
  const c111 = lattice(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return (y0 + (y1 - y0) * w) * 2 - 1;
}

const CURL_SCRATCH: [number, number] = [0, 0];

/**
 * The curl of the noise field: a divergence-free flow, so particles swirl along
 * it instead of piling up in sinks. Same construction as the scene renderer.
 */
export function curlNoise(x: number, y: number, z: number, out: [number, number] = CURL_SCRATCH): [number, number] {
  const epsilon = 0.75;
  const up = noise3(x, y + epsilon, z);
  const down = noise3(x, y - epsilon, z);
  const right = noise3(x + epsilon, y, z);
  const left = noise3(x - epsilon, y, z);
  out[0] = (up - down) / (2 * epsilon);
  out[1] = -(right - left) / (2 * epsilon);
  return out;
}

/** The engine's turbulence.scale default: how quickly the field changes in space. */
const TURBULENCE_SPATIAL = 0.0025;
/** turbulence.timescale 10 x the renderer's 0.02 time factor. */
const TURBULENCE_TIME = 0.2;

/** Seeds one particle. Deterministic when `random` is injected. */
function seedParticle(
  particle: CustomParticle,
  config: CustomParticleConfig,
  width: number,
  height: number,
  random: () => number,
): void {
  particle.x = random() * width;
  particle.y = random() * height;
  // lifetimerandom.min 1 / max 5: a spread around the configured lifetime.
  particle.lifeMax = Math.max(0.1, config.life * (0.7 + random() * 0.6));
  particle.age = 0;
  // sizerandom uses exponent 2, which is what keeps most particles small.
  particle.size = Math.max(0.2, config.size * (0.55 + Math.pow(random(), 2) * 1.7));
  // alpharandom.min 1 ... the configured opacity is the ceiling here.
  particle.alpha = config.opacity * (0.5 + random() * 0.5);
  particle.seed = random() * 1000;
  particle.phase = random() * Math.PI * 2;
  particle.turbulence = config.turbulence * config.speed * (0.5 + random() * 1.5);

  const angle = (config.wind * Math.PI) / 180;
  const speed = config.speed * (0.6 + random() * 0.8);
  // drift.forwardRatio is 0.8 in the engine: most particles follow the wind,
  // the rest are blown back, but all of them still rise.
  const forward = random() < 0.8 ? 1 : -1;
  particle.vx = Math.cos(angle) * speed * forward;
  particle.vy = -Math.abs(Math.sin(angle)) * speed - config.speed * 0.3;
}

/** A field of `count` particles spread over a `width` x `height` picture. */
export function createCustomParticles(
  count: number,
  config: CustomParticleConfig,
  width: number,
  height: number,
  random: () => number = Math.random,
): CustomParticle[] {
  const particles: CustomParticle[] = [];
  for (let index = 0; index < Math.max(0, Math.round(count)); index += 1) {
    const particle: CustomParticle = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 1,
      alpha: 0,
      lifeMax: 1,
      age: 0,
      seed: random() * 1000,
      turbulence: 0,
      phase: 0,
    };
    seedParticle(particle, config, width, height, random);
    // Already part-way through a life: a page that opens with an empty screen
    // and fills over the next few seconds looks like a broken wallpaper.
    particle.age = random() * particle.lifeMax * 0.9;
    particles.push(particle);
  }
  return particles;
}

/**
 * Advances the simulation by `dt` seconds.
 *
 * Pure and injectable (`random` is only used when a particle respawns), which
 * is what lets a probe assert an exact position for a given seed and time
 * instead of eyeballing a moving picture.
 */
export function advanceCustomParticles(
  particles: CustomParticle[],
  dt: number,
  time: number,
  config: CustomParticleConfig,
  width: number,
  height: number,
  random: () => number = Math.random,
): void {
  const step = Math.min(Math.max(dt, 0), 1 / 20);
  const clock = time * TURBULENCE_TIME;
  for (const particle of particles) {
    particle.age += step;
    if (particle.age >= particle.lifeMax) {
      seedParticle(particle, config, width, height, random);
      continue;
    }
    // The field is a direction, not displacement: normalise it before giving it
    // the particle's own turbulence speed, exactly as the scene renderer does.
    const [fx, fy] = curlNoise(
      particle.x * TURBULENCE_SPATIAL + particle.phase,
      particle.y * TURBULENCE_SPATIAL - particle.phase,
      clock + particle.phase,
      CURL_SCRATCH,
    );
    const length = Math.hypot(fx, fy) || 1;
    const vx = particle.vx + (fx / length) * particle.turbulence;
    const vy = particle.vy + (fy / length) * particle.turbulence;
    particle.x += vx * step;
    particle.y += vy * step;
    // Nothing that has left the screen is ever coming back: respawn it on the
    // other side instead of keeping a particle nobody can see.
    if (particle.x < -32 || particle.x > width + 32 || particle.y < -32 || particle.y > height + 32) {
      seedParticle(particle, config, width, height, random);
    }
  }
}

/** Where a particle is in its life, 0 (born) - 1 (dying). */
export function particleLifeRatio(particle: CustomParticle): number {
  return particle.lifeMax > 0 ? Math.min(1, particle.age / particle.lifeMax) : 1;
}

/**
 * How visible and how large a particle is right now.
 *
 * The engine spells these as two operators: alphafade (fadein 0.1, fadeout 0.9)
 * and sizechange (1 -> 0 from the middle of the life). Combined here because a
 * background has no use for them separately.
 */
export function particleAppearance(particle: CustomParticle): { alpha: number; size: number } {
  const ratio = particleLifeRatio(particle);
  const fadeIn = Math.min(1, particle.age / Math.max(0.001, particle.lifeMax * 0.12));
  const fadeOut = Math.min(1, (1 - ratio) / 0.3);
  const shrink = ratio <= 0.5 ? 1 : 1 - ((ratio - 0.5) / 0.5) * 0.8;
  return { alpha: particle.alpha * fadeIn * fadeOut, size: particle.size * shrink };
}

/** Draws the particles over whatever is already on the canvas. */
export function paintCustomParticles(
  context: CanvasRenderingContext2D,
  particles: CustomParticle[],
  color: string,
  dark: boolean,
): void {
  context.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  context.fillStyle = color;
  for (const particle of particles) {
    const appearance = particleAppearance(particle);
    if (appearance.alpha <= 0.002 || appearance.size <= 0.1) continue;
    context.globalAlpha = appearance.alpha;
    context.beginPath();
    context.arc(particle.x, particle.y, appearance.size, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

/**
 * The colour-field backdrop the first version drew.
 *
 * Still here for the wallpaper that has no picture: three soft radial fields
 * wandering on sine paths. On a dark theme they add light; on a light one they
 * tint the surface, because adding light to white only makes white.
 */
export function paintCustomField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  colors: { a: string; b: string; surface: string },
  drift: number,
  dark: boolean,
): void {
  const reach = Math.max(width, height) * 0.62;
  const swing = (0.02 + drift * 0.09) * Math.min(width, height);
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  context.globalAlpha = dark ? 0.85 : 0.5;
  const fields = [
    { color: colors.a, x: 0.28, y: 0.3, phase: 0, swayX: 0.9, swayY: 0.7 },
    { color: colors.b, x: 0.74, y: 0.62, phase: 2.1, swayX: 0.7, swayY: 1 },
    { color: colors.a, x: 0.5, y: 0.92, phase: 4.2, swayX: 1, swayY: 0.6 },
  ];
  for (const field of fields) {
    const x = field.x * width + Math.sin(time * 0.16 + field.phase) * swing * field.swayX;
    const y = field.y * height + Math.cos(time * 0.12 + field.phase) * swing * field.swayY;
    const glow = context.createRadialGradient(x, y, 0, x, y, reach);
    glow.addColorStop(0, field.color);
    glow.addColorStop(1, 'transparent');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

const FALLBACK_COLORS = { a: '#6d4cff', b: '#0ea5e9', surface: '#060a16' };

/** Does the system ask for reduced motion right now? */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** A 2D context, or null where there is none (SSR, jsdom, old browsers). */
function context2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  try {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

export interface CustomWallpaperProps {
  /**
   * The wallpaper settings. Only the custom fields are read, so the
   * administrator's BackgroundSettings is accepted here too.
   */
  settings: CustomWallpaperParams;
  /** The imported picture, when there is one; null draws the colour field. */
  url?: string | null;
}

export function CustomWallpaper({ settings, url }: CustomWallpaperProps) {
  const custom = resolveCustomWallpaper(settings);
  const { particles } = custom;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState(false);
  /** A picture that will not decode leaves the colour field to be the wallpaper. */
  const [failed, setFailed] = useState(false);
  const picture = url && !failed ? url : null;
  const backdrop = customBackdrop(custom.colors);

  // The picture a failed decode replaced is a different wallpaper worth trying.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  // Reduced motion is read from the media query rather than from a prop, and it
  // is watched: the setting can change while the page is open.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches === true);
    const onChange = () => setReduced(query.matches === true);
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else {
      const legacy = query as MediaQueryList & { addListener?: (listener: () => void) => void };
      legacy.addListener?.(onChange);
    }
    return () => {
      if (typeof query.removeEventListener === 'function') query.removeEventListener('change', onChange);
      else {
        const legacy = query as MediaQueryList & { removeListener?: (listener: () => void) => void };
        legacy.removeListener?.(onChange);
      }
    };
  }, []);

  // The particle loop. One effect owns the canvas, the simulation and every
  // listener; the cleanup puts all of it back.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = context2d(canvas);
    // No 2D canvas: the picture (or the CSS backdrop) is the wallpaper and the
    // particles simply do not exist. Nothing to clean up.
    if (!canvas || !context) return undefined;

    const root = document.documentElement;
    const readVariable = (name: string) => {
      try {
        return getComputedStyle(root).getPropertyValue(name);
      } catch {
        return '';
      }
    };
    /** Resolved once per layout / theme change, never per frame. */
    let palette: { a: string; b: string; surface: string; particle: string } = {
      ...FALLBACK_COLORS,
      particle: FALLBACK_COLORS.a,
    };
    let dark = root.classList.contains('dark');
    const refreshPalette = () => {
      dark = root.classList.contains('dark');
      palette = {
        a: resolveCssColor(custom.colors.a, readVariable, FALLBACK_COLORS.a),
        b: resolveCssColor(custom.colors.b, readVariable, FALLBACK_COLORS.b),
        surface: readVariable('--surface').trim() || (dark ? '#060a16' : '#f4f5fb'),
        particle: resolveCssColor(particles.color, readVariable, ''),
      };
      if (!palette.particle) palette.particle = readVariable('--accent').trim() || FALLBACK_COLORS.a;
    };

    let width = 1;
    let height = 1;
    let field = createCustomParticles(particles.count, particles, 1, 1);
    let raf = 0;
    let running = false;
    let last = 0;
    let time = 0;

    const layout = () => {
      // A retina screen is worth two pixels per CSS pixel and no more.
      const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      width = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
      height = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      refreshPalette();
    };

    const paint = () => {
      if (picture) {
        // The picture is an <img> of its own being moved by the compositor; the
        // canvas only carries the particles over it.
        context.clearRect(0, 0, width, height);
      } else {
        paintCustomField(context, width, height, time, palette, custom.drift, dark);
      }
      if (particles.count > 0) paintCustomParticles(context, field, palette.particle, dark);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // A tab that was asleep hands back a huge delta; cap it.
      const delta = Math.min(64, Math.max(0, now - last));
      last = now;
      time += (delta / 1000) * custom.speed;
      advanceCustomParticles(field, delta / 1000, time, particles, width, height);
      paint();
    };

    // The state that watches the media query starts at false on the very first
    // render (the server has no way to know), so the query itself decides
    // whether the first effect run may animate.
    const reduceMotion = () => reduced || prefersReducedMotion();
    const start = () => {
      if (running || reduceMotion() || document.hidden) return;
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
    field = createCustomParticles(particles.count, particles, width, height);
    paint();
    start();

    const onResize = () => {
      layout();
      // The particles are in pixels: a new surface gets a fresh field rather
      // than one squeezed into the old coordinates.
      field = createCustomParticles(particles.count, particles, width, height);
      paint();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    // Switching between the light and dark themes changes the surface and the
    // theme accents the palette falls back to.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        refreshPalette();
        paint();
      });
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    }

    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, [picture, custom.colors.a, custom.colors.b, custom.drift, custom.speed, particles.count, particles.size, particles.opacity, particles.life, particles.speed, particles.turbulence, particles.color, particles.wind, reduced]);

  // The picture's drift: a CSS transform on the compositor, so the main thread
  // is free for typing. Percentage translates are relative to the picture's own
  // box - no layout is read, and no number has to know the viewport.
  const amplitude = 1 + custom.drift * 5;
  const duration = Math.max(4, 32 / custom.speed);
  const animate =
    picture && !reduced
      ? {
          x: [`-${amplitude}%`, `${amplitude}%`, `-${amplitude}%`],
          y: [`${amplitude * 0.6}%`, `-${amplitude * 0.6}%`, `${amplitude * 0.6}%`],
        }
      : undefined;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-custom-wallpaper
      data-custom-picture={picture ? 'true' : undefined}
      style={picture ? undefined : { background: backdrop }}
    >
      {picture ? (
        <motion.img
          key={picture}
          src={picture}
          alt=""
          data-custom-image
          className="absolute inset-0 h-full w-full object-cover"
          style={{ scale: 1.08 }}
          initial={false}
          animate={animate}
          transition={animate ? { duration, repeat: Infinity, ease: 'easeInOut' } : undefined}
          onError={() => setFailed(true)}
        />
      ) : null}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden data-custom-particles />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The controls both dialogs draw                                             */
/* -------------------------------------------------------------------------- */

/** The number each slider currently shows, from the resolved settings. */
function sliderValue(resolved: ResolvedCustomWallpaper, key: string): number {
  switch (key) {
    case 'customDrift':
      return resolved.drift;
    case 'customSpeed':
      return resolved.speed;
    case 'customDensity':
      return resolved.particles.count;
    case 'customParticleSize':
      return resolved.particles.size;
    case 'customParticleOpacity':
      return resolved.particles.opacity;
    case 'customParticleLife':
      return resolved.particles.life;
    case 'customParticleSpeed':
      return resolved.particles.speed;
    case 'customParticleTurbulence':
      return resolved.particles.turbulence;
    case 'customParticleWind':
      return resolved.particles.wind;
    default:
      return 0;
  }
}

export interface CustomWallpaperControlsProps {
  /** The values being edited; missing ones show the defaults. */
  value: CustomWallpaperParams;
  onChange: (patch: CustomWallpaperParams) => void;
  /** Show the two field colours as well (the personal wallpaper, not the admin one). */
  palette?: boolean;
  disabled?: boolean;
}

/**
 * The custom wallpaper's sliders, shared by the appearance dialog and the
 * administrator's settings dialog so both describe the background in the same
 * terms. `CUSTOM_WALLPAPER_SLIDERS` is the single list; this renders it.
 */
export function CustomWallpaperControls({ value, onChange, palette = false, disabled = false }: CustomWallpaperControlsProps) {
  const resolved = resolveCustomWallpaper(value);
  return (
    <div className="space-y-3" data-custom-controls>
      {palette ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-[var(--muted)]">纯色场配色</span>
          {(
            [
              { key: 'customA' as const, label: '主色', fallback: '#6d4cff' },
              { key: 'customB' as const, label: '辅色', fallback: '#0ea5e9' },
            ] as const
          ).map((field) => (
            <label key={field.key} className="flex items-center gap-2">
              <span className="text-[11.5px] text-[var(--faint)]">{field.label}</span>
              <input
                type="color"
                aria-label={`自定义壁纸${field.label}`}
                disabled={disabled}
                value={value[field.key] || field.fallback}
                onChange={(event) => onChange({ [field.key]: event.target.value } as CustomWallpaperParams)}
                className="h-7 w-10 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
              />
            </label>
          ))}
          {value.customA || value.customB ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ customA: '', customB: '' })}
              className="focus-ring rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              恢复主题色
            </button>
          ) : (
            <span className="text-[11px] text-[var(--faint)]">当前跟随主题的两个强调色</span>
          )}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        {CUSTOM_WALLPAPER_SLIDERS.map((control) => {
          const current = sliderValue(resolved, String(control.key));
          return (
            <label key={String(control.key)} className="space-y-1.5">
              <span className="flex items-center justify-between text-[12px] text-[var(--muted)]">
                <span>{control.label}</span>
                <span className="text-[var(--faint)]">{control.format(current)}</span>
              </span>
              <input
                type="range"
                aria-label={control.label}
                disabled={disabled}
                min={control.min}
                max={control.max}
                step={control.step}
                value={current}
                onChange={(event) => onChange({ [control.key]: Number(event.target.value) } as CustomWallpaperParams)}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-[var(--muted)]">粒子颜色</span>
        <label className="flex items-center gap-2">
          <input
            type="color"
            aria-label="粒子颜色"
            disabled={disabled}
            value={value.customParticleColor || '#8b6cff'}
            onChange={(event) => onChange({ customParticleColor: event.target.value })}
            className="h-7 w-10 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
          />
        </label>
        {value.customParticleColor ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ customParticleColor: '' })}
            className="focus-ring rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            跟随主题
          </button>
        ) : (
          <span className="text-[11px] text-[var(--faint)]">当前跟随主题强调色</span>
        )}
        <span className="ml-auto text-[11px] text-[var(--faint)]">
          {resolved.particles.count} 个粒子，由应用实时绘制
        </span>
      </div>
    </div>
  );
}
