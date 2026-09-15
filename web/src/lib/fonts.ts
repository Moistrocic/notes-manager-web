import { BUILTIN_FONTS, builtinFont, builtinFontUrl, isBuiltinFontId } from './builtin-fonts';
import type { FontRecord, FontSelection } from './types';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

/** URL of an uploaded font file. */
export function fontFileUrl(id: string): string {
  return `${BASE}/api/fonts/${encodeURIComponent(id)}/file`;
}

/** A CSS-safe family name. Quotes are the only character that could break out. */
function familyName(name: string): string {
  return name.replace(/["\\]/g, '').trim() || 'Uploaded font';
}

/**
 * Every family the front end can render: the ones that ship with the app first,
 * then whatever has been uploaded.
 */
export interface AvailableFont {
  id: string;
  name: string;
  /** Family name as written into CSS. */
  family: string;
  kind: 'sans' | 'mono' | 'both';
  builtin: boolean;
  /** Uploaded fonts only. */
  record?: FontRecord;
}

export function availableFonts(fonts: FontRecord[]): AvailableFont[] {
  return [
    ...BUILTIN_FONTS.map((font) => ({
      id: font.id,
      name: font.name,
      family: familyName(font.name),
      kind: font.kind,
      builtin: true,
    })),
    ...fonts.map((font) => ({
      id: font.id,
      name: font.name,
      family: familyName(font.name),
      // an uploaded font may be picked for either role
      kind: 'both' as const,
      builtin: false,
      record: font,
    })),
  ];
}

export function fontById(fonts: FontRecord[], id: string): AvailableFont | undefined {
  return availableFonts(fonts).find((font) => font.id === id);
}

/** Just the chosen family, quoted, or '' when nothing matches. */
export function fontFamilyOf(fonts: FontRecord[], id: string): string {
  const font = fontById(fonts, id);
  return font ? `"${font.family}"` : '';
}

/**
 * The stack to use for a role: the chosen font first, then whatever the app
 * would have used anyway, so a missing glyph still renders.
 *
 * An empty fallback yields the family alone. Appending a separator regardless
 * used to produce "Name", , monospace, and an empty item makes the whole
 * font-family declaration invalid, which silently dropped the choice.
 */
const STYLE_ID = 'user-fonts';

/** @font-face rules for the bundled fonts. They are static files, so this is cheap. */
function builtinFaceRules(): string {
  return BUILTIN_FONTS.map(
    (font) =>
      `@font-face{font-family:"${familyName(font.name)}";src:url("${builtinFontUrl(font)}") format("${font.format}");font-display:swap;}`,
  ).join('\n');
}

/**
 * Installs the fonts.
 *
 * The @font-face rules are written into one dedicated <style> element and the
 * two font variables are set on <html>, which overrides the values Tailwind
 * emitted for :root. Re-running this replaces both, so removing a font takes
 * effect immediately. A @font-face rule on its own downloads nothing - the
 * browser only fetches a file once some text actually uses the family.
 */
export function applyFonts(fonts: FontRecord[], selection: FontSelection): void {
  if (typeof document === 'undefined') return;

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = [
    builtinFaceRules(),
    ...fonts.map(
      (font) =>
        `@font-face{font-family:"${familyName(font.name)}";src:url("${fontFileUrl(font.id)}") format("${font.format}");font-display:swap;}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  const root = document.documentElement;
  const sans = fontFamilyOf(fonts, selection.sans);
  const mono = fontFamilyOf(fonts, selection.mono);

  if (sans) {
    root.style.setProperty('--font-sans', sans);
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

/** True when a saved id still points at something that exists. */
export function fontExists(fonts: FontRecord[], id: string): boolean {
  if (!id) return true;
  if (isBuiltinFontId(id)) return Boolean(builtinFont(id));
  return fonts.some((font) => font.id === id);
}
