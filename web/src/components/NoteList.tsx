import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Cloud,
  CloudOff,
  FileText,
  HardDrive,
  Pin,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import type { NoteSummary } from '../lib/types';
import {
  DEFAULT_SEARCH_SCOPE,
  SORT_KEYS,
  useAppStore,
  useCanWrite,
  useReadOnlyReason,
  type SortKey,
  type SortOrder,
} from '../store/useAppStore';
import { NoteTree } from './NoteTree';
import { SessionFooter } from './Sidebar';
import { PublishDialog } from './publish/PublishDialog';
import { PublishManagerDialog } from './publish/PublishManagerDialog';
import { Badge, Button, Field, Input, Modal, Select, Skeleton, Tooltip } from './ui/primitives';

/** What each sort is called. Titles first: an alphabetical list is the one that
 * can be scanned, and the timestamp sorts are a click away. */
const SORT_LABELS: Record<SortKey, string> = {
  title: '标题',
  updated: '最近更新',
  created: '创建时间',
  words: '字数',
};

// Built from the store's own list so the picker cannot drift out of step with
// what the store accepts, and so titles stay first.
const SORTS = SORT_KEYS.map((value) => ({ value, label: SORT_LABELS[value] }));

/** The two directions, in the order the buttons are drawn. */
const ORDERS: { value: SortOrder; label: string; hint: string; Icon: typeof ArrowUp }[] = [
  { value: 'asc', label: '升序', hint: '升序排列', Icon: ArrowUp },
  { value: 'desc', label: '降序', hint: '降序排列（倒序）', Icon: ArrowDown },
];

/**
 * What the inline prompt is asking for.
 *
 * One piece of state rather than eight, because only one can be up at a time.
 * `value` is the typed answer - a folder name, a note title, or the destination
 * the move prompts pick from the dropdown. `folder` is the destination of the
 * prompts that also ask for something to type (a new note, an upload).
 */
export type PromptState =
  | { kind: 'newFolder'; parent: string; value: string }
  | { kind: 'renameFolder'; path: string; value: string }
  | { kind: 'renameNote'; id: string; value: string }
  | { kind: 'newNote'; value: string; folder: string }
  | { kind: 'upload'; folder: string }
  | { kind: 'moveNote'; id: string; value: string }
  | { kind: 'moveFolder'; path: string; value: string }
  | { kind: 'moveSelection'; value: string; count: number }
  | null;

/**
 * The single left column: navigation, filters and the note tree in one place.
 *
 * The card list and the grid are gone. Notes live in folders on disk, and the
 * tree is the one arrangement that says where a note actually is; the two card
 * modes could only answer "which notes are there", which is what the search box
 * is for.
 */
