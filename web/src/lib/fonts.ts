import type { FontRecord, FontSelection } from './types';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

/** URL of the uploaded font file. */
export function fontFileUrl(id: string): string {
  return `${BASE}/api/fonts/${encodeURIComponent(id)}/file`;
}

/** A CSS-safe family name. Quotes are the only character that could break out. */
function familyName(name: string): string {
  return name.replace(/["\\]/g, '').trim() || 'Uploaded font';
}

/**
 * The stack to use for a role: the chosen uploaded font first, then whatever the
 * app would have used anyway, so a missing glyph still renders.
 */
export function fontStack(fonts: FontRecord[], id: string, fallback: string): string {
  const font = fonts.find((entry) => entry.id === id);
  if (!font) return fallback;
  return `"${familyName(font.name)}", ${fallback}`;
}

const STYLE_ID = 'user-fonts';

/**
 * Installs the uploaded fonts.
 *
 * The @font-face rules are written into one dedicated <style> element and the
 * two font variables are set on <html>, which overrides the values Tailwind
 * emitted for :root. Re-running this replaces both, so removing a font takes
 * effect immediately.
 */
export function applyFonts(fonts: FontRecord[], selection: FontSelection): void {
  if (typeof document === 'undefined') return;

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = fonts
    .map(
      (font) =>
        `@font-face{font-family:"${familyName(font.name)}";src:url("${fontFileUrl(font.id)}") format("${font.format}");font-display:swap;}`,
    )
    .join('\n');

  const root = document.documentElement;
  const sans = selection.sans ? fontStack(fonts, selection.sans, '') : '';
  const mono = selection.mono ? fontStack(fonts, selection.mono, '') : '';

  if (sans) {
    root.style.setProperty('--font-sans', sans.replace(/, $/, ''));
  } else {
    root.style.removeProperty('--font-sans');
  }
  if (mono) {
    // the fallbacks stay in place for code, where a missing glyph is common
    root.style.setProperty('--font-mono', `${mono}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`);
  } else {
    root.style.removeProperty('--font-mono');
  }
}
