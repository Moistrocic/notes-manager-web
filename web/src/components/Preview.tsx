import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/cn';
import { decorateMarkdown, renderMarkdown } from '../lib/markdown';

export function Preview({ content, className }: { content: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (containerRef.current) decorateMarkdown(containerRef.current);
  }, [html]);

  return (
    <div
      ref={containerRef}
      className={cn('markdown-body scroll-area h-full overflow-y-auto px-7 py-6', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
