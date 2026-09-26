import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

import { fileUrl } from './api';

const marked = new Marked({
  gfm: true,
  breaks: true,
});

const PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'class', 'id', 'align', 'colspan', 'rowspan'],
  ADD_TAGS: ['input'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
};

/** Renders markdown to sanitised HTML. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source ?? '', { async: false }) as string;
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

/**
 * The source lines each rendered block came from.
 *
 * Markdown gives no hint of where a block sits in the file, and the two panes
 * cannot be kept level without one: the same note is a different height in each,
 * so a percentage of the scroll range is a different place in the text. The
 * lexer does know - every token carries the raw source it was made from - so
 * walking the top-level tokens and counting their lines gives each block the
 * line it starts on.
 *
 * Two token types render nothing at all (the blank lines between blocks, and
 * link definitions), so they are counted but not returned.
 */
export function sourceBlocks(source: string): { line: number; endLine: number }[] {
  const blocks: { line: number; endLine: number }[] = [];
  // A line number is the count of the newlines before it, plus one - and the
  // tokens' raw text adds up to exactly that, newline for newline. Counting each
  // raw's own "lines" instead drifts: a blank-line token carries the newline
  // that ended the line before it as well, so the whole document slips a line
  // further out of step at every gap.
  let seen = 0;
  for (const token of marked.lexer(source ?? '')) {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    const line = 1 + seen;
    seen += (raw.match(/\n/g) ?? []).length;
    // Where the block stops, exclusive: the newline that ends its last line may
    // belong to the *next* token (the blank line after it), so a raw that does
    // not end on one still owns the line it sits on.
    const lastLine = raw.endsWith('\n') ? seen : seen + 1;
    const endLine = Math.max(line + 1, lastLine + 1);
    if (token.type !== 'space' && token.type !== 'def') blocks.push({ line, endLine });
  }
  return blocks;
}

/** The attribute a rendered block carries its first source line in. */
export const SOURCE_LINE_ATTR = 'data-line';
/** And the one after its last line, which is where the next block begins. */
export const SOURCE_LINE_END_ATTR = 'data-line-end';

/**
 * Marks every block of the rendered document with the source lines it came
 * from, so the panes can be kept level by line rather than by proportion.
 *
 * The rendered children are in source order and correspond to the blocks one
 * for one, with one exception worth knowing about: a raw HTML block can be
 * several elements at once, and when that happens the extra ones carry the
 * previous block's line rather than losing their mark altogether. A block is
 * never given a line it did not come from.
 */
export function annotateSourceLines(root: HTMLElement, source: string): void {
  const blocks = sourceBlocks(source);
  const children = Array.from(root.children) as HTMLElement[];
  type Block = { line: number; endLine: number };
  let previous: Block | null = null;
  for (let index = 0; index < children.length; index += 1) {
    const block: Block | null = blocks[index] ?? previous;
    if (!block) break;
    children[index].setAttribute(SOURCE_LINE_ATTR, String(block.line));
    children[index].setAttribute(SOURCE_LINE_END_ATTR, String(block.endLine));
    previous = block;
  }
}

/**
 * GitHub's heading anchor algorithm: lowercase, drop everything that is not a
 * letter, digit, space, hyphen or underscore, then spaces become hyphens.
 * Unicode letters are kept, so `1.1 分层` becomes `11-分层`.
 */
export function slugifyHeading(text: string): string {
  return (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

/**
 * Gives every heading an id so that `[text](#anchor)` links work.
 *
 * marked stopped emitting header ids (v5 deprecated it, later versions removed
 * it), so nothing in the rendered HTML can be targeted without this. Repeated
 * headings get `-1`, `-2` … exactly like GitHub.
 */
export function assignHeadingIds(root: HTMLElement): void {
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    if (heading.id) return;
    const base = slugifyHeading(heading.textContent ?? '') || 'section';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    heading.id = count === 0 ? base : `${base}-${count}`;
  });
}

/** Applies syntax highlighting and safe link attributes to a rendered container. */
export function decorateMarkdown(root: HTMLElement): void {
  assignHeadingIds(root);
  root.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    if (block.dataset.highlighted === 'yes') return;
    try {
      hljs.highlightElement(block);
    } catch {
      /* ignore unknown languages */
    }
  });
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    // In-page anchors and links to another note stay in the app; everything
    // else opens in a new tab as before.
    if (href.startsWith('#') || isInternalLink(href)) {
      anchor.removeAttribute('target');
      anchor.setAttribute('data-internal-link', 'true');
      return;
    }
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
  });
}

/**
 * True for links that point at another note rather than at the web.
 * Covers `notes:<id>`, relative markdown paths and bare `*.md` targets.
 */
