import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownUp,
  FileText,
  LayoutGrid,
  List as ListIcon,
  Pin,
  Plus,
  Search,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/format';
import { useAppStore, type SortKey } from '../store/useAppStore';
import type { NoteSummary } from '../lib/types';
import { Badge, Button, Skeleton } from './ui/primitives';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '标题' },
  { value: 'words', label: '字数' },
];

export function NoteList() {
  const notes = useAppStore((s) => s.notes);
  const loadingNotes = useAppStore((s) => s.loadingNotes);
  const notesError = useAppStore((s) => s.notesError);
  const activeId = useAppStore((s) => s.activeId);
  const selectNote = useAppStore((s) => s.selectNote);
  const createNote = useAppStore((s) => s.createNote);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const sort = useAppStore((s) => s.sort);
  const setSort = useAppStore((s) => s.setSort);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const activeTag = useAppStore((s) => s.activeTag);
  const setActiveTag = useAppStore((s) => s.setActiveTag);
  const activeFolder = useAppStore((s) => s.activeFolder);
  const setActiveFolder = useAppStore((s) => s.setActiveFolder);
  const favoriteOnly = useAppStore((s) => s.favoriteOnly);
  const setFavoriteOnly = useAppStore((s) => s.setFavoriteOnly);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') return;
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes;
    if (favoriteOnly) list = list.filter((n) => n.favorite);
    if (activeTag) list = list.filter((n) => n.tags.includes(activeTag));
    if (activeFolder !== null) {
      const folder = activeFolder.replace(/^\//, '');
      list = list.filter((n) => n.folder === folder);
    }
    if (q) {
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.excerpt.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      const pin = Number(b.pinned) - Number(a.pinned);
      if (pin !== 0) return pin;
      switch (sort) {
        case 'created':
          return Date.parse(b.created) - Date.parse(a.created);
        case 'title':
          return a.title.localeCompare(b.title, 'zh-Hans-CN');
        case 'words':
          return b.wordCount - a.wordCount;
        default:
          return Date.parse(b.updated) - Date.parse(a.updated);
      }
    });
    return sorted;
  }, [notes, query, sort, activeTag, activeFolder, favoriteOnly]);

  const pinned = filtered.filter((n) => n.pinned);
  const rest = filtered.filter((n) => !n.pinned);
  const filterLabel = favoriteOnly
    ? '收藏'
    : activeTag
      ? `#${activeTag}`
      : activeFolder !== null
        ? `/${activeFolder}`
        : '全部笔记';

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header */}
      <div className="space-y-2.5 border-b border-[var(--line)] px-3 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记、标签…"
              className="focus-ring h-9 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] pl-8 pr-16 text-[13px] text-[var(--text)] outline-none transition-all placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">
                /
              </kbd>
            )}
          </div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => toggleSidebar(true)} aria-label="打开侧栏">
            <ListIcon className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-[var(--muted)]">{filterLabel}</span>
          <Badge tone="neutral">{filtered.length}</Badge>
          <div className="ml-auto flex items-center gap-1">
            <div className="relative">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="focus-ring h-7 cursor-pointer appearance-none rounded-lg border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] pl-6 pr-2 text-[11.5px] text-[var(--muted)] outline-none"
                aria-label="排序方式"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ArrowDownUp className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--faint)]" />
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5">
              <button
                type="button"
                onClick={() => setView('list')}
                className={cn(
                  'focus-ring relative flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  view === 'list' ? 'text-[var(--accent)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
                )}
                aria-label="列表视图"
              >
                {view === 'list' ? (
                  <motion.span
                    layoutId="view-toggle"
                    className="absolute inset-0 rounded-md bg-[var(--accent-soft)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                ) : null}
                <ListIcon className="relative h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView('grid')}
                className={cn(
                  'focus-ring relative flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                  view === 'grid' ? 'text-[var(--accent)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
                )}
                aria-label="网格视图"
              >
                {view === 'grid' ? (
                  <motion.span
                    layoutId="view-toggle"
                    className="absolute inset-0 rounded-md bg-[var(--accent-soft)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                ) : null}
                <LayoutGrid className="relative h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {activeTag || favoriteOnly || activeFolder !== null ? (
          <motion.button
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            type="button"
            onClick={() => {
              setActiveTag(null);
              setFavoriteOnly(false);
              setActiveFolder(null);
            }}
            className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] text-[var(--accent)]"
          >
            清除筛选 · {filterLabel}
            <X className="h-3 w-3" />
          </motion.button>
        ) : null}
      </div>

      {/* Body */}
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadingNotes && notes.length === 0 ? (
          <div className={cn('gap-2', view === 'grid' ? 'grid grid-cols-2' : 'flex flex-col')}>
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-[var(--line)] p-3">
                <Skeleton className="mb-2 h-3.5 w-3/5" />
                <Skeleton className="mb-1.5 h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : notesError ? (
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-[12.5px] text-[var(--danger)]">
            {notesError}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasQuery={Boolean(query) || Boolean(activeTag) || favoriteOnly || activeFolder !== null} onCreate={() => void createNote()} />
        ) : (
          <div className="space-y-4">
            {pinned.length ? (
              <Section title="置顶" count={pinned.length}>
                <NoteGrid notes={pinned} view={view} activeId={activeId} onSelect={selectNote} />
              </Section>
            ) : null}
            {rest.length ? (
              <Section title={pinned.length ? '其他' : ''} count={rest.length}>
                <NoteGrid notes={rest} view={view} activeId={activeId} onSelect={selectNote} />
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      {title ? (
        <div className="mb-2 flex items-center gap-2 px-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">{title}</span>
          <span className="text-[10.5px] text-[var(--faint)]">{count}</span>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function NoteGrid({
  notes,
  view,
  activeId,
  onSelect,
}: {
  notes: NoteSummary[];
  view: 'list' | 'grid';
  activeId: string | null;
  onSelect: (id: string) => void | Promise<void>;
}) {
  return (
    <motion.div layout className={cn('gap-2', view === 'grid' ? 'grid grid-cols-2 xl:grid-cols-2' : 'flex flex-col')}>
      <AnimatePresence initial={false} mode="popLayout">
        {notes.map((note, index) => (
          <NoteCard
            key={note.id}
            note={note}
            view={view}
            active={note.id === activeId}
            index={index}
            onSelect={() => void onSelect(note.id)}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function NoteCard({
  note,
  view,
  active,
  index,
  onSelect,
}: {
  note: NoteSummary;
  view: 'list' | 'grid';
  active: boolean;
  index: number;
  onSelect: () => void;
}) {
  const togglePinned = useAppStore((s) => s.togglePinned);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 32, delay: Math.min(index * 0.022, 0.22) }}
      onClick={onSelect}
      className={cn(
        'card-hover group relative cursor-pointer overflow-hidden rounded-2xl border p-3',
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
          : 'border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)]',
        view === 'grid' && 'min-h-[124px]',
      )}
    >
      {note.color ? (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-full" style={{ background: note.color }} />
      ) : null}

      <div className="mb-1.5 flex items-start gap-2">
        <h3 className="line-clamp-2 flex-1 text-[13.5px] font-semibold leading-snug tracking-tight text-[var(--text)]">
          {note.title || '未命名笔记'}
        </h3>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void togglePinned(note.id);
            }}
            className={cn(
              'focus-ring rounded-md p-1 transition-colors',
              note.pinned ? 'text-[var(--accent)]' : 'text-[var(--faint)] hover:text-[var(--accent)]',
            )}
            aria-label="置顶"
          >
            <Pin className={cn('h-3 w-3', note.pinned && 'fill-current')} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggleFavorite(note.id);
            }}
            className={cn(
              'focus-ring rounded-md p-1 transition-colors',
              note.favorite ? 'text-[var(--warn)]' : 'text-[var(--faint)] hover:text-[var(--warn)]',
            )}
            aria-label="收藏"
          >
            <Star className={cn('h-3 w-3', note.favorite && 'fill-current')} />
          </button>
        </div>
        {note.pinned ? <Pin className="h-3 w-3 shrink-0 fill-current text-[var(--accent)] group-hover:hidden" /> : null}
      </div>

      <p className={cn('text-[11.5px] leading-relaxed text-[var(--muted)]', view === 'grid' ? 'line-clamp-3' : 'line-clamp-2')}>
        {note.excerpt || '空白笔记'}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        {note.tags.slice(0, 2).map((tag) => (
          <span key={tag} className="rounded-full bg-[color-mix(in_srgb,var(--text)_7%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">
            #{tag}
          </span>
        ))}
        <span className="ml-auto text-[10.5px] text-[var(--faint)]">{relativeTime(note.updated)}</span>
      </div>
    </motion.article>
  );
}

function EmptyState({ hasQuery, onCreate }: { hasQuery: boolean; onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-16 text-center"
    >
      <div className="float-y mb-5 flex h-16 w-16 items-center justify-center rounded-3xl border border-[var(--line)] bg-[var(--panel)] text-[var(--accent)] shadow-soft">
        {hasQuery ? <Search className="h-7 w-7" /> : <Sparkles className="h-7 w-7" />}
      </div>
      <h3 className="text-[14.5px] font-semibold text-[var(--text)]">
        {hasQuery ? '没有匹配的笔记' : '开始你的第一篇笔记'}
      </h3>
      <p className="mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-[var(--muted)]">
        {hasQuery ? '换个关键词，或者清除当前筛选条件。' : '支持 Markdown、标签、文件夹，直接保存到 OpenList 目录。'}
      </p>
      {!hasQuery ? (
        <Button variant="primary" size="md" className="mt-5" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>
      ) : null}
      {!hasQuery ? <FileText className="mt-6 h-4 w-4 text-[var(--faint)]" /> : null}
    </motion.div>
  );
}
