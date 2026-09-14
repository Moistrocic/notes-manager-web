import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/cn';
import { decorateMarkdown, renderMarkdown } from '../lib/markdown';
import { normaliseHeading } from '../lib/outline';

export interface PreviewApi {
  /**
   * Scrolls the rendered preview to a heading. `index` is the position of the
   * heading in the document; the text is verified against it and used as a
   * fallback, so a mismatch (setext headings, for instance) still lands
   * somewhere sensible.
   */
  scrollToHeading: (target: { index: number; text: string; level: number }) => boolean;
}

interface PreviewProps {
  content: string;
  className?: string;
  /** Called for links that point at another note (see `isInternalLink`). */
  onOpenLink?: (href: string) => void;
  apiRef?: { current: PreviewApi | null };
}

export function Preview({ content, className, onOpenLink, apiRef }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (containerRef.current) decorateMarkdown(containerRef.current);
  }, [html]);

  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = {
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

        // Scroll only the preview pane: scrollIntoView would walk up every
        // scrollable ancestor as well.
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        container.scrollTo({
          top: container.scrollTop + (targetRect.top - containerRect.top) - 12,
          behavior: 'smooth',
        });

        target.classList.remove('heading-flash');
        // restart the animation when the same heading is clicked twice
        void target.offsetWidth;
        target.classList.add('heading-flash');
        window.setTimeout(() => target.classList.remove('heading-flash'), 1200);
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
    if (href.startsWith('#')) return; // in-page anchor: let the browser scroll

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
