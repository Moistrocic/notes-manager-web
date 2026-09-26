/** Small helpers shared by the note repository. */
import { joinPath, normalisePath, parentPath } from '../storage/types.js';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const LATIN_WORD = /[A-Za-z0-9_'-]+/g;

/** Rough word count that behaves sensibly for mixed CJK/latin text. */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, ' ').match(LATIN_WORD)?.length ?? 0;
  return cjk + latin;
}

/** Strips markdown syntax to produce a plain-text excerpt. */
export function toExcerpt(markdown: string, limit = 200): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit).trimEnd()}…` : plain;
}

/** A line that opens or closes a fenced code block. */
const FENCE_LINE = /^\s{0,3}(?:```|~~~)/;

function fenceLines(block: string): number {
  let count = 0;
  for (const line of block.split('\n')) if (FENCE_LINE.test(line)) count += 1;
  return count;
}

/**
 * The opening of a note, as markdown, for a blog card.
 *
 * Whole blank-line separated blocks rather than a slice of the text: a card that
 * stops mid-table or mid-list looks broken, and one that stops inside an
 * unclosed code fence makes the renderer treat everything after it as code. So
 * the summary grows block by block while it fits `limit`, and stops before
 * anything that would not - or that would leave a fence open. The ellipsis says
 * the rest is on the post's own page.
 */
export function toSummaryMarkdown(markdown: string, limit = 600): string {
  const text = (markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (text.length <= limit) return text;

  const kept: string[] = [];
  let length = 0;
  for (const block of text.split(/\n{2,}/)) {
    if (fenceLines(block) % 2 === 1) break;
    const next = length + block.length + (kept.length ? 2 : 0);
    if (next > limit) break;
    kept.push(block);
    length = next;
  }
  const summary = kept.join('\n\n');
  // Nothing fitted at all - one paragraph longer than the whole budget, most
  // often. A card still needs something on it, so the text is cut instead.
  return summary ? `${summary}…` : `${text.slice(0, limit).trimEnd()}…`;
}

/** Markdown destinations: `[text](path)` and `![alt](path)`, angle form included. */
const LINK_TARGET = /!?\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))/g;

/**
 * The storage paths a note's body points at.
 *
 * Used to decide what a published post may hand out: the note itself, and the
 * files it actually mentions. Destinations that name their own location
 * (`https://`, `//cdn`, `data:`) are somebody else's server, and a bare
 * `#anchor` points at the note itself - none of them are files here. Anything
 * else is read the way the browser would read it: from the notes root when it
 * starts with `/`, and from the note's own folder otherwise.
 */
export function referencedPaths(body: string, notePath: string): string[] {
  const folder = parentPath(notePath);
  const found = new Set<string>();
  for (const match of (body ?? '').matchAll(LINK_TARGET)) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    // A query or a fragment is the browser's business, not the file's.
    const clean = (raw.split('#')[0] ?? '').split('?')[0] ?? '';
    if (!clean) continue;
    let decoded = clean;
    try {
      // The renderer percent-encodes what it emits, so a Chinese file name
      // arrives as %E9%A3%8E... and has to be turned back into the real one.
      decoded = decodeURIComponent(clean);
    } catch {
      // A lone % is not an encoding at all: keep the text as written.
    }
    found.add(normalisePath(decoded.startsWith('/') ? decoded : joinPath(folder, decoded)));
  }
  return [...found];
}

/** Converts a title into a safe, readable file name (keeps CJK characters). */
export function slugify(title: string, fallback = 'note'): string {
  const cleaned = (title || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[.]+$/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

/** Deterministic short id derived from a string (used for files without front matter). */
export function hashId(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `f${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
