import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CUSTOM_EFFECT_SLIDERS,
  CUSTOM_EFFECT_TOGGLES,
  customBackdrop,
  customColors,
  customSwayCurve,
  resolveCustomEffect,
  sceneUnitScale,
  type CustomEffectParams,
  type ResolvedCustomEffect,
  type ResolvedCustomWallpaper,
} from '../lib/wallpaper';
import { Switch } from './ui/primitives';

/**
 * The custom wallpaper: one uploaded picture, a slow sway, and drifting
 * particles.
 *
 * It exists to answer one problem: Wallpaper Engine scenes look good and cost
 * forty megabytes, and the first visit has to download all of it. Here the same
 * kind of look is made of code - the picture is shrunk once in the browser (see
 * wallpaper.ts shrinkWallpaperImage), the sway is a transform the compositor can
 * animate for free, and the particles are a two-dimensional re-implementation of
 * the engine's particle system. What is stored is a few hundred kilobytes of
 * WebP and seven numbers; the CSS placeholder is all there is before a picture
 * has been imported.
 *
 * The particle model follows the Wallpaper Engine defaults this repository's own
 * scene renderer encodes (lib/wallpaper-scene-layers/packages/we-scene/src/
 * render/particles.ts and particle-defaults.ts): value noise on a fixed
 * permutation lattice, a divergence-free curl field built from it, a lifetime
 * initialiser, an alpha fade and a size ramp. The seven exposed controls are the
 * renderer's drift model - rise, speed, forwardRatio - and the sway follows its
 * `oscillateposition` curve: sin for x, cos for y at the same frequency.
 *
 * Everything degrades: no 2D context (SSR, jsdom, an old browser) keeps the
 * picture; reduced motion keeps a still picture and one still particle frame; a
 * hidden tab and an unmounted component stop the loop.
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

/**
 * Everything one particle needs.
 *
 * The first eight fields are the 1.5.x shape (and the tests that came with it);
 * the drift half of the engine model is optional and its defaults are the
 * library's: rise 120 / speed 200 / forwardRatio 0.8 / spread 0.6 in
 * ParticleDriftOptions, and this wallpaper's own defaults come from the Rossi
 * preset (rise 240 / speed 200 / forwardRatio 0.7).
 */
export type CustomParticleConfig = ResolvedCustomWallpaper['particles'] & {
  /** Library drift.rise, px/s. Defaults to 240. */
  rise?: number;
  /** Library drift.forwardRatio, 0 - 1. Defaults to 0.7. */
  direction?: number;
  /** Library drift.spread, radians. Defaults to 0.6. */
  spread?: number;
};

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
/** ParticleDriftOptions defaults from the scene renderer's particles.ts. */
const DEFAULT_DRIFT = { rise: 240, speed: 200, forwardRatio: 0.7, spread: 0.6 };
/** Drift mode keeps 25% of the emitter's velocity as jitter (DRIFT_JITTER). */
const DRIFT_JITTER = 0.25;

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

  // The drift model from particles.ts applyDrift(), with the emitter pointing up
  // (the engine's "0 1 0"): a forward particle follows the emitter direction,
  // the rest (1 - forwardRatio) are blown back, and the spread jitters the angle.
  // A little of the emitter's own velocity is kept as sideways jitter.
  const rise = config.rise ?? DEFAULT_DRIFT.rise;
  const speed = config.speed;
  const forwardRatio = Math.min(1, Math.max(0, config.direction ?? DEFAULT_DRIFT.forwardRatio));
  const spread = config.spread ?? DEFAULT_DRIFT.spread;
  const forward = random() < forwardRatio ? 1 : -1;
  const jitter = (random() * 2 - 1) * spread;
  const jitterX = (random() * 2 - 1) * speed * DRIFT_JITTER;
  const jitterY = (random() * 2 - 1) * speed * DRIFT_JITTER;
  // Canvas y grows downwards: an upward drift is a negative vy.
  particle.vx = -Math.sin(jitter) * speed * forward + jitterX;
  particle.vy = -(rise + Math.cos(jitter) * speed * forward + jitterY);
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
 * Pure and injectable (`random` is only used when a particle respawns), which is
 * what lets a probe assert an exact position for a given seed and time instead
 * of eyeballing a moving picture.
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
    // The engine lets turbulence wobble the upward drift but never turn it into
    // a downward one (particles.ts clamps that at 60% of the drift).
    const baseUp = -particle.vy;
    const wobbleUp = (fy / length) * particle.turbulence;
    const up = baseUp + Math.max(wobbleUp, -baseUp * 0.6);
    particle.x += (particle.vx + (fx / length) * particle.turbulence) * step;
    particle.y -= up * step;
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

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The fixed half of the particle system.
 *
 * The seven controls cover what a viewer can tell apart; everything else is a
 * library default with one value, so it is fixed here rather than exposed as a
 * knob nobody wants to touch:
 * - count: 160 for a full-screen field (the emitter's rate/maxcount territory;
 *   150 is the engine's sphererandom preview rate);
 * - size: 22 scene units through sizerandom's exponent-2 curve (12-50 units),
 *   about 6-25 CSS pixels on a 1080p screen;
 * - opacity: 0.5 stands in for the ember sprite's own texture alpha;
 * - life: 3 s, the middle of lifetimerandom.min 1 / max 5;
 * - turbulence: 0.15, DEFAULT_DRIFT_TURBULENCE in the scene renderer;
 * - spread: 0.6, DEFAULT_DRIFT.spread.
 */
const PARTICLE = {
  count: 160,
  sizeUnits: 22,
  opacity: 0.5,
  life: 3,
  turbulence: 0.15,
  spread: 0.6,
} as const;

/** How many points one sway cycle is sampled into for the compositor. */
const SWAY_SAMPLES = 24;

/**
 * The sway keyframes: one full `oscillateposition` cycle, sampled.
 *
 * `customSwayCurve()` is sin for x and cos for y, and sampling one period keeps
 * the picture's transform a plain keyframe animation the compositor runs without
 * the main thread - the curve only has to be right, not evaluated per frame.
 */
export function customSwayKeyframes(
  effect: ResolvedCustomEffect,
  viewport: { width: number; height: number },
): { x: number[]; y: number[]; scale: number } {
  const amplitude = (effect.amplitude / 100) * Math.min(viewport.width, viewport.height);
  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index <= SWAY_SAMPLES; index += 1) {
    const seconds = index / SWAY_SAMPLES / effect.frequency;
    const point = customSwayCurve(effect.frequency, seconds);
    x.push(Math.round(point.x * amplitude * 100) / 100);
    y.push(Math.round(point.y * amplitude * 100) / 100);
  }
  // The picture has to stay bigger than the frame by twice the sway amplitude,
  // or the bare page shows through at the edge of every swing.
  const scale = 1 + (2 * effect.amplitude) / 100 + 0.01;
  return { x, y, scale };
}

