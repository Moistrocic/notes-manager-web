import { motion } from 'framer-motion';
import { ListTree, PanelRightClose } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { extractHeadings, type Heading } from '../lib/outline';
import { useAppStore } from '../store/useAppStore';

/**
 * Document outline. It shares the editor's content row so it lines up with the
 * note.
 *
 * Navigation itself is the editor's job: the outline only says which heading was
 * picked, so that the address bar, the editor and the preview cannot drift apart
 * (they did when each of them had its own idea of what a click means).
 */
export function OutlinePanel({ onNavigate }: { onNavigate: (heading: Heading, index: number) => void }) {
  const activeNote = useAppStore((s) => s.activeNote);
  const toggleMeta = useAppStore((s) => s.toggleMeta);
  const headings = useMemo(() => extractHeadings(activeNote?.content ?? ''), [activeNote?.content]);

  if (!activeNote) return null;

  return (
    <div className="outline-panel flex h-full w-[228px] shrink-0 flex-col border-l border-[var(--line)]">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[var(--line)] px-3">
        <ListTree className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">大纲</span>
        <button
          type="button"
          onClick={() => toggleMeta(false)}
          title="隐藏大纲"
          className="focus-ring flex h-6 w-6 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {headings.length === 0 ? (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--faint)]">
            用 <code className="font-mono">#</code> 标记标题即可生成大纲
          </p>
        ) : (
          <ul className="space-y-0.5">
            {headings.map((heading, index) => (
              <motion.li
                key={`${heading.line}-${index}`}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index * 0.015, 0.18) }}
              >
                <button
                  type="button"
                  onClick={() => onNavigate(heading, index)}
                  title={heading.text}
                  className={cn(
                    'focus-ring flex w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-[var(--accent)]',
                    heading.level === 1 && 'pl-2 font-medium text-[var(--text)]',
                    heading.level === 2 && 'pl-3.5',
                    heading.level === 3 && 'pl-5 text-[11.5px]',
                    heading.level >= 4 && 'pl-6.5 text-[11px] text-[var(--faint)]',
                  )}
                >
                  <span className="truncate">{heading.text}</span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
