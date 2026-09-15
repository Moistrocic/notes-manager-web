import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, FileText, Folder, FolderInput, FolderPlus, Pencil, Pin, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/format';
import type { FolderCount, NoteSummary } from '../lib/types';
import { useAppStore } from '../store/useAppStore';
import { Tooltip } from './ui/primitives';

export interface NoteTreeActions {
  onSelectFolder: (path: string) => void;
  onSelectNote: (id: string) => void;
  /** Opens the naming prompt; an empty path means the notes root. */
  onCreateChild: (path: string) => void;
  onRenameFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onRenameNote: (id: string) => void;
  onMoveNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

/** A folder's children, built once per render rather than scanned per row. */
function childrenOf(folders: FolderCount[]): Map<string, FolderCount[]> {
  const map = new Map<string, FolderCount[]>();
  for (const folder of folders) {
    const cut = folder.path.lastIndexOf('/');
    const parent = cut < 0 ? '' : folder.path.slice(0, cut);
    const list = map.get(parent) ?? [];
    list.push(folder);
    map.set(parent, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return map;
}

/**
 * The note list as a directory tree.
 *
 * Folders and their notes in one place, at the depth they actually live at -
 * which is the only arrangement where "where is this note" is answered by
 * looking rather than by filtering. The two card modes deliberately do not do
 * this; they are for reading a set of notes, not for navigating a tree.
 */
export function NoteTree({
  folders,
  notes,
  activeFolder,
  activeId,
  canWrite,
  actions,
}: {
  folders: FolderCount[];
  notes: NoteSummary[];
  activeFolder: string | null;
  activeId: string | null;
  canWrite: boolean;
  actions: NoteTreeActions;
}) {
  const byFolder = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const note of notes) {
      const list = map.get(note.folder) ?? [];
      list.push(note);
      map.set(note.folder, list);
    }
    return map;
  }, [notes]);

  const tree = useMemo(() => childrenOf(folders), [folders]);

  // Held in the store, not here: hiding the note list unmounts this component,
  // and the tree should not forget where you were because you looked at a note.
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const setExpandedFolders = useAppStore((s) => s.setExpandedFolders);
  const open = useMemo(() => new Set(expandedFolders), [expandedFolders]);

