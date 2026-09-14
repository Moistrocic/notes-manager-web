import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/cn';
import { decorateMarkdown, renderMarkdown } from '../lib/markdown';
import { slugifyHeading } from '../lib/markdown';
import { normaliseHeading } from '../lib/outline';

export interface PreviewApi {
  /**
   * Scrolls the rendered preview to a heading. `index` is the position of the
   * heading in the document; the text is verified against it and used as a
   * fallback, so a mismatch (setext headings, for instance) still lands
   * somewhere sensible.
   */
  scrollToHeading: (target: { index: number; text: string; level: number }) => boolean;
  /** Scrolls to any element by id - used for `#anchor` links and deep links. */
  scrollToAnchor: (id: string) => boolean;
}

interface PreviewProps {
  content: string;
  className?: string;
  /** Called for links that point at another note (see `isInternalLink`). */
  onOpenLink?: (href: string) => void;
  /** Called when an in-page `#anchor` link is followed. */
  onOpenAnchor?: (anchor: string) => void;
  apiRef?: { current: PreviewApi | null };
}

export function Preview({ content, className, onOpenLink, onOpenAnchor, apiRef }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (containerRef.current) decorateMarkdown(containerRef.current);
  }, [html]);

  /** Scrolls only the preview pane and flashes the target. */
  const reveal = (container: HTMLElement, target: HTMLElement) => {
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (targetRect.top - containerRect.top) - 12,
      behavior: 'smooth',
    });
    target.classList.remove('heading-flash');
    void target.offsetWidth; // restart the animation on a repeated click
    target.classList.add('heading-flash');
    window.setTimeout(() => target.classList.remove('heading-flash'), 1200);
  };

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = {
      scrollToAnchor(id) {
        const container = containerRef.current;
        if (!container || !id) return false;
        const target =
          container.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
          // fall back to a slug match when the id came from a slightly
          // different text (markdown formatting inside the heading)
          Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).find(
            (h) => slugifyHeading(h.textContent ?? '') === id,
          );
        if (!target) return false;
        reveal(container, target);
        return true;
      },
      scrollToHeading({ index, text, level }) {
        const container = containerRef.current;
        if (!container) return false;
        const headings = Array.from(container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
        if (headings.length === 0) return false;

        const wanted = normaliseHeading(text);
        const matches = (element: HTMLElement) => normaliseHeading(element.textContent ?? '') === wanted;
        let target = headings[index];
        if (!target || !matches(target)) {
          target =
            headings.find((h) => Number(h.tagName.slice(1)) === level && matches(h)) ??
            headings.find(matches) ??
            target;
        }
        if (!target) return false;
        reveal(container, target);
        return true;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, html]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (!href) return;
    if (href.startsWith('#')) {
      // The headings carry ids, but the browser's own jump would also move the
      // page, and the address bar has to learn about the anchor.
      event.preventDefault();
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep the raw value */
      }
      apiRef?.current?.scrollToAnchor(id);
      onOpenAnchor?.(id);
      return;
    }

    if (anchor.dataset.internalLink === 'true') {
      event.preventDefault();
      onOpenLink?.(href);
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className={cn('markdown-body scroll-area h-full overflow-y-auto px-7 py-6', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
