import { motion } from 'framer-motion';
import { AlignLeft, Hash, ListTree } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { formatDateTime, formatNumber } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { EditorApi } from './CodeEditor';

interface Heading {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(content: string): Heading[] {
  const out: Heading[] = [];
  const lines = content.split('\n');
  let inFence = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) out.push({ level: match[1].length, text: match[2], line: index + 1 });
  });
  return out;
}

export function OutlinePanel({ editorApiRef }: { editorApiRef: { current: EditorApi | null } }) {
  const activeNote = useAppStore((s) => s.activeNote);
  const headings = useMemo(() => extractHeadings(activeNote?.content ?? ''), [activeNote?.content]);

  if (!activeNote) return null;

  const paragraphs = activeNote.content.split(/\n\s*\n/).filter((p) => p.trim()).length;

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col gap-3 border-l border-[var(--line)] p-3">
      <section className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">
          <AlignLeft className="h-3 w-3" /> 文档信息
        </h3>
        <dl className="space-y-1.5 text-[11.5px]">
          {[
            ['字数', formatNumber(activeNote.wordCount)],
            ['段落', formatNumber(paragraphs)],
            ['标题', formatNumber(headings.length)],
            ['标签', formatNumber(activeNote.tags.length)],
            ['创建', formatDateTime(activeNote.created)],
            ['更新', formatDateTime(activeNote.updated)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <dt className="text-[var(--faint)]">{label}</dt>
              <dd className="truncate text-[var(--muted)]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">
          <ListTree className="h-3 w-3" /> 大纲
        </h3>
        <div className="scroll-area -mr-1 flex-1 overflow-y-auto pr-1">
          {headings.length === 0 ? (
            <p className="text-[11px] text-[var(--faint)]">使用 # 标题即可生成大纲</p>
          ) : (
            <ul className="space-y-0.5">
              {headings.map((heading, index) => (
                <motion.li
                  key={`${heading.line}-${index}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(index * 0.02, 0.2) }}
                >
                  <button
                    type="button"
                    onClick={() => editorApiRef.current?.revealLine(heading.line)}
                    className={cn(
                      'focus-ring flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-[var(--accent)]',
                      heading.level >= 3 && 'pl-4 text-[11.5px]',
                      heading.level >= 4 && 'pl-6 text-[11px]',
                    )}
                  >
                    <Hash className="h-2.5 w-2.5 shrink-0 opacity-50" />
                    <span className="truncate">{heading.text}</span>
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3">
        <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">存储位置</h3>
        <p className="break-all font-mono text-[10.5px] leading-relaxed text-[var(--faint)]">{activeNote.path}</p>
      </section>
    </aside>
  );
}
