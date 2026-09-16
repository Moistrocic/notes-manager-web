/**
 * The interface colour, taken from the wallpaper.
 *
 * Reads a small sample of whatever is on screen behind the app and picks a hue
 * from it, then writes the two accent variables. Anything it cannot read - a
 * picture served from another origin taints the canvas - leaves the theme's own
 * colour alone rather than guessing.
 */

/** The sampling size. Enough for a colour, small enough to be free. */
const SAMPLE = 48;
/** Hue buckets of 30 degrees. */
const BUCKETS = 12;
/** Below this saturation a pixel is grey and says nothing about the picture. */
const MIN_SATURATION = 0.18;
/** Colours outside this lightness are near-black or near-white; still grey. */
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.92;

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * A colour that reads as "this picture's colour".
 *
 * Pixels vote for a hue, weighted by how colourful they are, so a large washed
 * out sky does not beat a small vivid subject. The winner is then pushed to a
 * saturation and lightness that works as an interface accent, because the raw
 * average of a photograph is usually too dull or too dark to read against.
 */
export function extractAccent(source: CanvasImageSource): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE;
    canvas.height = SAMPLE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);

    const weight = new Array<number>(BUCKETS).fill(0);
    const sum = Array.from({ length: BUCKETS }, () => [0, 0, 0, 0]);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const [h, s, l] = toHsl(data[i], data[i + 1], data[i + 2]);
      if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
      const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
      const w = s * s;
      weight[bucket] += w;
      sum[bucket][0] += data[i] * w;
      sum[bucket][1] += data[i + 1] * w;
      sum[bucket][2] += data[i + 2] * w;
      sum[bucket][3] += w;
    }

    let best = -1;
    for (let i = 0; i < BUCKETS; i += 1) if (weight[i] > (best < 0 ? 0 : weight[best])) best = i;
    if (best < 0 || sum[best][3] === 0) return null;

    const [h, s, l] = toHsl(sum[best][0] / sum[best][3], sum[best][1] / sum[best][3], sum[best][2] / sum[best][3]);
    // Enough saturation to be recognisable, lightness that stays legible on
    // both a light and a dark surface.
    return hslToHex(h, Math.min(0.78, Math.max(0.52, s)), Math.min(0.62, Math.max(0.46, l)));
  } catch {
    // Another origin, or a codec the canvas will not take. Keep the theme.
    return null;
  }
}

/**
 * Tints the built-in background.
 *
 * Two variables rather than a rewritten stylesheet: the aurora's gradients
 * already fall back to the theme's accents, so setting these overrides them and
 * clearing them puts the theme back, without the component having to know.
 */
export function applyAurora(a: string, b: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const set = (name: string, colour: string) => {
    if (colour) root.style.setProperty(name, colour);
    else root.style.removeProperty(name);
  };
  set('--aurora-a', a);
  set('--aurora-b', b);
}

const STYLE_ID = 'wallpaper-accent';

/** Writes the accent variables, or removes them to fall back to the theme. */
export function applyAccent(colour: string | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (!colour) {
    style?.remove();
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-soft');
    return;
  }

  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  // accent-soft is derived rather than stored, so one value drives both.
  style.textContent = `:root{--accent:${colour};--accent-soft:color-mix(in srgb, ${colour} 14%, transparent);}`;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-soft');
}