const FALLBACK_COLORS = { a: '#6d4cff', b: '#0ea5e9', surface: '#060a16' };

/** A 2D context, or null where there is none (SSR, jsdom, old browsers). */
function context2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  try {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

/** Does the system ask for reduced motion right now? */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

export interface CustomWallpaperProps {
  /**
   * The wallpaper settings. Only the custom fields are read, so the
   * administrator's BackgroundSettings is accepted here too.
   */
  settings: CustomEffectParams;
  /** The uploaded picture. Without one the neutral theme placeholder shows. */
  url?: string | null;
}

export function CustomWallpaper({ settings, url }: CustomWallpaperProps) {
  const effect = resolveCustomEffect(settings);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState(false);
  /** A picture that will not decode leaves the neutral placeholder to be the wallpaper. */
  const [failed, setFailed] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth || 1280,
    height: typeof window === 'undefined' ? 800 : window.innerHeight || 800,
  }));
  const picture = url && !failed ? url : null;

  // The picture a failed decode replaced is a different wallpaper worth trying.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  // Reduced motion is read from the media query and watched: the system setting
  // can change while the page is open.
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

  // The sway is sized from the window, not from layout: one read on resize.
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth || 1280, height: window.innerHeight || 800 });
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const sway = useMemo(
    () => customSwayKeyframes(effect, viewport),
    [effect.amplitude, effect.frequency, viewport.width, viewport.height],
  );

  // The particle loop. One effect owns the canvas, the simulation and every
  // listener; the cleanup puts all of it back.
  useEffect(() => {
    if (!picture || !effect.particles) return undefined;
    const canvas = canvasRef.current;
    const context = context2d(canvas);
    // No 2D canvas: the picture is the wallpaper and the particles simply do not
    // exist. Nothing to clean up.
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
    let particleColor = '';
    let dark = root.classList.contains('dark');
    const refreshPalette = () => {
      dark = root.classList.contains('dark');
      particleColor = readVariable('--accent').trim() || FALLBACK_COLORS.a;
    };

    let width = 1;
    let height = 1;
    let config = particleConfig(effect, 1);
    let field = createCustomParticles(PARTICLE.count, config, 1, 1);
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
      // scene units/s -> px/s with the library's orthographic volume.
      config = particleConfig(effect, sceneUnitScale(width, height));
      refreshPalette();
    };

    const paint = () => {
      context.clearRect(0, 0, width, height);
      paintCustomParticles(context, field, particleColor, dark);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // A tab that was asleep hands back a huge delta; cap it.
      const delta = Math.min(64, Math.max(0, now - last));
      last = now;
      time += delta / 1000;
      advanceCustomParticles(field, delta / 1000, time, config, width, height);
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
    field = createCustomParticles(PARTICLE.count, config, width, height);
    paint();
    start();

    const onResize = () => {
      layout();
      // The particles are in pixels: a new surface gets a fresh field rather
      // than one squeezed into the old coordinates.
      field = createCustomParticles(PARTICLE.count, config, width, height);
      paint();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    // Switching between the light and dark themes changes the accent the
    // particles are drawn in.
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
    // The drift numbers are what shapes the field; a change is a different field.
  }, [picture, effect.particles, effect.rise, effect.drift, effect.direction, reduced]);

  const animate =
    picture && effect.sway && !reduced
      ? { x: sway.x, y: sway.y }
      : undefined;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-custom-wallpaper
      data-custom-picture={picture ? 'true' : undefined}
      data-custom-sway={effect.sway ? 'true' : 'false'}
      data-custom-particles={effect.particles ? 'true' : 'false'}
    >
      {picture ? (
        <motion.div
          className="absolute inset-0"
          style={{ scale: sway.scale }}
          initial={false}
          animate={animate}
          transition={animate ? { duration: 1 / effect.frequency, repeat: Infinity, ease: 'linear' } : undefined}
        >
          <img
            src={picture}
            alt=""
            data-custom-image
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        </motion.div>
      ) : (
        // No picture yet: a neutral theme gradient, not an editable colour field.
        <div
          data-custom-placeholder
          className="absolute inset-0"
          style={{ background: customBackdrop(customColors('', '')) }}
        />
      )}
      {picture ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden /> : null}
    </div>
  );
}

