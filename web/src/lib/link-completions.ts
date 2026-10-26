import { folderOfNotePath, isInAppLink, resolvePathInFolder } from './link-paths';
import type { FolderCount, NoteSummary } from './types';

/**
 * The path being typed inside a markdown link or picture.
 *
 * `[label](path)` and `![alt](path)` both put the destination between `](` and
 * the closing `)`. These helpers answer two questions about that destination:
 * where does it start and end, and what may be typed next.
 */

/** The destination of the link the cursor is inside. */
export interface LinkTargetAt {
  /** Document offset just after the `(`, where the destination starts. */
  from: number;
  /** Where the destination currently ends: the closing `)` or the line end. */
  to: number;
  /** What has been typed from `from` to the cursor. */
  typed: string;
}

/** One row the completion popup offers. */
export interface LinkCandidate {
  /** What the popup shows: a folder with a trailing slash, or a file name. */
  label: string;
  /** The text that replaces the typed prefix - already in the user's style. */
  insert: string;
  /** The second line: what the entry is. */
  detail: string;
  kind: 'folder' | 'note' | 'file';
}

/** A snapshot of the tree a completion is answered from. */
export interface LinkCompletionContext {
  notePath: string | null;
  notes: readonly NoteSummary[];
  folders: readonly FolderCount[];
}

export interface SuggestLinkCandidatesInput extends LinkCompletionContext {
  typed: string;
  /** Rows to offer, folders first. Defaults to 50. */
  limit?: number;
}

/** Whether a line before `lineStart` is inside a fenced code block. */
function insideFencedCode(text: string, lineStart: number): boolean {
  let fences = 0;
  let at = 0;
  while (at < lineStart) {
    const end = text.indexOf('\n', at);
    const lineEnd = end < 0 ? text.length : end;
    if (/^\s{0,3}(?:```|~~~)/.test(text.slice(at, lineEnd))) fences += 1;
    if (end < 0) break;
    at = end + 1;
  }
  return fences % 2 === 1;
}

/**
 * Where the cursor sits in a markdown link destination, or null.
 *
 * Hits for `[a](pro|` and `![x](./|`, and after `](` at any depth of the path.
 * Misses in ordinary prose, inside fenced or inline code, after the closing
 * `)` and anywhere that is not an inline link at all. The check is deliberately
 * local: completion is a convenience while typing, so a half-written link is
 * the normal case and there is no need to parse the whole document.
 */
export function linkTargetAt(text: string, cursor: number): LinkTargetAt | null {
  if (typeof text !== 'string' || cursor < 0 || cursor > text.length) return null;
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  if (insideFencedCode(text, lineStart)) return null;
  // Inline code: an odd number of backticks before the caret on its line.
  const lineBefore = text.slice(lineStart, cursor);
  if ((lineBefore.match(/`/g) ?? []).length % 2 === 1) return null;

  // The destination starts after "](" - the bracket may belong to ![alt] too.
  const open = text.lastIndexOf('(', cursor - 1);
  if (open < 1 || text[open - 1] !== ']') return null;
  const labelOpen = text.lastIndexOf('[', open - 2);
  if (labelOpen < 0 || text.slice(labelOpen, open - 1).includes('\n')) return null;
  const soFar = text.slice(open + 1, cursor);
  if (soFar.includes('\n') || soFar.includes(')')) return null;

  let close = text.indexOf(')', cursor);
  const newline = text.indexOf('\n', cursor);
  if (newline >= 0 && (close < 0 || newline < close)) close = -1;
  const to = close >= 0 ? close : newline >= 0 ? newline : text.length;
  return { from: open + 1, to, typed: soFar };
}

/** The typed URL as it is read: fragment/query off, percent-decoded once. */
function cleanLinkText(value: string): string {
  const raw = (value ?? '').trim();
  const cut = (raw.split('#')[0] ?? '').split('?')[0] ?? '';
  try {
    return decodeURIComponent(cut);
  } catch {
    return cut;
  }
}

/** The folder a path sits in, with no leading slash. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/** The last segment of a path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Characters that would end the destination early in markdown become their
 * percent-encoded form. Letters (Chinese included) are left as written: marked
 * encodes them on the way out, and the panel decodes the parameter once.
 */
function encodePath(path: string): string {
  return path
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * The paths the completion popup offers for what is being typed.
 *
 * The typed text is read with exactly the rules resolveLinkPath applies, so
 * the list is of the folder the link actually names: `/sub/` is under the
 * notes root, `./sub/` and `sub/` under the current note's folder, `../sub/`
 * one level up. Empty typed lists the current folder.
 *
 * The `insert` keeps the way the user started writing - a rooted link stays
 * rooted, a `./` stays `./`, a `../` keeps its climb and a bare path stays
 * bare - so the accepted completion is a path the click handler will resolve
 * the same way. Folders come first and end in `/`; at most `limit` rows are
 * returned. Nothing is offered for an external URL.
 */
export function suggestLinkCandidates(input: SuggestLinkCandidatesInput): LinkCandidate[] {
  const typed = input.typed ?? '';
  if (typed.trim() && !isInAppLink(typed)) return [];
  const clean = cleanLinkText(typed);
  const slash = clean.lastIndexOf('/');
  const directoryText = slash >= 0 ? clean.slice(0, slash) : '';
  // The exact prefix that was typed - `/`, `./`, `../` or a bare folder path -
  // is put back in front of the chosen name, so accepting a completion keeps
  // the way the link was being written instead of rewriting it.
  const prefix = slash >= 0 ? clean.slice(0, slash + 1) : '';
  const partial = (slash >= 0 ? clean.slice(slash + 1) : clean).toLowerCase();
  const noteFolder = folderOfNotePath(input.notePath);
  // A rooted path always starts at the notes root; every other style starts at
  // the note's own folder.
  const directory =
    directoryText === '' ? (clean.startsWith('/') ? '' : noteFolder) : resolvePathInFolder(directoryText, noteFolder);
  const matches = (name: string) => !partial || name.toLowerCase().startsWith(partial);
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'zh-Hans-CN');
  const limit = Math.max(1, input.limit ?? 50);

  const folders = (input.folders ?? [])
    .filter((folder) => parentOf(folder.path) === directory && matches(folder.name))
    .map((folder) => ({
      label: `${folder.name}/`,
      name: folder.name,
      detail: folder.count > 0 ? `${folder.count} 篇笔记` : '空文件夹',
      kind: 'folder' as const,
    }))
    .sort(byLabel);

  const entries = (input.notes ?? []).filter((entry) => (entry.folder ?? '') === directory && matches(nameOf(entry.path)));
  const notes = entries
    .filter((entry) => entry.kind === 'note')
    .map((entry) => ({
      label: nameOf(entry.path),
      name: nameOf(entry.path),
      detail: entry.title || '笔记',
      kind: 'note' as const,
    }))
    .sort(byLabel);
  const files = entries
    .filter((entry) => entry.kind !== 'note')
    .map((entry) => ({
      label: nameOf(entry.path),
      name: nameOf(entry.path),
      detail: entry.kind === 'image' ? '图片' : '文件',
      kind: 'file' as const,
    }))
    .sort(byLabel);

  const rows = [...folders, ...notes, ...files].slice(0, limit);
  return rows.map((row) => ({
    label: row.label,
    insert: `${encodePath(prefix + row.name)}${row.kind === 'folder' ? '/' : ''}`,
    detail: row.detail,
    kind: row.kind,
  }));
}
