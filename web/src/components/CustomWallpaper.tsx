import { useEffect, useRef, useState } from 'react';
import {
  CUSTOM_EFFECT_SLIDERS,
  CUSTOM_EFFECT_TOGGLES,
  FULL_CROP,
  cropMediaStyle,
  customBackdrop,
  customColors,
  customSwayCurve,
  resolveCustomEffect,
  sceneUnitScale,
  type CropRect,
  type CustomEffectParams,
  type ResolvedCustomEffect,
  type ResolvedCustomWallpaper,
} from '../lib/wallpaper';
import {
  ParticleSystem,
  createBuiltinImage,
  parseParticleDefinition,
  type ParticleDefinition,
  type ParticleOptions,
} from 'wallpaper-scene-layers';
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

/** A 2D context, or null where there is none (SSR, jsdom, old browsers). */
function context2d(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  try {
    return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The particle look, from the scene renderer's own particle system           */
/* -------------------------------------------------------------------------- */

/**
 * The particle definitions: the Rossi scene's ember sprite ("灰烬大") with its
 * glow child ("emberglow").
 *
 * There are two root definitions below. The "look" one is the engine preset as
 * imported (3-5 s of life, 160 slots, 40/s) and is what the compatibility
 * factory (createLibraryParticles, used by the assertions that pin the library
 * model) runs. The flow one is what the wallpaper runs: identical sprite,
 * colours, size ramp and alpha curve, but a much longer life and the matching
 * slot count / emission rate. The lifetime is the only way an ember can cross
 * the screen: at the default rise of 240 scene units/s a 3-5 s particle climbs
 * 720-1200 units, while the viewport is 2160 units tall, so it used to die in
 * the lower half. 9-12 s of life gives 2160-2880 units of climb - from just
 * below the bottom edge to the top edge and past it - with the same speed
 * setting, and the extra slots keep the density up now that they are spread
 * over the whole screen instead of its bottom 45%.
 *
 * Sizes are in scene units, which the orthographic volume (3840 x 2160, see
 * sceneUnitScale) turns into pixels. The layer in the scene scales its emitter
 * by 2.85; here the emitter box is the screen itself (see spawnEmberPosition).
 */
const EMBER_DEFINITION_JSON: Record<string, unknown> = {
  material: 'materials/presets/ember.json',
  maxcount: 160,
  starttime: 0,
  emitter: [{ name: 'boxrandom', rate: 40, directions: '0 1 0', distancemax: '1920 1080 0' }],
  // The engine's own ember preset, with sizes multiplied by the scene layer's
  // 2.85 scale (50-200 engine units become 142-570 scene units here) and the
  // rate raised so a full screen keeps a similar number of embers in the air.
  initializer: [
    { name: 'lifetimerandom', min: 3, max: 5 },
    { name: 'sizerandom', min: 140, max: 560 },
    { name: 'colorrandom', min: '255 143 102', max: '255 218 108' },
    { name: 'turbulentvelocityrandom', offset: -0.5, scale: 0.1 },
  ],
  operator: [
    { name: 'movement', drag: 0 },
    { name: 'alphafade', fadeintime: 0.1, fadeouttime: 1 },
    { name: 'turbulence', mask: '1 0.4 0', speedmin: 250, speedmax: 1000, phasemin: 5, phasemax: 50, timescale: 50 },
    { name: 'oscillatealpha', frequencymax: 20, scalemin: 0.7 },
    { name: 'sizechange', starttime: 0.7 },
  ],
  renderer: [{ name: 'sprite' }],
};

const EMBER_GLOW_DEFINITION_JSON: Record<string, unknown> = {
  material: 'materials/presets/emberglow.json',
  maxcount: 8,
  starttime: 0,
  emitter: [{ name: 'boxrandom', rate: 0.8, directions: '1 0 0', distancemax: '200 256 0' }],
  initializer: [
    { name: 'lifetimerandom', min: 3, max: 5 },
    { name: 'sizerandom', min: 1200, max: 2400 },
    { name: 'colorrandom', min: '255 196 175', max: '255 221 155' },
    // A tenth of the reference's opacity: on a full-screen wallpaper the same
    // handful of 1000 px halos would wash the whole picture out, whereas in the
    // scene they sit over a dark corner.
    { name: 'alpharandom', exponent: 2, min: 0.02, max: 0.06 },
  ],
  operator: [
    { name: 'movement', gravity: '0 0 0' },
    { name: 'alphafade', fadeintime: 0.5 },
  ],
  renderer: [{ name: 'sprite' }],
};

/** The production root definition: the same embers, long enough to cross. */
const FLOW_EMBER_DEFINITION_JSON: Record<string, unknown> = {
  ...EMBER_DEFINITION_JSON,
  maxcount: 300,
  emitter: [{ name: 'boxrandom', rate: 30, directions: '0 1 0', distancemax: '1920 1080 0' }],
  // ~11 s of life at rise 240: 2160-2880 scene units of climb, i.e. from below
  // the bottom edge to (and past) the top edge. The other keys are the engine
  // preset's own - sprite sizes, colours, fade and size ramp are unchanged.
  initializer: [
    { name: 'lifetimerandom', min: 9, max: 12 },
    { name: 'sizerandom', min: 140, max: 560 },
    { name: 'colorrandom', min: '255 143 102', max: '255 218 108' },
    { name: 'turbulentvelocityrandom', offset: -0.5, scale: 0.1 },
  ],
};

/** Parsed once: the definitions are constants, the systems are per wallpaper. */
const EMBER_DEFINITIONS: { root: ParticleDefinition; glow: ParticleDefinition } = {
  root: parseParticleDefinition(EMBER_DEFINITION_JSON),
  glow: parseParticleDefinition(EMBER_GLOW_DEFINITION_JSON),
};

/** The production pair: the flow root and the same glow child. */
const FLOW_EMBER_DEFINITIONS: { root: ParticleDefinition; glow: ParticleDefinition } = {
  root: parseParticleDefinition(FLOW_EMBER_DEFINITION_JSON),
  glow: EMBER_DEFINITIONS.glow,
};

export interface LibraryParticles {
  root: ParticleSystem;
  glow: ParticleSystem;
}

/** How strongly the curl field bends the flow emitter's paths (0 = straight lines). */
const FLOW_TURBULENCE = 0.05;

function buildSystemPair(options: ParticleOptions, definitions = EMBER_DEFINITIONS): LibraryParticles {
  const root = new ParticleSystem(definitions.root, undefined, options);
  // The glow child mirrors the embers one to one, at a tenth of the opacity and
  // twenty times the size - that pairing is what makes the embers glow.
  const glow = new ParticleSystem(definitions.glow, root, options);
  return { root, glow };
}

/**
 * The library's own drift model, kept as the compatible factory the assertions
 * pin: `ParticleDriftOptions` with rise / speed / forwardRatio and the library's
 * 0.15 turbulence weight. The wallpaper itself uses createFlowParticles(), whose
 * emitter owns the sideways speed instead.
 */
export function createLibraryParticles(effect: ResolvedCustomEffect): LibraryParticles {
  return buildSystemPair({
    drift: {
      rise: effect.rise,
      speed: effect.drift,
      forwardRatio: effect.direction,
      spread: 0.6,
      turbulence: 0.15,
    },
  });
}

/**
 * The systems the wallpaper runs: same ember look, but the emitter (not the
 * library's forwardRatio drift) owns the horizontal velocity.
 *
 * The drift option is reduced to the rise and a small turbulence weight: no
 * speed and no forwardRatio, otherwise the library would add a sideways base of
 * its own under the emitter's. rise 0 also switches the wobble off - drift mode
 * clamps the downward wobble to zero, which would otherwise make "standing
 * still" particles creep upward.
 */
export function createFlowParticles(effect: ResolvedCustomEffect): LibraryParticles {
  return buildSystemPair(
    { drift: { rise: effect.rise, speed: 0, spread: 0, turbulence: effect.rise > 0 ? FLOW_TURBULENCE : 0 } },
    FLOW_EMBER_DEFINITIONS,
  );
}

export function advanceLibraryParticles(systems: LibraryParticles, deltaSeconds: number): void {
  // The library clamps internally as well; clamp before it so both systems share
  // exactly the same clock after a suspended tab.
  const dt = Math.min(Math.max(deltaSeconds, 0), 1 / 20);
  systems.root.update(dt);
  systems.glow.update(dt);
}

/**
 * Runs the simulation forward before the first frame.
 *
 * The scene's ember layer starts empty (the engine spawns as time passes, and the
 * preset's own starttime is 3 s). A wallpaper that is blank for the first three
 * seconds reads as broken, so the background is warmed up to its steady state
 * first - one frame at 60 Hz per step, the same delta the loop feeds it.
 */
export function warmUpLibraryParticles(systems: LibraryParticles, seconds = 3.2): void {
  const steps = Math.ceil(seconds * 60);
  for (let step = 0; step < steps; step += 1) advanceLibraryParticles(systems, 1 / 60);
}

/* -------------------------------------------------------------------------- */
/* The ember field's own emitter: born below the screen, rising into it       */
/* -------------------------------------------------------------------------- */

/**
 * The viewport the field lives in.
 *
 * Positions are in scene units (the library's orthographic volume, 3840x2160),
 * so the emitter and the probes can talk about "below the screen" without
 * depending on where the canvas is on the page.
 */
export interface ParticleField {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Scene units per CSS pixel (see sceneUnitScale). */
  unit: number;
}

/** The three numbers the emitter reads (the rest of the look is fixed preset). */
export interface ParticleFlow {
  /** Upward speed, scene units per second. */
  rise: number;
  /** Largest sideways speed, scene units per second. */
  drift: number;
  /** Probability a particle moves right, 0 - 1. */
  direction: number;
}

/** How far below the bottom edge a particle is born, before its own random extra. */
const SPAWN_GAP = 20;
const SPAWN_JITTER = 80;

/** One particle's birth, in scene units. */
export interface SpawnedEmber {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Where a new ember appears: somewhere along the width, strictly below the
 * bottom edge so the whole sprite starts off screen.
 *
 * `halfSize` is the sprite's half width in scene units; the clearance includes
 * it, so even the largest ember cannot have its centre inside the viewport.
 * Pure: the random source is injected.
 */
export function spawnEmberPosition(
  field: ParticleField,
  halfSize: number,
  random: () => number,
): { x: number; y: number } {
  const unit = Math.max(0.0001, field.unit);
  const halfWidth = field.width / (2 * unit);
  const bottom = -field.height / (2 * unit);
  const clearance = Math.max(0, halfSize) + SPAWN_GAP + random() * SPAWN_JITTER;
  return {
    // Across the full width, in scene units around the centre.
    x: (random() * 2 - 1) * halfWidth,
    y: bottom - clearance,
  };
}

/**
 * The speed a new ember is born with.
 *
 * Sideways: the magnitude is uniform over [0, drift] and the sign is right with
 * probability `direction` - 0.7 means about 70% of the particles go right.
 * Upward: rise with ±15% jitter, so the field does not move as one sheet while
 * the mean stays rise; rise 0 stays exactly 0 (a particle born below the screen
 * then never enters it, which is the honest reading of that setting).
 * Pure: the random source is injected.
 */
export function spawnEmberVelocity(flow: ParticleFlow, random: () => number): { vx: number; vy: number } {
  const direction = Math.min(1, Math.max(0, Number(flow.direction) || 0));
  const drift = Math.max(0, Number(flow.drift) || 0);
  const rise = Math.max(0, Number(flow.rise) || 0);
  const right = random() < direction;
  const speed = random() * drift;
  const vertical = rise * (0.85 + random() * 0.3);
  return { vx: (right ? 1 : -1) * speed, vy: vertical };
}

/** Position and velocity of one birth; the loop and the probes use the same call. */
export function spawnEmber(
  field: ParticleField,
  flow: ParticleFlow,
  halfSize: number,
  random: () => number,
): SpawnedEmber {
  return { ...spawnEmberPosition(field, halfSize, random), ...spawnEmberVelocity(flow, random) };
}

/** What one step of the field did. */
export interface ParticleSpawnStats {
  spawned: number;
  /** Born moving right / left / with no sideways speed (drift = 0). */
  right: number;
  left: number;
  stationary: number;
  /** Spawns whose birth position was strictly below the viewport bottom. */
  belowViewport: number;
  /** Embers that left through the top edge and were reclaimed this step. */
  recycled: number;
}

/** What was alive last step, so a respawn (dead -> alive) can be recognised. */
export interface ParticleFlowState {
  seen: Uint8Array;
  stats: ParticleSpawnStats;
}

function emptySpawnStats(): ParticleSpawnStats {
  return { spawned: 0, right: 0, left: 0, stationary: 0, belowViewport: 0, recycled: 0 };
}

export function createParticleFlowState(systems: LibraryParticles): ParticleFlowState {
  return { seen: new Uint8Array(systems.root.slots.length), stats: emptySpawnStats() };
}

/**
 * Re-plants every particle that spawned this step below the screen and gives it
 * the emitter's velocity.
 *
 * The vendored ParticleSystem has no spawn hook - its emitter picks a random box
 * around the origin and the host cannot influence it - so this is the one seam
 * where the host takes over: the slot array is public, and the drift system only
 * touches a particle's `driftVelocity` at birth. Replacing position, velocity
 * and driftVelocity here is exactly what a custom emitter would have produced;
 * the turbulence operator then keeps flowing on top of that base velocity.
 */
export function placeSpawnedEmbers(
  systems: LibraryParticles,
  state: ParticleFlowState,
  field: ParticleField,
  flow: ParticleFlow,
  random: () => number = Math.random,
): ParticleSpawnStats {
  const stats = emptySpawnStats();
  const slots = systems.root.slots;
  const bottom = -field.height / (2 * Math.max(0.0001, field.unit));
  for (let index = 0; index < slots.length; index += 1) {
    const particle = slots[index];
    const alive = particle.alive;
    const wasAlive = state.seen[index] === 1;
    state.seen[index] = alive ? 1 : 0;
    if (!alive || wasAlive) continue;
    const ember = spawnEmber(field, flow, particle.sizeStart / 2, random);
    particle.position = [ember.x, ember.y, 0];
    particle.velocity = [ember.vx, ember.vy, 0];
    particle.driftVelocity = [ember.vx, ember.vy, 0];
    stats.spawned += 1;
    if (ember.vx > 1e-6) stats.right += 1;
    else if (ember.vx < -1e-6) stats.left += 1;
    else stats.stationary += 1;
    if (ember.y < bottom) stats.belowViewport += 1;
  }
  state.stats = stats;
  return stats;
}

/**
 * Reclaims embers that have climbed out through the top edge.
 *
 * A particle that is fully above the viewport is invisible but still occupies a
 * slot, so at a high `rise` a third of the field would be spent on particles
 * nobody can see and the screen would get thinner. Freeing the slot makes the
 * emitter spawn its replacement at the bottom, which keeps the visible density
 * roughly constant as the rise slider changes how long the crossing takes. The
 * slot is marked seen=0 so the next step recognises the replacement as a birth.
 */
export function recycleEscapedEmbers(
  systems: LibraryParticles,
  state: ParticleFlowState,
  field: ParticleField,
): number {
  const top = field.height / (2 * Math.max(0.0001, field.unit));
  let recycled = 0;
  const slots = systems.root.slots;
  for (let index = 0; index < slots.length; index += 1) {
    const particle = slots[index];
    if (!particle.alive) continue;
    // Conservative half-size: with the size ramp the sprite only shrinks, so
    // once the full-size half is above the edge the whole sprite is too.
    if (particle.position[1] - particle.sizeStart / 2 <= top) continue;
    particle.alive = false;
    state.seen[index] = 0;
    recycled += 1;
  }
  return recycled;
}

/**
 * One step of the field: simulate, reclaim the embers that left through the top,
 * re-plant the new ones, then mirror them to the glow child. The order matters:
 * the placement runs between the two updates because the child copies its
 * parent's position while updating, so a spawn repaired after the child would
 * leave a one frame ghost at the old emitter box.
 */
export function advanceParticleFlow(
  systems: LibraryParticles,
  state: ParticleFlowState,
  field: ParticleField,
  flow: ParticleFlow,
  deltaSeconds: number,
  random: () => number = Math.random,
): ParticleSpawnStats {
  // The library clamps internally as well; clamp before it so both systems share
  // exactly the same clock after a suspended tab.
  const dt = Math.min(Math.max(deltaSeconds, 0), 1 / 20);
  systems.root.update(dt);
  const recycled = recycleEscapedEmbers(systems, state, field);
  const stats = placeSpawnedEmbers(systems, state, field, flow, random);
  stats.recycled = recycled;
  systems.glow.update(dt);
  return stats;
}

/**
 * Runs the field forward before the first frame.
 *
 * The scene's ember layer starts empty. A wallpaper that is blank for the first
 * seconds reads as broken, so the field is warmed up to its steady state first -
 * by the time it appears, the embers are spread along the whole bottom-to-top
 * path instead of bunched at the bottom edge. The default covers the production
 * particle lifetime (9-12 s) plus a little, because the field only fills once
 * the first generation has had time to climb.
 */
export function warmUpParticleFlow(
  systems: LibraryParticles,
  state: ParticleFlowState,
  field: ParticleField,
  flow: ParticleFlow,
  seconds = 12.5,
  random: () => number = Math.random,
): ParticleSpawnStats {
  const steps = Math.ceil(seconds * 60);
  const total = emptySpawnStats();
  for (let step = 0; step < steps; step += 1) {
    const stepStats = advanceParticleFlow(systems, state, field, flow, 1 / 60, random);
    total.spawned += stepStats.spawned;
    total.right += stepStats.right;
    total.left += stepStats.left;
    total.stationary += stepStats.stationary;
    total.belowViewport += stepStats.belowViewport;
    total.recycled += stepStats.recycled;
  }
  return total;
}

/** The measured halo sprites, rasterised once per document. */
const SPRITE_CACHE = new Map<string, HTMLCanvasElement>();

function builtinSprite(name: 'particle/halo_4' | 'particle/halo'): HTMLCanvasElement | null {
  const cached = SPRITE_CACHE.get(name);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const image = createBuiltinImage(name);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const pixels = new Uint8ClampedArray(image.pixels.length);
  pixels.set(image.pixels);
  context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  SPRITE_CACHE.set(name, canvas);
  return canvas;
}

/** Tints of one measured sprite, keyed by an 8 step colour bucket. */
const TINTED_SPRITES = new Map<string, HTMLCanvasElement>();

function tintedSprite(base: HTMLCanvasElement, r: number, g: number, b: number): HTMLCanvasElement {
  const red = Math.max(0, Math.min(255, Math.round(r * 255)));
  const green = Math.max(0, Math.min(255, Math.round(g * 255)));
  const blue = Math.max(0, Math.min(255, Math.round(b * 255)));
  const key = `${base.width}:${red >> 5}:${green >> 5}:${blue >> 5}`;
  const cached = TINTED_SPRITES.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext('2d');
  if (!context) return base;
  context.drawImage(base, 0, 0);
  // The halo sprite is white with an alpha profile; painting the particle colour
  // "only where it is visible" tints it while keeping the measured falloff.
  context.globalCompositeOperation = 'source-atop';
  context.fillStyle = `rgb(${red >> 5 << 5}, ${green >> 5 << 5}, ${blue >> 5 << 5})`;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (TINTED_SPRITES.size > 96) {
    const oldest = TINTED_SPRITES.keys().next().value;
    if (oldest !== undefined) TINTED_SPRITES.delete(oldest);
  }
  TINTED_SPRITES.set(key, canvas);
  return canvas;
}

let quadScratch: Float32Array | null = null;

/**
 * Draws both systems' live particles as additive sprites.
 *
 * `buildVertices` is the library's own writer for the GPU path - it already
 * bakes in the size ramp, the alpha fade/oscillation, the rotation and the
 * velocity stretch - so reading the quads back from it means the picture here
 * cannot drift away from what the scene renderer would draw for the same
 * particle.
 */
export function drawLibraryParticles(
  context: CanvasRenderingContext2D,
  systems: LibraryParticles,
  width: number,
  height: number,
  unitScale: number,
): void {
  // 300 root embers + the glow child; rounded up so neither can overflow it.
  if (!quadScratch || quadScratch.length < 9 * 6 * 320) quadScratch = new Float32Array(9 * 6 * 384);
  context.globalCompositeOperation = 'lighter';
  context.globalAlpha = 1;
  const sprites: Array<[ParticleSystem, HTMLCanvasElement | null]> = [
    [systems.root, builtinSprite('particle/halo_4')],
    [systems.glow, builtinSprite('particle/halo')],
  ];
  for (const [system, sprite] of sprites) {
    if (!sprite) return;
    const vertices = system.buildVertices(quadScratch, 9, 1);
    for (let vertex = 0; vertex + 6 <= vertices; vertex += 6) {
      const base = vertex * 9;
      const next = base + 9;
      const after = base + 18;
      const last = base + 45;
      const cornersX = [quadScratch[base], quadScratch[next], quadScratch[after], quadScratch[last]];
      const cornersY = [quadScratch[base + 1], quadScratch[next + 1], quadScratch[after + 1], quadScratch[last + 1]];
      const centerX = (cornersX[0] + cornersX[1] + cornersX[2] + cornersX[3]) / 4;
      const centerY = (cornersY[0] + cornersY[1] + cornersY[2] + cornersY[3]) / 4;
      const widthPx = Math.hypot(cornersX[1] - cornersX[0], cornersY[1] - cornersY[0]) * unitScale;
      const heightPx = Math.hypot(cornersX[2] - cornersX[1], cornersY[2] - cornersY[1]) * unitScale;
      const alpha = quadScratch[base + 8];
      if (alpha <= 0.003 || widthPx < 0.75 || heightPx < 0.75) continue;
      const tinted = tintedSprite(sprite, quadScratch[base + 5], quadScratch[base + 6], quadScratch[base + 7]);
      context.globalAlpha = Math.min(1, alpha);
      context.save();
      // Scene units have y up, the canvas has y down: mirror the centre, and
      // with it the rotation.
      context.translate(width / 2 + centerX * unitScale, height / 2 - centerY * unitScale);
      context.rotate(-Math.atan2(cornersY[1] - cornersY[0], cornersX[1] - cornersX[0]));
      context.drawImage(tinted, -widthPx / 2, -heightPx / 2, widthPx, heightPx);
      context.restore();
    }
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
}

export interface CustomWallpaperProps {
  /**
   * The wallpaper settings. Only the custom fields are read, so the
   * administrator's BackgroundSettings is accepted here too.
   */
  settings: CustomEffectParams;
  /** The uploaded picture. Without one the neutral theme placeholder shows. */
  url?: string | null;
  /** The part of the picture that fills the screen. */
  crop?: CropRect;
}

/**
 * The picture, the sway and the particles are driven by one rAF loop.
 *
 * They are one loop rather than a CSS/framer animation plus a particle canvas
 * because of a bug that made the wallpaper look static: a framer-motion keyframe
 * animation started with `initial={false}` never ran on mount, so the picture
 * stayed pinned at its first keyframe until some later re-render happened to
 * restart it. Writing the transform from the same loop that advances the
 * particles makes the sway follow `customSwayCurve` exactly - the scene
 * renderer's `oscillateposition` curve - instead of a sampled approximation.
 *
 * This also deliberately ignores `prefers-reduced-motion`. The scene library it
 * copies ignores it too; the two switches in the dialog are the user's explicit
 * way of turning the movement off, and a background sold as "the scene's sway
 * and particles" staying frozen because Windows animations were once turned off
 * is exactly the report this fixes.
 */
export function CustomWallpaper({ settings, url, crop = FULL_CROP }: CustomWallpaperProps) {
  const effect = resolveCustomEffect(settings);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The box the sway transform is written to; the picture is positioned in it. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  /** A picture that will not decode leaves the neutral placeholder to be the wallpaper. */
  const [failed, setFailed] = useState(false);
  const picture = url && !failed ? url : null;
  /** Whether the selection is the whole picture; the whole picture is stretched
   *  to fill the screen, a region is positioned so that the region does. */
  const cropped = crop.x !== 0 || crop.y !== 0 || crop.w !== 1 || crop.h !== 1;
  /** Enlarged by twice the swing so the picture's edge never enters the frame. */
  const baseScale = 1 + (2 * effect.amplitude) / 100 + 0.01;

  // The picture a failed decode replaced is a different wallpaper worth trying.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  // The sway and the particles. One loop owns the frame clock, the transform
  // writes, the simulation and every listener; the cleanup puts all of it back.
  useEffect(() => {
    if (!picture) return undefined;
    const frame = frameRef.current;
    const canvas = effect.particles ? canvasRef.current : null;
    const context = context2d(canvas);
    // A picture with neither half turned on needs nothing, and neither does one
    // whose only effect is particles in a browser with no 2D context (jsdom,
    // SSR): the picture itself is still the wallpaper.
    if (!frame || (!effect.sway && !context)) return undefined;

    let width = 1;
    let height = 1;
    /** Scene units per CSS pixel, from the library's orthographic volume. */
    let unit = 1;
    /** Sway displacement in CSS pixels, from the slider's share of the short edge. */
    let amplitude = 0;
    let scale = 1;
    // The engine's own particle simulation, with this wallpaper's own emitter:
    // embers are born below the screen and rise into it from the bottom edge.
    const systems = createFlowParticles(effect);
    const flow: ParticleFlow = { rise: effect.rise, drift: effect.drift, direction: effect.direction };
    const flowState = createParticleFlowState(systems);
    /** The viewport in scene units; layout() keeps it current. */
    const field: ParticleField = { width: 1280, height: 720, unit: 1 };
    let raf = 0;
    let running = false;
    let last = 0;
    let time = 0;

    /**
     * One frame of the scene renderer's `oscillateposition` curve, applied to the
     * picture's box: sin for x, cos for y, at the configured Hz.
     */
    const paintSway = () => {
      if (!effect.sway) return;
      const point = customSwayCurve(effect.frequency, time);
      frame.style.transform =
        `translate3d(${(point.x * amplitude).toFixed(2)}px, ${(point.y * amplitude).toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    };

    const layout = () => {
      width = Math.max(1, window.innerWidth || 1280);
      height = Math.max(1, window.innerHeight || 800);
      amplitude = (effect.amplitude / 100) * Math.min(width, height);
      scale = 1 + (2 * effect.amplitude) / 100 + 0.01;
      unit = sceneUnitScale(width, height);
      field.width = width;
      field.height = height;
      field.unit = unit;
      if (context && canvas) {
        // A retina screen is worth two pixels per CSS pixel and no more.
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const paintParticles = () => {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      drawLibraryParticles(context, systems, width, height, unit);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // A tab that was asleep hands back a huge delta; cap it.
      const delta = Math.min(64, Math.max(0, now - last));
      last = now;
      time += delta / 1000;
      paintSway();
      if (context) {
        advanceParticleFlow(systems, flowState, field, flow, delta / 1000);
        paintParticles();
      }
    };

    const start = () => {
      if (running || document.hidden) return;
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
    if (context) {
      // The scene starts empty; three odd seconds of simulation means the first
      // paint already has embers along the bottom-to-top path instead of a blank
      // screen.
      warmUpParticleFlow(systems, flowState, field, flow);
      paintParticles();
    }
    // The first pose is written before the first frame, so the picture starts on
    // the curve instead of sitting untransformed for a frame.
    paintSway();
    start();

    const onResize = () => {
      layout();
      paintParticles();
      paintSway();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // The drift numbers are what shapes the field; a change is a different field.
  }, [picture, effect.sway, effect.particles, effect.amplitude, effect.frequency, effect.rise, effect.drift, effect.direction]);


  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-custom-wallpaper
      data-custom-picture={picture ? 'true' : undefined}
      data-custom-sway={effect.sway ? 'true' : 'false'}
      data-custom-particles={effect.particles ? 'true' : 'false'}
    >
      {picture ? (
        // The sway is written to this box by the loop above; the picture inside
        // it is placed by the crop rectangle, so framing and movement never
        // fight over the same transform.
        <div
          ref={frameRef}
          data-custom-image-frame
          className="absolute inset-0 will-change-transform"
          style={{ transform: `scale(${baseScale.toFixed(4)})` }}
        >
          <img
            src={picture}
            alt=""
            data-custom-image
            className={
              cropped
                ? 'absolute max-w-none select-none'
                : 'absolute inset-0 h-full w-full object-cover select-none'
            }
            style={cropped ? cropMediaStyle(crop) : undefined}
            onError={() => setFailed(true)}
          />
        </div>
      ) : (
        // No picture yet: a neutral theme gradient, not an editable colour field.
        <div
          data-custom-placeholder
          className="absolute inset-0"
          style={{ background: customBackdrop(customColors('', '')) }}
        />
      )}
      {picture && effect.particles ? (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          aria-hidden
          data-custom-particles-canvas
        />
      ) : null}
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
        粒子在屏幕下方生成、向上飘入画面。漂移速度是左右移动的<em>最大</em>速度，每颗粒子在
        0 到该值之间随机；方向比例是向右飞行的粒子比例，70% 即 70% 向右、30% 向左。
        软光晕、加色混合与尺寸/透明度/寿命曲线沿用 wallpaper-scene-layers 的灰烬预设，
        速度以场景单位/秒计（库的 3840×2160 正交视图）。
      </p>
    </div>
  );
}
