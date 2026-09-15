import { AnimatePresence, motion } from 'framer-motion';
import {
  Cloud,
  HardDrive,
  ChevronLeft,
  FileText,
  LayoutGrid,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/format';
import { useAppStore, useCanWrite, useReadOnlyReason, type SortKey } from '../store/useAppStore';
import type { NoteSummary } from '../lib/types';
import { DEFAULT_SEARCH_SCOPE } from '../store/useAppStore';
import { NoteTree } from './NoteTree';
import { Badge, Button, Input, Modal, Select, Skeleton, Tooltip } from './ui/primitives';
import { SessionFooter } from './Sidebar';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '标题' },
  { value: 'words', label: '字数' },
];

/**
 * The single left column: navigation, filters and the note list in one place.
 * It used to be two columns (a nav column plus a list column) which wasted
 * horizontal space on narrow screens.
 */
/**
 * Three boxes standing in a row, seen slightly from the side.
 *
 * The card list is a stack of cards, and a generic "rows" glyph said nothing
 * about that; these are drawn to look like the cards they switch to.
 */
function CardsIcon({ className }: { className?: string }) {
  const width = 9;
  const height = 3.4;
  const depth = 1.4;
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      {[2.2, 6.6, 11].map((y) => {
        const x = (16 - width) / 2;
        return (
          <g key={y}>
            <rect x={x} y={y} width={width} height={height} rx={0.6} stroke="currentColor" strokeWidth={1.1} />
            <path
              d={`M${x} ${y} L${x + depth} ${y - depth} L${x + width + depth} ${y - depth} L${x + width} ${y}`}
              stroke="currentColor"
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
            <path
              d={`M${x + width} ${y} L${x + width + depth} ${y - depth} L${x + width + depth} ${y + height - depth} L${x + width} ${y + height}`}
              stroke="currentColor"
              strokeWidth={1.1}
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** Three bullets and their lines - the shape of an outline. */
function TreeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      {[3.4, 8, 12.6].map((y) => (
        <g key={y}>
          <circle cx={2.6} cy={y} r={1.15} fill="currentColor" />
          <path d={`M5.6 ${y} H13.6`} stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

export function NotesPanel() {
  const version = useAppStore((s) => s.status?.version);
  const notes = useAppStore((s) => s.notes);
  const loadingNotes = useAppStore((s) => s.loadingNotes);
  const notesError = useAppStore((s) => s.notesError);
  const activeId = useAppStore((s) => s.activeId);
  const selectNote = useAppStore((s) => s.selectNote);
  const createNote = useAppStore((s) => s.createNote);
  const uploadNotes = useAppStore((s) => s.uploadNotes);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);
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
  const pinnedOnly = useAppStore((s) => s.pinnedOnly);
  const setPinnedOnly = useAppStore((s) => s.setPinnedOnly);
  const searchScope = useAppStore((s) => s.searchScope);
  const setSearchScope = useAppStore((s) => s.setSearchScope);
  const folders = useAppStore((s) => s.folders);
  const renameFolder = useAppStore((s) => s.renameFolder);
  const moveNote = useAppStore((s) => s.moveNote);
  const renameNote = useAppStore((s) => s.renameNote);
  const createFolder = useAppStore((s) => s.createFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const togglePinned = useAppStore((s) => s.togglePinned);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const setFavoriteOnly = useAppStore((s) => s.setFavoriteOnly);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const capabilities = useAppStore((s) => s.capabilities);
  // 'degraded' is OpenList configured but unreachable, so notes fall back to disk.
  const storageDegraded = useAppStore((s) => Boolean(s.status?.storage?.degraded));
  const driver = capabilities?.driver === 'openlist' ? 'openlist' : storageDegraded ? 'degraded' : 'local';
  const canWrite = useCanWrite();
  const readOnlyReason = useReadOnlyReason();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  // Which inline prompt is open, if any. One piece of state rather than three,
  // because only one can be up at a time.
  const [scopeOpen, setScopeOpen] = useState(false);
  const narrowed =
    favoriteOnly || pinnedOnly || !searchScope.title || !searchScope.content || !searchScope.tags;
  const scopePlaceholder =
    !searchScope.content && !searchScope.tags && searchScope.title
      ? '搜索标题…'
      : searchScope.title && !searchScope.tags
        ? '搜索标题与内容…'
        : '搜索笔记、标签…';
  const [dialog, setDialog] = useState<
    | { kind: 'newFolder'; parent: string; value: string }
    | { kind: 'renameFolder'; path: string; value: string }
    | { kind: 'renameNote'; id: string; value: string }
    | { kind: 'moveNote'; id: string; value: string }
    | null
  >(null);

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
    if (pinnedOnly) list = list.filter((n) => n.pinned);
    if (activeTag) list = list.filter((n) => n.tags.includes(activeTag));
    // In the tree, the selected folder is highlighted rather than filtered to -
    // narrowing a tree to one of its own branches removes the context that made
    // it a tree.
    if (activeFolder !== null && view !== 'tree') {
      const folder = activeFolder.replace(/^\//, '');
      list = list.filter((n) => n.folder === folder);
    }
    if (q) {
      // Only the fields the scope allows, so a search can be aimed at titles
      // without every body match drowning the result.
      const fields = [
        searchScope.title ? (n: NoteSummary) => n.title.toLowerCase().includes(q) : null,
        searchScope.content ? (n: NoteSummary) => n.excerpt.toLowerCase().includes(q) : null,
        searchScope.tags ? (n: NoteSummary) => n.tags.some((t) => t.toLowerCase().includes(q)) : null,
      ].filter((f): f is (n: NoteSummary) => boolean => f !== null);
      list = fields.length === 0 ? [] : list.filter((n) => fields.some((match) => match(n)));
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
  }, [notes, query, sort, activeTag, activeFolder, favoriteOnly, view, searchScope, pinnedOnly]);

  const pinned = filtered.filter((n) => n.pinned);
  const rest = filtered.filter((n) => !n.pinned);
  const filterLabel = favoriteOnly ? '收藏' : activeTag ? `#${activeTag}` : activeFolder !== null ? `/${activeFolder}` : '全部笔记';

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Brand + primary action */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-soft">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-tight">笔记管理面板</span>
            {version ? (
              <span className="shrink-0 rounded-md bg-[var(--accent-soft)] px-1 py-0.5 font-mono text-[9px] leading-none text-[var(--accent)]">
                {'v' + version}
              </span>
            ) : null}
            {/* Where the notes actually live, at a glance. The connection
                detail itself is in the server settings. */}
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] leading-none',
                driver === 'openlist'
                  ? 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]'
                  : driver === 'degraded'
                    ? 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-[var(--warn)]'
                    : 'bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[var(--faint)]',
              )}
              title={capabilities?.root}
            >
              {driver === 'openlist' ? <Cloud className="h-2.5 w-2.5" /> : <HardDrive className="h-2.5 w-2.5" />}
              {driver === 'openlist' ? 'OpenList' : driver === 'degraded' ? '本地（降级）' : '本地'}
            </span>
          </div>
          <div className="truncate text-[10px] text-[var(--faint)]">
            {capabilities?.root ?? '本地磁盘'}
            {capabilities && !capabilities.writable ? ' · 只读' : ''}
          </div>
        </div>
        <Tooltip label="隐藏列表">
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={() => toggleSidebar(false)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2">
        <Button
          variant="primary"
          size="md"
          className="flex-1 justify-center"
          disabled={!canWrite}
          onClick={() => void createNote({ folder: activeFolder ?? undefined })}
          hint={canWrite ? '新建笔记' : (readOnlyReason ?? '没有写入权限')}
        >
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>

        {/* Upload: one note per .md file, into the folder currently open. */}
        <input
          ref={uploadRef}
          type="file"
          multiple
          accept=".md,.markdown,.txt,text/markdown"
          className="hidden"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            if (chosen.length > 0) void uploadNotes(chosen, activeFolder ?? undefined);
            if (uploadRef.current) uploadRef.current.value = '';
          }}
        />
        <Tooltip label="上传笔记（.md）">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            disabled={!canWrite}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip label="回收站">
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setTrashOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      {!canWrite ? (
        <div className="mx-3 mb-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--warn)]">
          只读：{readOnlyReason ?? '当前账号没有写入权限'}
        </div>
      ) : null}


      {/* Search + filters */}
      <div className="space-y-2 border-b border-[var(--line)] px-3 pb-2.5 pt-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scopePlaceholder}
            className="focus-ring h-9 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] pl-8 pr-[4.5rem] text-[13px] text-[var(--text)] outline-none transition-all placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
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

          {/* Where the search looks, and which notes it considers. Folded away
              by default: most searches want the defaults, but a search aimed at
              tags alone is a different question and needs asking properly. */}
          <Tooltip
            label="搜索范围与筛选"
            side="top"
            // The offsets have to sit on the wrapper: it is the positioned
            // element, so an absolutely placed child would resolve against it.
            className="absolute right-9 top-1/2 -translate-y-1/2"
          >
            <button
              type="button"
              onClick={() => setScopeOpen((open) => !open)}
              aria-expanded={scopeOpen}
              className={cn(
                'focus-ring flex h-6 items-center gap-1 rounded-md px-1.5 text-[10.5px] transition-colors',
                scopeOpen || narrowed
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--faint)] hover:text-[var(--muted)]',
              )}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {narrowed ? '已筛选' : ''}
            </button>
          </Tooltip>
        </div>

        <AnimatePresence initial={false}>
          {scopeOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-[var(--faint)]">搜索范围</span>
                  {(
                    [
                      { key: 'title' as const, label: '标题 / 文件名' },
                      { key: 'content' as const, label: '笔记内容' },
                      { key: 'tags' as const, label: '标签' },
                    ] as const
                  ).map((field) => (
                    <Chip
                      key={field.key}
                      active={searchScope[field.key]}
                      onClick={() => setSearchScope({ ...searchScope, [field.key]: !searchScope[field.key] })}
                    >
                      {field.label}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-[var(--faint)]">只看</span>
                  <Chip
                    active={favoriteOnly}
                    onClick={() => setFavoriteOnly(!favoriteOnly)}
                    icon={<Star className="h-3 w-3" />}
                  >
                    收藏
                  </Chip>
                  <Chip
                    active={pinnedOnly}
                    onClick={() => setPinnedOnly(!pinnedOnly)}
                    icon={<Pin className="h-3 w-3" />}
                  >
                    置顶
                  </Chip>
                  {narrowed ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchScope({ ...DEFAULT_SEARCH_SCOPE });
                        setFavoriteOnly(false);
                        setPinnedOnly(false);
                      }}
                      className="focus-ring ml-auto rounded-full px-2 py-0.5 text-[11px] text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
                    >
                      重置
                    </button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-[var(--muted)]">{filterLabel}</span>
          <Badge tone="neutral">{filtered.length}</Badge>
          <div className="ml-auto flex items-center gap-1">
            <Select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="排序方式"
              containerClassName="w-[104px]"
              className="h-[30px] rounded-lg border-[var(--line)] bg-transparent pl-2 pr-7 text-[11.5px] text-[var(--muted)]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5">
              {(
                [
                  { mode: 'tree' as const, label: '目录树（文件夹与笔记）', Icon: TreeIcon },
                  { mode: 'list' as const, label: '卡片列表', Icon: CardsIcon },
                  { mode: 'grid' as const, label: '网格视图', Icon: LayoutGrid },
                ] as const
              ).map(({ mode, label, Icon }) => (
                <Tooltip key={mode} label={label} side="top">
                  <button
                    type="button"
                    onClick={() => setView(mode)}
                    className={cn(
                      'focus-ring relative flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                      view === mode ? 'text-[var(--accent)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
                    )}
                    aria-pressed={view === mode}
                  >
                    {view === mode ? (
                      <motion.span
                        layoutId="view-toggle"
                        className="absolute inset-0 rounded-md bg-[var(--accent-soft)]"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    ) : null}
                    <Icon className="relative h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              ))}
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

      {/* Notes */}
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
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-[12.5px] leading-relaxed text-[var(--danger)]">
            {notesError}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasQuery={Boolean(query) || Boolean(activeTag) || favoriteOnly || activeFolder !== null}
            canCreate={canWrite}
            onCreate={() => void createNote()}
          />
        ) : view === 'tree' ? (
          <NoteTree
            folders={folders}
            notes={filtered}
            activeFolder={activeFolder}
            activeId={activeId}
            canWrite={canWrite}
            actions={{
              onSelectFolder: (path) => setActiveFolder(activeFolder === path ? null : path),
              onSelectNote: (id) => void selectNote(id),
              // Asks for the name rather than inventing one: a folder called
              // 新文件夹 that has to be renamed straight away is a step wasted.
              onCreateChild: (path) => setDialog({ kind: 'newFolder', parent: path, value: '新文件夹' }),
              onRenameFolder: (path) =>
                setDialog({ kind: 'renameFolder', path, value: path.split('/').pop() ?? path }),
              onDeleteFolder: (path) => void deleteFolder(path),
              onRenameNote: (id) => {
                const note = notes.find((n) => n.id === id);
                if (note) setDialog({ kind: 'renameNote', id, value: note.title });
              },
              onMoveNote: (id) => {
                const note = notes.find((n) => n.id === id);
                if (note) setDialog({ kind: 'moveNote', id, value: note.folder });
              },
              onDeleteNote: (id) => void deleteNote(id),
              onTogglePin: (id) => void togglePinned(id),
              onToggleFavorite: (id) => void toggleFavorite(id),
            }}
          />
        ) : (
          <div className="space-y-4">
            {pinned.length ? (
              <Section title="置顶" count={pinned.length}>
                <NoteGrid notes={pinned} view={view} activeId={activeId} onSelect={selectNote} canWrite={canWrite} />
              </Section>
            ) : null}
            {rest.length ? (
              <Section title={pinned.length ? '其他' : ''} count={rest.length}>
                <NoteGrid notes={rest} view={view} activeId={activeId} onSelect={selectNote} canWrite={canWrite} />
              </Section>
            ) : null}
          </div>
        )}

        <PromptDialog
          state={dialog}
          folders={folders.map((f) => f.path)}
          onClose={() => setDialog(null)}
          onConfirm={(value) => {
            if (!dialog) return;
            if (dialog.kind === 'newFolder') {
              void createFolder(dialog.parent ? `${dialog.parent}/${value}` : value);
            }
            if (dialog.kind === 'renameFolder') void renameFolder(dialog.path, value);
            if (dialog.kind === 'renameNote') void renameNote(dialog.id, value);
            if (dialog.kind === 'moveNote') void moveNote(dialog.id, value);
            setDialog(null);
          }}
        />
      </div>

      <div className="border-t border-[var(--line)] p-3">
        <SessionFooter />
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

/**
 * The inline prompts for renaming and moving.
 *
 * One small dialog rather than three, since they differ only in their label and
 * whether the value is typed or picked from the folder list.
 */
/** A small on/off pill, used for the search scope and the filters. */
function Chip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--text)]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function PromptDialog({
  state,
  folders,
  onClose,
  onConfirm,
}: {
  state:
    | { kind: 'newFolder'; parent: string; value: string }
    | { kind: 'renameFolder'; path: string; value: string }
    | { kind: 'renameNote'; id: string; value: string }
    | { kind: 'moveNote'; id: string; value: string }
    | null;
  folders: string[];
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(state?.value ?? '');
  }, [state]);

  if (!state) return null;

  const title =
    state.kind === 'newFolder'
      ? '新建文件夹'
      : state.kind === 'renameFolder'
        ? '重命名文件夹'
        : state.kind === 'renameNote'
          ? '重命名笔记'
          : '移动笔记';
  const hint =
    state.kind === 'newFolder'
      ? state.parent
        ? `在 ${state.parent} 下`
        : '在根目录下'
      : state.kind === 'renameFolder'
        ? state.path
        : state.kind === 'moveNote'
          ? '选择目标文件夹，空选项表示根目录'
          : '留空则取消';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={hint}
      width="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(value)} disabled={state.kind !== 'moveNote' && !value.trim()}>
            确定
          </Button>
        </div>
      }
    >
      {state.kind === 'moveNote' ? (
        <Select value={value} onChange={(e) => setValue(e.target.value)} aria-label="目标文件夹">
          <option value="">根目录</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          value={value}
          autoFocus
          aria-label={title}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value);
          }}
        />
      )}
    </Modal>
  );
}

