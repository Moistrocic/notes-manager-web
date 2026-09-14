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
    if (href.startsWith('#')) return;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
  });
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
