/**
 * Fonts that ship with the application.
 *
 * They live in web/public/fonts and are served as plain static files, so they
 * are available on every deployment without an upload step. Users can still
 * upload their own fonts on top of these.
 *
 * To add one: drop the file in web/public/fonts and add an entry here. The
 * `builtin:` prefix keeps these ids from ever colliding with uploaded ones,
 * which is what the server checks when a selection is saved.
 */

export const BUILTIN_PREFIX = 'builtin:';

export interface BuiltinFont {
  /** Always starts with "builtin:". */
  id: string;
  /** Display name, also the CSS family name. */
  name: string;
  /** Path under the public directory. */
  file: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
  /** Which role it is offered for. */
  kind: 'sans' | 'mono';
  /** Shown under the name in the settings list. */
  note: string;
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: `${BUILTIN_PREFIX}cascadia-code`,
    name: 'Cascadia Code',
    file: 'fonts/CascadiaCode.woff2',
    format: 'woff2',
    kind: 'mono',
    note: '微软开源等宽字体，含连字',
  },
];

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

export function isBuiltinFontId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

export function builtinFont(id: string): BuiltinFont | undefined {
  return BUILTIN_FONTS.find((font) => font.id === id);
}

export function builtinFontsFor(kind: 'sans' | 'mono'): BuiltinFont[] {
  return BUILTIN_FONTS.filter((font) => font.kind === kind);
}

/** Public URL of a built-in font file. */
export function builtinFontUrl(font: BuiltinFont): string {
  return `${BASE}/${font.file}`;
}
