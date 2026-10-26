import type { NoteSummary } from './types';

/**
 * Where a link written in a note points.
 *
 * The rules are the ones people expect from a file manager, and they are the
 * same rules the pictures already follow (see resolveImagePath in markdown.ts):
 *
 *   /x/y          from the notes root          -> "x/y"
 *   ./x, ../x     from the note's own folder   -> "proj/deep/x", "proj/x"
 *   x, sub/doc    also from the note's folder  -> "proj/deep/x", "proj/deep/sub/doc"
 *
 * A note at the root has no folder to be relative to, so every relative path
 * there is read from the root. A `..` that climbs above the root stops at it,
 * exactly like a file path.
 *
 * Only the path itself is returned: the fragment (#section) and query (?v=1)
 * are not part of the file, and a percent-encoded name is decoded once because
 * that is the form marked writes a Chinese file name in. A name that is not an
 * encoding at all (a lone \%) is kept as written.
 *
 * Links that do not name a file in the notes tree - http(s), mailto, data,
 * protocol-relative //, and the notes:<id> shortcut the store handles itself -
 * have no path, so this returns null for them.
 */

/** A URL that carries its own scheme (http:, mailto:, data:, notes:, ...). */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Extensions that make a name a file beside the note rather than a hostname.
 *
 * Used only to tell `photo.png` (a relative file) from `example.com` (a host):
 * both have a dot in the first segment. A name whose last dot-label is one of
 * these is read as a file reference, so it stays in the app.
 */
const FILE_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'csv',
  'html',
  'htm',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'ico',
  'mp4',
  'webm',
  'mov',
  'mp3',
  'wav',
  'ogg',
  'pkg',
  'zip',
]);

/** The fragment or query on a link, which is not part of the file's path. */
function pathPart(href: string): string {
  return (href.split('#')[0] ?? '').split('?')[0] ?? '';
}

/** Decoding that never throws: a lone \% is a character, not an encoding. */
function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The folder part of a storage path (no leading or trailing slash). */
export function folderOfNotePath(notePath: string | null | undefined): string {
  const path = (notePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/**
 * Folds `.` and `..` away, and returns the path from the notes root with no
 * leading slash. Text handling rather than `new URL`: a browser would
 * percent-encode a Chinese name here and it is decoded again on the way in.
 */
export function foldLinkPath(path: string): string {
  const segments: string[] = [];
  for (const segment of (path ?? '').replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

/**
 * A path read against a folder. `/x` is from the root, everything else - bare,
 * `./x` or `../x` - from `folder` (the folder the note itself lives in).
 */
export function resolvePathInFolder(path: string, folder: string): string {
  const clean = (path ?? '').replace(/\\/g, '/');
  if (clean.startsWith('/')) return foldLinkPath(clean);
  return foldLinkPath(`${folder ? `${folder}/` : ''}${clean}`);
}

/**
 * The notes-root-relative path a link points at, or null for a link that is
 * not a path in the notes tree (external, an anchor, or `notes:<id>`).
 *
 * The result has no leading slash: `a.md` is a file at the root, `proj/x.md`
 * is one inside `proj/`. Callers compare it against note.path, which is
 * stored with a leading slash, so strip that side or use findLinkTarget.
 */
export function resolveLinkPath(href: string, notePath: string | null | undefined): string | null {
  const raw = (href ?? '').trim();
  if (!raw) return null;
  // notes:<id> is the store's shortcut; a scheme or // is another protocol.
  if (raw.startsWith('notes:') || raw.startsWith('//') || SCHEME.test(raw)) return null;
  const clean = pathPart(raw);
  if (!clean) return null;
  return resolvePathInFolder(decodeOnce(clean), folderOfNotePath(notePath));
}

/** The last dot-label of the first path segment, when it looks like a host. */
function looksLikeHostname(path: string): boolean {
  const first = path.split('/')[0] ?? '';
  const dot = first.lastIndexOf('.');
  if (dot <= 0 || dot === first.length - 1) return false;
  const lastLabel = first.slice(dot + 1).toLowerCase();
  if (FILE_EXTENSIONS.has(lastLabel)) return false;
  // A domain is labels joined by dots with an alphabetic top-level label, so
  // version strings ("v1.2") and file names with known extensions stay files.
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i.test(first);
}

/**
 * Whether a rendered link stays in the app.
 *
 * The renderer marks these internal so a click is handed to the panel instead
 * of the browser opening a tab (see decorateMarkdown). In-app is:
 *
 *  - `notes:<id>` (the store's own shortcut),
 *  - anchors, which the preview handles before this is asked (so: no),
 *  - `/…`, `./…` and `../…` paths,
 *  - anything ending in .md / .markdown,
 *  - a relative path without a scheme - including a bare name like `readme`
 *    or `sub/doc` - **unless it looks like a hostname**, which is what keeps
 *    `example.com/x` opening in a new tab the way a link to a website should.
 *
 * This is deliberately stricter than "has no scheme": a link written for the
 * web usually has one, but people also paste bare domains, and those must not
 * be turned into a note lookup.
 */
export function isInAppLink(href: string): boolean {
  const raw = (href ?? '').trim();
  if (!raw || raw.startsWith('#')) return false;
  if (raw.startsWith('//')) return false;
  if (raw.startsWith('notes:')) return true;
  if (SCHEME.test(raw)) return false;
  const clean = pathPart(raw);
  if (!clean) return false;
  const lowered = clean.toLowerCase();
  if (lowered.endsWith('.md') || lowered.endsWith('.markdown')) return true;
  if (clean.startsWith('/') || clean.startsWith('./') || clean.startsWith('../')) return true;
  return !looksLikeHostname(clean);
}

/** A note or file in the tree the link resolves to. */
export type LinkTarget = NoteSummary;

/** Storage paths in the tree carry a leading slash: `/docs/note.md`. */
function withoutLeadingSlash(path: string): string {
  return (path ?? '').replace(/^\/+/, '');
}

/**
 * The entry a resolved path names, or null.
 *
 * Exact path first, then the same comparison ignoring case (the tree may have
 * been written on a system where case matters differently), and finally the
 * `.md` a writer left off: `[x](notes/readme)` finds `notes/readme.md`.
 * Folders are not entries here - a link to a folder has nothing to open.
 */
export function findLinkTarget(resolvedPath: string, notes: readonly NoteSummary[]): LinkTarget | null {
  const wanted = (resolvedPath ?? '').replace(/^\/+|\/+$/g, '');
  if (!wanted) return null;
  const candidates = [wanted];
  // Only a path with no extension anywhere gets the markdown extension; a
  // link that already names a file kind is left alone.
  if (!/\.[^/]+$/.test(wanted)) candidates.push(`${wanted}.md`);
  const entries = notes ?? [];
  for (const candidate of candidates) {
    const exact = entries.find((entry) => withoutLeadingSlash(entry.path) === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const lowered = candidate.toLowerCase();
    const insensitive = entries.find((entry) => withoutLeadingSlash(entry.path).toLowerCase() === lowered);
    if (insensitive) return insensitive;
  }
  return null;
}