function NoteGrid({
  notes,
  view,
  activeId,
  onSelect,
  canWrite,
}: {
  notes: NoteSummary[];
  /** The two card modes; the tree is its own component. */
  view: 'list' | 'grid';
  activeId: string | null;
  onSelect: (id: string) => void | Promise<void>;
  canWrite: boolean;
}) {
  return (
    <motion.div layout className={cn('gap-2', view === 'grid' ? 'grid grid-cols-2' : 'flex flex-col')}>
      <AnimatePresence initial={false} mode="popLayout">
        {notes.map((note, index) => (
          <NoteCard
            key={note.id}
            note={note}
            view={view}
            active={note.id === activeId}
            index={index}
            canWrite={canWrite}
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
  canWrite,
  onSelect,
}: {
  note: NoteSummary;
  view: 'list' | 'grid';
  active: boolean;
  index: number;
  canWrite: boolean;
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
      {note.color ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full" style={{ background: note.color }} /> : null}

      <div className="mb-1.5 flex items-start gap-2">
        <h3 className="line-clamp-2 flex-1 text-[13.5px] font-semibold leading-snug tracking-tight text-[var(--text)]">
          {note.title || '未命名笔记'}
        </h3>
        {canWrite ? (
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
        ) : null}
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

function EmptyState({ hasQuery, canCreate, onCreate }: { hasQuery: boolean; canCreate: boolean; onCreate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center px-6 py-14 text-center"
    >
      <div className="float-y mb-5 flex h-14 w-14 items-center justify-center rounded-3xl border border-[var(--line)] bg-[var(--panel)] text-[var(--accent)] shadow-soft">
        {hasQuery ? <Search className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </div>
      <h3 className="text-[14px] font-semibold text-[var(--text)]">{hasQuery ? '没有匹配的笔记' : '开始你的第一篇笔记'}</h3>
      <p className="mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-[var(--muted)]">
        {hasQuery
          ? '换个关键词，或者清除当前筛选条件。'
          : canCreate
            ? '支持 Markdown、标签、文件夹，直接保存到 OpenList 目录。'
            : '当前账号只能浏览，无法创建笔记。'}
      </p>
      {!hasQuery && canCreate ? (
        <Button variant="primary" size="md" className="mt-5" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>
      ) : null}
    </motion.div>
  );
}