export function isInternalLink(href: string): boolean {
  if (!href || href.startsWith('#') || href.startsWith('//')) return false;
  if (href.startsWith('notes:')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // http(s), mailto, ...
  const clean = href.split('#')[0]?.split('?')[0] ?? '';
  return /\.(md|markdown)$/i.test(clean) || clean.startsWith('./') || clean.startsWith('../') || !clean.includes('/');
}

/** Plain text preview used for cards and the command palette. */
export function stripMarkdown(source: string, limit = 200): string {
  const plain = (source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

/**
 * Rewrites the pictures in a rendered note so the browser asks this server for
 * them.
 *
 * A note refers to the images beside it - `![x](../img/a.png)` - and a relative
 * path in the preview would be resolved against the panel's own address, which
 * is never where the file is. The path is read against the note's own folder
 * instead and handed to `/api/notes/file`, so the bytes arrive through
 * whichever storage driver is active.
 *
 * Anything that already names its own location - `https://`, `//cdn`, `data:`,
 * `blob:` - is left exactly as written; those are other stores and inline
 * pictures, not this one. A path starting with `/` is already a storage path.
 *
 * Where the bytes come from is the caller's choice. The panel's notes are
 * behind a login, so it uses the default - `/api/notes/file` - while the
 * public blog passes its own reader for the same storage path. The path a
 * picture is resolved to does not change either way: only who is asked for
 * it does.
 *
 * Safe to run more than once: the `src` the note was written with is kept on
 * the element, so a second pass - the same preview reused for another note,
 * or the same picture asked for through another door - resolves from the note
 * rather than from what the first pass produced.
 */
export function resolveImages(
  root: HTMLElement,
  notePath: string,
  options?: { fileUrl?: ImageUrlBuilder },
): void {
  const imageUrl = options?.fileUrl ?? fileUrl;
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const original = image.dataset.originalSrc ?? image.getAttribute('src') ?? '';
    if (image.dataset.originalSrc === undefined) image.dataset.originalSrc = original;
    dressImage(image);
    const resolved = imageSource(original, notePath, imageUrl);
    if (resolved) image.setAttribute('src', resolved);
  });

  showLinkedImages(root, notePath, imageUrl);
}

/** How a storage path becomes something the browser can load. */
export type ImageUrlBuilder = (storagePath: string) => string;

/** How a picture is shown wherever this panel draws one. */
function dressImage(image: HTMLImageElement): void {
  // The attribute rather than the property: it is what a browser reads and
  // what a DOM test can see.
  image.setAttribute('loading', 'lazy');
  // Some hosts only serve a picture when the request does not look like it
  // came from another page; sending no referrer at all is what makes those
  // load here exactly as they do on the site they came from.
  image.setAttribute('referrerpolicy', 'no-referrer');
  // Never wider than the pane it sits in, with the height following, so a
  // large picture is scaled down rather than overflowing the note.
  image.classList.add('max-w-full', 'h-auto');
}

/** The file name in a URL, for the alt text of a picture built from one. */
function nameOfUrl(url: string): string {
  const path = (url.split('#')[0] ?? '').split('?')[0] ?? '';
  try {
    return decodeURIComponent(path.split('/').pop() ?? '') || url;
  } catch {
    return path.split('/').pop() || url;
  }
}

/** A picture element for a URL, ready to be put in the page. */
function pictureFor(doc: Document, url: string, notePath: string, imageUrl: ImageUrlBuilder): HTMLImageElement {
  const image = doc.createElement('img');
  image.dataset.originalSrc = url;
  image.setAttribute('src', imageSource(url, notePath, imageUrl) ?? url);
  image.setAttribute('alt', nameOfUrl(url));
  dressImage(image);
  return image;
}

/**
 * Shows the pictures a note only names.
 *
 * A note about pictures rarely writes them as markdown: the address arrives
 * pasted out of a payload - `{"url":"https://.../a.png"}` - and a reader who
 * pasted it wants to see the picture, not a string. Every URL in the note
 * that ends in an image extension is therefore shown as one too: in place
 * when it sits in the prose, and under the block when it sits in a code
 * sample (the sample itself is left exactly as written, because a URL in
 * code is part of the code).
 */
function showLinkedImages(root: HTMLElement, notePath: string, imageUrl: ImageUrlBuilder): void {
  const doc = root.ownerDocument;

  // A link that points straight at a picture: the picture goes under the link.
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    if (anchor.dataset.imagePreview === 'true') return;
    const href = trimUrlTail(anchor.getAttribute('href') ?? '');
    if (!/^https?:\/\//i.test(href) || !isImageUrl(href)) return;
    anchor.dataset.imagePreview = 'true';
    // The link is corrected too: it was the same address with a quote stuck to
    // it, and following it would have asked for a file whose name ended in one.
    anchor.setAttribute('href', href);
    anchor.insertAdjacentElement('afterend', pictureFor(doc, href, notePath, imageUrl));
  });

  // URLs written as text, in a sentence or in a pasted payload.
  for (const node of textNodesWithImages(root)) {
    const text = node.data;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    let drawn = 0;
    IMAGE_URL_IN_TEXT.lastIndex = 0;
    for (let match = IMAGE_URL_IN_TEXT.exec(text); match; match = IMAGE_URL_IN_TEXT.exec(text)) {
      const url = match[0];
      if (match.index > cursor) fragment.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
      // The address stays: it is how the picture is referred to, and it stays
      // selectable next to what it points at.
      fragment.appendChild(doc.createTextNode(url));
      // ...which is also why the node is found again on a second pass: the
      // picture that pass drew is still sitting right after this address, and
      // drawing another one would double it.
      if (!alreadyDrawnNextTo(node, url)) {
        fragment.appendChild(pictureFor(doc, url, notePath, imageUrl));
        drawn += 1;
      }
      cursor = match.index + url.length;
    }
    // Nothing new to draw: leave the node exactly as it is.
    if (cursor === 0 || drawn === 0) continue;
    if (cursor < text.length) fragment.appendChild(doc.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }

  // And inside a code sample, where the picture belongs under the block.
  root.querySelectorAll('pre').forEach((block) => {
    if (block.dataset.imagePreview === 'true') return;
    const seen = new Set<string>();
    const urls = (block.textContent ?? '').match(IMAGE_URL_IN_TEXT) ?? [];
    for (const url of urls) if (isImageUrl(url)) seen.add(url);
    if (seen.size === 0) return;
    block.dataset.imagePreview = 'true';
    const holder = doc.createElement('div');
    holder.className = 'code-image-preview my-2 flex flex-wrap gap-2';
    for (const url of [...seen].slice(0, 12)) holder.appendChild(pictureFor(doc, url, notePath, imageUrl));
    block.insertAdjacentElement('afterend', holder);
  });
}

/** Whether the picture for this address is already the next thing in the page. */
function alreadyDrawnNextTo(node: Text, url: string): boolean {
  const sibling = node.nextElementSibling as HTMLImageElement | null;
  return sibling?.tagName === 'IMG' && sibling.dataset.originalSrc === url;
}

/** Every text node that mentions a picture, skipping the ones already handled. */
function textNodesWithImages(root: HTMLElement): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const found: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent) continue;
    // Inside a code sample the text is the sample; a picture there would be a
    // picture drawn inside the code, which is not what was written.
    if (parent.closest('pre, code, a, script, style, textarea')) continue;
    IMAGE_URL_IN_TEXT.lastIndex = 0;
    if (IMAGE_URL_IN_TEXT.test(text.data)) found.push(text);
  }
  return found;
}