export function NotesPanel() {
  const version = useAppStore((s) => s.status?.version);
  const notes = useAppStore((s) => s.notes);
  const loadingNotes = useAppStore((s) => s.loadingNotes);
  const notesError = useAppStore((s) => s.notesError);
  const activeId = useAppStore((s) => s.activeId);
  const selectNote = useAppStore((s) => s.selectNote);
  const createNote = useAppStore((s) => s.createNote);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const sort = useAppStore((s) => s.sort);
  const setSort = useAppStore((s) => s.setSort);
  const sortOrder = useAppStore((s) => s.sortOrder);
  const setSortOrder = useAppStore((s) => s.setSortOrder);
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
  const moveFolder = useAppStore((s) => s.moveFolder);
  const renameNote = useAppStore((s) => s.renameNote);
  const createFolder = useAppStore((s) => s.createFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const togglePinned = useAppStore((s) => s.togglePinned);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const setFavoriteOnly = useAppStore((s) => s.setFavoriteOnly);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const selection = useAppStore((s) => s.selection);
  const moveSelection = useAppStore((s) => s.moveSelection);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const downloadSelection = useAppStore((s) => s.downloadSelection);
  const capabilities = useAppStore((s) => s.capabilities);
  // 'degraded' is OpenList configured but unreachable. The app refuses requests
  // rather than writing to the local disk (a different tree, not a copy), so this
  // reads as "OpenList is down" rather than as a fallback.
  const storageDegraded = useAppStore((s) => Boolean(s.status?.storage?.degraded));
  const driver = capabilities?.driver === 'openlist' ? 'openlist' : storageDegraded ? 'degraded' : 'local';
  const canWrite = useCanWrite();
  const readOnlyReason = useReadOnlyReason();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  // Where the files picked by the upload button are going. Held here rather than
  // in the dialog because the dialog is gone by the time the picker answers.
  const uploadTarget = useRef('');
  // Which inline prompt is open, if any.
  const [scopeOpen, setScopeOpen] = useState(false);
  const narrowed =
    favoriteOnly || pinnedOnly || !searchScope.title || !searchScope.content || !searchScope.tags;
  const scopePlaceholder =
    !searchScope.content && !searchScope.tags && searchScope.title
      ? '搜索标题…'
      : searchScope.title && !searchScope.tags
        ? '搜索标题与内容…'
        : '搜索笔记、标签…';
  const [dialog, setDialog] = useState<PromptState>(null);
  /** The note the publishing panel is open for, or null when it is closed. */
  const [publishTarget, setPublishTarget] = useState<string | null>(null);
  /** Whether the list of everything published is open. */
  const [publishManagerOpen, setPublishManagerOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes;
    if (favoriteOnly) list = list.filter((n) => n.favorite);
    if (pinnedOnly) list = list.filter((n) => n.pinned);
    if (activeTag) list = list.filter((n) => n.tags.includes(activeTag));
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
    // Pinned first whatever the sort, then the sort itself, then its direction.
    // One comparator rather than four: the direction is a property of the
    // ordering, not of any one key, so flipping it has to flip all of them.
    const direction = sortOrder === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const pin = Number(b.pinned) - Number(a.pinned);
      if (pin !== 0) return pin;
      switch (sort) {
        case 'created':
          return (Date.parse(b.created) - Date.parse(a.created)) * direction;
        case 'title':
          return a.title.localeCompare(b.title, 'zh-Hans-CN') * direction;
        case 'words':
          return (b.wordCount - a.wordCount) * direction;
        default:
          return (Date.parse(b.updated) - Date.parse(a.updated)) * direction;
      }
    });
  }, [notes, query, sort, sortOrder, activeTag, favoriteOnly, searchScope, pinnedOnly]);

  /**
   * A quick move names one dragged row, and which request that means depends on
   * what the id names: a folder moves by its path through the folder call, a
   * note by its id through the note one. They are not interchangeable - a
   * folder's path is not a note id. The folders the panel was given say which
   * it is, rather than the selection: a drag moves the row it set out from
   * whether or not that row was ever picked.
   */
  const quickMove = (id: string, folder: string) =>
    folders.some((entry) => entry.path === id) ? moveFolder(id, folder) : moveNote(id, folder);

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
              {driver === 'openlist' ? (
                <Cloud className="h-2.5 w-2.5" />
              ) : driver === 'degraded' ? (
                <CloudOff className="h-2.5 w-2.5" />
              ) : (
                <HardDrive className="h-2.5 w-2.5" />
              )}
              {driver === 'openlist' ? 'OpenList' : driver === 'degraded' ? 'OpenList 连不上' : '本地'}
            </span>
          </div>
          <div className="truncate text-[10px] text-[var(--faint)]">
            {capabilities?.root ?? (storageDegraded ? 'OpenList 连不上' : '本地磁盘')}
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
        {/* Both actions ask where the note is going before anything is made:
            the folder is a choice, not something inferred from the last click. */}
        <Button
          variant="primary"
          size="md"
          className="flex-1 justify-center"
          disabled={!canWrite}
          onClick={() => setDialog({ kind: 'newNote', value: '', folder: activeFolder ?? '' })}
          hint={canWrite ? '新建笔记' : (readOnlyReason ?? '没有写入权限')}
        >
          <Plus className="h-4 w-4" />
          新建笔记
        </Button>

        {/* Upload: every file goes up as it is - a .md becomes a note, a picture
            stays a picture. The dialog picks the folder first, and the picker
            that follows is opened against that choice. No accept filter: the
            tree lists every file, so the picker does too. */}
        <input
          ref={uploadRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            if (chosen.length > 0) void uploadFiles(chosen, uploadTarget.current);
            if (uploadRef.current) uploadRef.current.value = '';
          }}
        />
        <Tooltip label="上传文件">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            disabled={!canWrite}
            onClick={() => setDialog({ kind: 'upload', folder: activeFolder ?? '' })}
          >
            <Upload className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip label="回收站">
          <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => setTrashOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tooltip>
        {/* What the blog shows is decided next to the trash, where the other
            list-wide panels live. */}
        <Tooltip label="发布管理">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10"
            data-open-publish-manager
            onClick={() => setPublishManagerOpen(true)}
          >
            <Send className="h-4 w-4" />
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={scopePlaceholder}
            aria-label="搜索笔记"
            className="focus-ring h-9 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] pl-8 pr-10 text-[13px] text-[var(--text)] outline-none transition-all placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-9 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}

          {/* Where the search looks, and which notes it considers. Folded away
              by default: most searches want the defaults, but a search aimed at
              tags alone is a different question and needs asking properly. */}
          <Tooltip
            label="搜索范围与筛选"
            side="top"
            // The offsets have to sit on the wrapper: it is the positioned
            // element, so an absolutely placed child would resolve against it.
            // The "/" hint this used to make room for is gone, so the control is
            // the rightmost one again - and the clear button sits just inside it.
            className="absolute right-2 top-1/2 -translate-y-1/2"
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
              data-testid="sort-key"
              containerClassName="w-[104px]"
              className="h-[30px] rounded-lg border-[var(--line)] bg-transparent pl-2 pr-7 text-[11.5px] text-[var(--muted)]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {/* Which way the sort runs. Two buttons rather than one toggle, so
                the direction in force is readable at a glance instead of having
                to be worked out from an icon that could mean either. */}
            <div
              role="group"
              aria-label="排序方向"
              className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5"
            >
              {ORDERS.map(({ value, label, hint, Icon }) => (
                <Tooltip key={value} label={hint} side="top">
                  <button
                    type="button"
                    onClick={() => setSortOrder(value)}
                    aria-label={label}
                    aria-pressed={sortOrder === value}
                    data-testid={'sort-order-' + value}
                    className={cn(
                      'focus-ring relative flex h-6 w-6 items-center justify-center rounded-md transition-colors',
                      sortOrder === value ? 'text-[var(--accent)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
                    )}
                  >
                    {sortOrder === value ? (
                      <motion.span
                        layoutId="sort-order"
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

      {/* One rendering, because there is one arrangement: the tree notes
          actually live in. Selecting a folder marks it and seeds the next
          "new note" - it never hides the rest of the tree. */}
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {loadingNotes && notes.length === 0 ? (
          <div className="flex flex-col gap-2">
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
            hasQuery={Boolean(query) || Boolean(activeTag) || favoriteOnly}
            canCreate={canWrite}
            onCreate={() => setDialog({ kind: 'newNote', value: '', folder: activeFolder ?? '' })}
          />
        ) : (
          <NoteTree
            folders={folders}
            notes={filtered}
            activeFolder={activeFolder}
            activeId={activeId}
            canWrite={canWrite}
            actions={{
              onSelectNote: (id) => void selectNote(id),
              // Asks for the name rather than inventing one: a folder called
              // 新文件夹 that has to be renamed straight away is a step wasted.
              onCreateChild: (path) => setDialog({ kind: 'newFolder', parent: path, value: '新文件夹' }),
              onRenameFolder: (path) =>
                setDialog({ kind: 'renameFolder', path, value: path.split('/').pop() ?? path }),
              onMoveFolder: (path) => setDialog({ kind: 'moveFolder', path, value: '' }),
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
              // One note's publishing panel, from that row's own menu.
              onPublish: (id) => setPublishTarget(id),
              onMoveSelection: () => setDialog({ kind: 'moveSelection', value: '', count: selection.length }),
              // A drag that ends on a folder has already answered the only
              // question a move asks, so neither of these opens a dialog.
              // Both answer with the move they started, so the tree knows
              // whether the rows it was carrying actually went anywhere.
              onQuickMove: (id, folder) => quickMove(id, folder),
              onQuickMoveSelection: (folder) => moveSelection(folder),
              // A download needs no question in front of it: the files are
              // already named, and the browser does the saving.
              onDownloadSelection: () => void downloadSelection(),
              // The batch delete carries its own undo, so it does not need a
              // second question in front of it.
              onDeleteSelection: () => void deleteSelection(),
            }}
          />
        )}

        <PromptDialog
          state={dialog}
          folders={folders.map((f) => f.path)}
          onClose={() => setDialog(null)}
          onConfirm={(value, folder) => {
            const current = dialog;
            if (!current) return;
            setDialog(null);
            switch (current.kind) {
              case 'newFolder':
                void createFolder(current.parent ? `${current.parent}/${value}` : value);
                break;
              case 'renameFolder':
                void renameFolder(current.path, value);
                break;
              case 'renameNote':
                void renameNote(current.id, value);
                break;
              case 'newNote':
                // An empty title is a real choice: the note is called 未命名笔记.
                void createNote({ title: value.trim() || undefined, folder });
                break;
              case 'upload':
                // The dialog has said where; now comes the picker.
                uploadTarget.current = folder;
                uploadRef.current?.click();
                break;
              case 'moveNote':
                void moveNote(current.id, folder);
                break;
              case 'moveFolder':
                void moveFolder(current.path, folder);
                break;
              case 'moveSelection':
                void moveSelection(folder);
                break;
            }
          }}
        />

        {/* The publishing panels: one note's, opened from the tree's menu, and
            the whole list, opened from the button above the search box. */}
        <PublishDialog noteId={publishTarget} open={publishTarget !== null} onClose={() => setPublishTarget(null)} />
        <PublishManagerDialog open={publishManagerOpen} onClose={() => setPublishManagerOpen(false)} />
      </div>

      <div className="border-t border-[var(--line)] p-3">
        <SessionFooter />
      </div>
    </div>
  );
}

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

/**
 * What each prompt is called, what it explains, and which controls it shows.
 *
 * Kept in one table so a prompt cannot half-exist: every kind is described, and
 * a new one cannot be added without saying what it asks for.
 */
interface DialogInfo {
  title: string;
  /** The line under the title: where a folder goes, or where a note is going. */
  hint: string;
  /** The free-text answer, when the dialog asks for one. */
  field?: { label: string; aria: string; required: boolean; placeholder?: string };
  /** Whether the dialog picks a destination folder. */
  picker?: boolean;
  /** A folder that may not be the destination - one cannot move into itself. */
  exclude?: string;
}

function dialogInfo(state: NonNullable<PromptState>): DialogInfo {
  switch (state.kind) {
    case 'newFolder':
      return {
        title: '新建文件夹',
        hint: state.parent ? `在 ${state.parent} 下` : '在根目录下',
        field: { label: '文件夹名称', aria: '文件夹名称', required: true, placeholder: '新文件夹' },
      };
    case 'renameFolder':
      return {
        title: '重命名文件夹',
        hint: state.path,
        field: { label: '文件夹名称', aria: '文件夹名称', required: true },
      };
    case 'renameNote':
      return {
        title: '重命名笔记',
        hint: '留空则取消',
        field: { label: '笔记标题', aria: '笔记标题', required: true },
      };
    case 'newNote':
      return {
        title: '新建笔记',
        hint: '选择目标目录，空选项表示根目录',
        field: { label: '标题', aria: '笔记标题', required: false, placeholder: '未命名笔记' },
        picker: true,
      };
    case 'upload':
      return { title: '上传文件', hint: '选择目标目录，空选项表示根目录', picker: true };
    case 'moveNote':
      return { title: '移动笔记', hint: '选择目标目录，空选项表示根目录', picker: true };
    case 'moveFolder':
      return {
        title: '移动文件夹',
        hint: `选择目标目录，空选项表示根目录 · 不能移动到 ${state.path} 自身或其子目录`,
        picker: true,
        exclude: state.path,
      };
    case 'moveSelection':
      return {
        title: '批量移动',
        hint: `将移动 ${state.count} 项 · 选择目标目录，空选项表示根目录`,
        picker: true,
      };
  }
}

/** Where a dialog's folder dropdown starts. */
function initialFolder(state: NonNullable<PromptState>): string {
  if (state.kind === 'newNote' || state.kind === 'upload') return state.folder;
  if (state.kind === 'moveNote' || state.kind === 'moveFolder') return state.value;
  return '';
}

/**
 * The inline prompts for naming, moving and uploading.
 *
 * One small dialog rather than eight, since they differ only in their wording
 * and in whether the answer is typed or picked from the folder list.
 */
export function PromptDialog({
  state,
  folders,
  onClose,
  onConfirm,
}: {
  state: PromptState;
  folders: string[];
  onClose: () => void;
  /** The typed answer, and the folder the dropdown points at. */
  onConfirm: (value: string, folder: string) => void;
}) {
  const [value, setValue] = useState('');
  const [folder, setFolder] = useState('');

  useEffect(() => {
    setValue(state && 'value' in state ? state.value : '');
    setFolder(state ? initialFolder(state) : '');
  }, [state]);

  if (!state) return null;

  const info = dialogInfo(state);
  // A folder cannot be moved into itself or into what is already below it, so
  // those are left out rather than offered and then refused.
  const options = info.exclude
    ? folders.filter((path) => path !== info.exclude && !path.startsWith(`${info.exclude}/`))
    : folders;
  const ready = !info.field?.required || value.trim().length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={<span data-testid="dialog-title">{info.title}</span>}
      subtitle={info.hint}
      width="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            data-testid="dialog-confirm"
            disabled={!ready}
            onClick={() => onConfirm(value, folder)}
          >
            确定
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {info.field ? (
          <Field label={info.field.label}>
            <Input
              value={value}
              autoFocus
              aria-label={info.field.aria}
              data-testid="dialog-input"
              placeholder={info.field.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready) onConfirm(value, folder);
              }}
            />
          </Field>
        ) : null}
        {info.picker ? (
          <Field label="目标目录">
            <Select
              value={folder}
              aria-label="目标目录"
              data-testid="dialog-folder-select"
              onChange={(e) => setFolder(e.target.value)}
            >
              <option value="">根目录</option>
              {options.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
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