  // Whatever is being looked at has to be reachable, so opening a folder from
  // elsewhere in the app unfolds the path down to it.
  useEffect(() => {
    if (!activeFolder) return;
    const next = new Set(expandedFolders);
    let path = activeFolder.replace(/^\//, '');
    let changed = false;
    while (path) {
      if (!next.has(path)) {
        next.add(path);
        changed = true;
      }
      const cut = path.lastIndexOf('/');
      path = cut < 0 ? '' : path.slice(0, cut);
    }
    if (changed) setExpandedFolders([...next]);
  }, [activeFolder, expandedFolders, setExpandedFolders]);

  const toggle = (path: string) => {
    const next = new Set(expandedFolders);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpandedFolders([...next]);
  };

  const renderFolders = (parent: string, depth: number) => {
    const list = tree.get(parent) ?? [];
    return list.map((folder) => {
      const kids = tree.get(folder.path) ?? [];
      const own = byFolder.get(folder.path) ?? [];
      const expanded = open.has(folder.path);
      const active = activeFolder === folder.path.replace(/^\//, '');
      return (
        <div key={folder.path}>
          <Row
            depth={depth}
            active={active}
            // Opens and closes. Selecting the folder is not this row's job:
            // filtering the list to one of its own branches is what the tree
            // exists to avoid.
            onClick={() => toggle(folder.path)}
            leading={
              <button
                type="button"
                aria-label={expanded ? '收起' : '展开'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(folder.path);
                }}
                // pointer-events-auto because the whole label area is
                // pointer-events-none: without it this button never receives
                // the click and a folder could only ever be opened, never shut.
                className={cn(
                  'focus-ring pointer-events-auto -ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[var(--faint)] transition-transform',
                  kids.length === 0 && own.length === 0 && 'invisible',
                  expanded && 'rotate-90',
                )}
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            }
            icon={<Folder className={cn('h-3.5 w-3.5 shrink-0', active && 'text-[var(--accent)]')} />}
            label={folder.name}
            count={folder.count}
            actions={
              <>
                <IconAction label="新建子文件夹" disabled={!canWrite} onClick={() => actions.onCreateChild(folder.path)}>
                  <FolderPlus className="h-3 w-3" />
                </IconAction>
                <IconAction label="重命名文件夹" disabled={!canWrite} onClick={() => actions.onRenameFolder(folder.path)}>
                  <Pencil className="h-3 w-3" />
                </IconAction>
                <IconAction
                  label="删除文件夹（移入回收站，可恢复）"
                  disabled={!canWrite}
                  danger
                  onClick={() => actions.onDeleteFolder(folder.path)}
                >
                  <Trash2 className="h-3 w-3" />
                </IconAction>
              </>
            }
          />
          <AnimatePresence initial={false}>
            {expanded ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                {renderFolders(folder.path, depth + 1)}
                {own.map((note) => renderNote(note, depth + 1))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      );
    });
  };

  const renderNote = (note: NoteSummary, depth: number) => (
    <Row
      key={note.id}
      depth={depth}
      active={note.id === activeId}
      onClick={() => actions.onSelectNote(note.id)}
      leading={<span className="w-5 shrink-0" />}
      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />}
      label={note.title || '未命名笔记'}
      sub={relativeTime(Date.parse(note.updated))}
      marked={
        <>
          {note.pinned ? <Pin className="h-3 w-3 shrink-0 text-[var(--accent)]" /> : null}
          {note.favorite ? <Star className="h-3 w-3 shrink-0 text-[var(--warn)]" /> : null}
        </>
      }
      actions={
        <>
          {/* Kept in the tree too: a note's state is not a property of how the
              list happens to be arranged. */}
          <IconAction
            label={note.pinned ? '取消置顶' : '置顶'}
            active={note.pinned}
            disabled={!canWrite}
            onClick={() => actions.onTogglePin(note.id)}
          >
            <Pin className="h-3 w-3" />
          </IconAction>
          <IconAction
            label={note.favorite ? '取消收藏' : '收藏'}
            active={note.favorite}
            disabled={!canWrite}
            onClick={() => actions.onToggleFavorite(note.id)}
          >
            <Star className="h-3 w-3" />
          </IconAction>
          <IconAction label="重命名笔记" disabled={!canWrite} onClick={() => actions.onRenameNote(note.id)}>
            <Pencil className="h-3 w-3" />
          </IconAction>
          <IconAction label="移动到文件夹" disabled={!canWrite} onClick={() => actions.onMoveNote(note.id)}>
            <FolderInput className="h-3 w-3" />
          </IconAction>
          <IconAction label="删除笔记" disabled={!canWrite} danger onClick={() => actions.onDeleteNote(note.id)}>
            <Trash2 className="h-3 w-3" />
          </IconAction>
        </>
      }
    />
  );

  const rootNotes = byFolder.get('') ?? [];
  const roots = tree.get('') ?? [];

  return (
    <div className="space-y-0.5 px-2">
      {/* Folders can be made at the top level too, not only inside another. */}
      <button
        type="button"
        onClick={() => actions.onCreateChild('')}
        disabled={!canWrite}
        className="focus-ring mb-1 flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11.5px] text-[var(--faint)] transition-colors hover:text-[var(--accent)] disabled:opacity-40"
      >
        <FolderPlus className="h-3.5 w-3.5" />
        在根目录新建文件夹
      </button>
      {renderFolders('', 0)}
      {rootNotes.map((note) => renderNote(note, 0))}
      {roots.length === 0 && rootNotes.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-[var(--faint)]">这里还没有笔记。</p>
      ) : null}
    </div>
  );
}

function Row({
  depth,
  active,
  onClick,
  leading,
  icon,
  label,
  sub,
  count,
  marked,
  actions,
}: {
  depth: number;
  active: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  count?: number;
  marked?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-1.5 rounded-xl py-1.5 pr-1.5 text-[12.5px] transition-colors',
        active ? 'bg-[var(--accent-soft)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]',
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      <button
        type="button"
        onClick={onClick}
        className="focus-ring absolute inset-0 rounded-xl"
        aria-label={label}
        aria-current={active || undefined}
      />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1.5">
        {leading}
        {icon}
        {/* No right-hand gutter reserved here. The actions float over the row
            instead, so a title is shown whole until the pointer is actually on
            it - which is when the buttons become worth more than the last few
            characters. */}
        <span className={cn('truncate', active && 'font-medium')}>{label}</span>
        {marked}
        {sub ? <span className="shrink-0 text-[10px] text-[var(--faint)]">{sub}</span> : null}
        {typeof count === 'number' && count > 0 ? (
          <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--faint)] transition-opacity group-hover/row:opacity-0">
            {count}
          </span>
        ) : null}
      </span>
      <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg bg-[var(--panel-solid)] px-0.5 opacity-0 shadow-soft transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
        {actions}
      </span>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          'focus-ring flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-40',
          danger
            ? 'text-[var(--faint)] hover:text-[var(--danger)]'
            : active
              ? 'text-[var(--accent)]'
              : 'text-[var(--faint)] hover:text-[var(--accent)]',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
