import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/cn';
import { decorateMarkdown, renderMarkdown } from '../lib/markdown';

interface PreviewProps {
  content: string;
  className?: string;
  /** Called for links that point at another note (see `isInternalLink`). */
  onOpenLink?: (href: string) => void;
}

export function Preview({ content, className, onOpenLink }: PreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (containerRef.current) decorateMarkdown(containerRef.current);
  }, [html]);

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
