import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked } from 'marked';

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

/** Applies syntax highlighting and safe link attributes to a rendered container. */
export function decorateMarkdown(root: HTMLElement): void {
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
