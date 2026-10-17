import { motion } from 'framer-motion';
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree, PanelRightClose } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import {
  buildOutlineTree,
  collapsibleHeadingIndexes,
  extractHeadings,
  visibleOutlineRows,
  type Heading,
} from '../lib/outline';
import { useAppStore } from '../store/useAppStore';
import { Tooltip } from './ui/primitives';

/**
 * Document outline. It shares the editor's content row so it lines up with the
 * note.
 *
 * Navigation itself is the editor's job: the outline only says which heading was
 * picked, so that the address bar, the editor and the preview cannot drift apart
 * (they did when each of them had its own idea of what a click means).
 *
 * The headings are drawn as the sections they describe and start folded to the
 * top level: an outline is for finding a section, and reading every heading of a
 * long note is what the note itself is for. Folding changes nothing about
 * navigation - the flat index is still what the editor scrolls to.
 */
export function OutlinePanel({ onNavigate }: { onNavigate: (heading: Heading, index: number) => void }) {
  const activeNote = useAppStore((s) => s.activeNote);
  const toggleMeta = useAppStore((s) => s.toggleMeta);
  const headings = useMemo(() => extractHeadings(activeNote?.content ?? ''), [activeNote?.content]);
  const tree = useMemo(() => buildOutlineTree(headings), [headings]);
  // Which headings can be folded at all, by their position in the flat list. A
  // set because "everything is folded" has to be one value rather than a flag
  // per row that could drift out of step with the rest.
  const foldable = useMemo(() => collapsibleHeadingIndexes(tree), [tree]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set(foldable));
  const noteId = activeNote?.id;

  // A different note starts folded again; edits to the same note keep whatever
  // the user has opened, because folding the outline back up while they type in
  // the section they just opened would undo their work.
  useEffect(() => {
    setCollapsed(new Set(foldable));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const rows = useMemo(() => visibleOutlineRows(tree, collapsed), [tree, collapsed]);
  const allFolded = foldable.length > 0 && foldable.every((index) => collapsed.has(index));

  if (!activeNote) return null;

  const toggle = (index: number) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <div className="outline-panel flex h-full w-[228px] shrink-0 flex-col border-l border-[var(--line)]">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[var(--line)] px-3">
        <ListTree className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">大纲</span>
        {foldable.length > 0 ? (
          <Tooltip label={allFolded ? '全部展开' : '全部收起'} side="top">
            <button
              type="button"
              data-testid="outline-toggle-all"
              onClick={() => setCollapsed(allFolded ? new Set<number>() : new Set(foldable))}
              aria-label={allFolded ? '全部展开' : '全部收起'}
              className="focus-ring flex h-6 w-6 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
            >
              {allFolded ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
        ) : null}
        <Tooltip label="隐藏大纲" side="top">
          <button
            type="button"
            onClick={() => toggleMeta(false)}
            className="focus-ring flex h-6 w-6 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {headings.length === 0 ? (
          <p className="px-2 py-1 text-[11px] leading-relaxed text-[var(--faint)]">
            用 <code className="font-mono">#</code> 标记标题即可生成大纲
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map((row) => (
              <motion.li
                key={row.index}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(row.index * 0.015, 0.18) }}
              >
                <div className="flex items-center gap-0.5" style={{ paddingLeft: row.depth * 12 }}>
                  {row.hasChildren ? (
                    <button
                      type="button"
                      data-outline-collapse
                      aria-expanded={!row.collapsed}
                      aria-label={(row.collapsed ? '展开 ' : '收起 ') + row.heading.text}
                      onClick={() => toggle(row.index)}
                      className="focus-ring flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
                    >
                      <ChevronRight className={cn('h-3 w-3 transition-transform', !row.collapsed && 'rotate-90')} />
                    </button>
                  ) : (
                    // A leaf keeps the same gutter, so its text lines up with the
                    // sections beside it instead of starting a column early.
                    <span aria-hidden className="h-5 w-5 shrink-0" />
                  )}
                  <Tooltip label={row.heading.text} side="top" className="block min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onNavigate(row.heading, row.index)}
                      className={cn(
                        'focus-ring flex w-full items-center gap-1.5 rounded-lg py-1 pr-1.5 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-[var(--accent)]',
                        row.heading.level === 1 && 'font-medium text-[var(--text)]',
                        row.heading.level >= 4 && 'text-[11px] text-[var(--faint)]',
                      )}
                    >
                      <span className="truncate">{row.heading.text}</span>
                    </button>
                  </Tooltip>
                </div>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