/** The internal particle config for the resolved seven controls. */
export function particleConfig(effect: ResolvedCustomEffect, unitScale: number): CustomParticleConfig {
  return {
    count: PARTICLE.count,
    size: PARTICLE.sizeUnits * unitScale,
    opacity: PARTICLE.opacity,
    life: PARTICLE.life,
    speed: effect.drift * unitScale,
    turbulence: PARTICLE.turbulence,
    color: '',
    wind: 0,
    rise: effect.rise * unitScale,
    direction: effect.direction,
    spread: PARTICLE.spread,
  };
}

/* -------------------------------------------------------------------------- */
/* The controls both dialogs draw                                             */
/* -------------------------------------------------------------------------- */

/** The current value of each slider, from the resolved settings. */
function resolvedValue(effect: ResolvedCustomEffect, key: string): number {
  switch (key) {
    case 'customSwayAmplitude':
      return effect.amplitude;
    case 'customSwayFrequency':
      return effect.frequency;
    case 'customParticleRise':
      return effect.rise;
    case 'customParticleDrift':
      return effect.drift;
    case 'customParticleDirection':
      return effect.direction;
    default:
      return 0;
  }
}

export interface CustomWallpaperControlsProps {
  /** The values being edited; missing ones show the defaults. */
  value: CustomEffectParams;
  onChange: (patch: CustomEffectParams) => void;
  disabled?: boolean;
}

/**
 * The seven controls, shared by the appearance dialog and the administrator's
 * settings dialog so both describe the background in the same terms.
 */
export function CustomWallpaperControls({ value, onChange, disabled = false }: CustomWallpaperControlsProps) {
  const effect = resolveCustomEffect(value);
  return (
    <div className="space-y-3" data-custom-controls>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {CUSTOM_EFFECT_TOGGLES.map((toggle) => {
          const checked = toggle.key === 'customSway' ? effect.sway : effect.particles;
          return (
            <label key={toggle.key} className="flex items-center gap-2">
              <Switch
                checked={checked}
                disabled={disabled}
                onChange={(next) => onChange({ [toggle.key]: next } as CustomEffectParams)}
              />
              <span className="text-[12px] text-[var(--muted)]">{toggle.label}</span>
            </label>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {CUSTOM_EFFECT_SLIDERS.map((control) => {
          const current = resolvedValue(effect, String(control.key));
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
                onChange={(event) => onChange({ [control.key]: Number(event.target.value) } as CustomEffectParams)}
                className="w-full accent-[var(--accent)]"
              />
            </label>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--faint)]">
        晃动与粒子参数对齐 wallpaper-scene-layers 的 drift / oscillateposition 语义：频率是每秒往复次数，
        粒子的升降与漂移以场景单位/秒计（库的 3840×2160 正交视图）。
      </p>
    </div>
  );
}