/** The extensions this panel is willing to show as a picture. */
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

/**
 * A picture address written anywhere in a note.

 * Deliberately greedy about what may follow: a URL in prose can end a
 * sentence, sit in quotes, or be wrapped in brackets, and none of those
 * characters belong to it.
 */
const IMAGE_URL_IN_TEXT =
  /https?:\/\/[^\s<>"'`)\]}]+?\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)(?:\?[^\s<>"'`)\]}]*)?/gi;

/** Decoding that never throws: a lone % is a character, not an encoding. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A URL with the punctuation that followed it in the text taken off the end.
 *
 * A pasted payload reads \{"url":"https://…/a.png"\}, and the link markup that
 * comes out of it swallows the closing quote and brace into the address. They
 * are not part of the picture's address, so they are cut off before anything
 * is done with it.
 */
export function trimUrlTail(url: string): string {
  return safeDecode(url).replace(/["'`)\]}>,;.]+$/, '');
}

/** Whether a URL names a picture this panel knows how to show. */
export function isImageUrl(url: string): boolean {
  const withoutQuery = (url ?? '').split('#')[0]?.split('?')[0] ?? '';
  return IMAGE_EXTENSION.test(withoutQuery);
}

/** The URL the browser should load an image reference from, or null to leave it. */
function imageSource(src: string, notePath: string, imageUrl: ImageUrlBuilder): string | null {
  const storagePath = resolveImagePath(src, notePath);
  return storagePath ? imageUrl(storagePath) : null;
}

/**
 * The storage path an image reference means, or null when the reference needs
 * no help: an absolute URL, a protocol-relative one, `data:` or `blob:`.
 */
export function resolveImagePath(src: string, notePath: string): string | null {
  const raw = (src ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  // A query or a fragment is the browser's business, not the file's.
  const clean = (raw.split('#')[0] ?? '').split('?')[0] ?? '';
  if (!clean) return null;
  // marked writes the URL it emits percent-encoded, so a Chinese file name -
  // or any name with a space - arrives as %E9%A3%8E... Decoding it here turns
  // it back into the name the file actually has. Left encoded, the lookup
  // would ask for a file literally called "%E9%A3%8E..." and come back 404:
  // the server decodes the query parameter once on its way in.
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Not an encoding at all (a lone % in a file name): keep it as written.
  }
  // A leading slash is already a path from the notes root; the rest is read
  // against the folder the note itself lives in.
  const base = decoded.startsWith('/') ? '' : directoryOf(notePath);
  return normaliseStoragePath(`${base}${decoded}`);
}

/** The folder part of a storage path, trailing slash included. */
function directoryOf(notePath: string): string {
  const path = (notePath ?? '').replace(/\\/g, '/');
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

/**
 * Folds `.` and `..` away, and returns a path from the notes root.
 *
 * Text handling rather than `new URL`: a browser would percent-encode a Chinese
 * file name here, and that name is encoded once more on the way into
 * `fileUrl`. A `..` above the root has nowhere to go, so it is dropped.
 */
export function normaliseStoragePath(path: string): string {
  const segments: string[] = [];
  for (const segment of (path ?? '').replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
