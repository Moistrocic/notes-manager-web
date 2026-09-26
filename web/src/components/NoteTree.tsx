import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Download,
  File,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Pin,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { noteDownloadUrl } from '../lib/api';
import { cn } from '../lib/cn';
import { formatBytes, relativeTime } from '../lib/format';
import type { FolderCount, NoteSummary } from '../lib/types';
import { useAppStore, type SelectionEntry, type SortKey, type SortOrder } from '../store/useAppStore';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';

export interface NoteTreeActions {
  onSelectNote: (id: string) => void;
  /** Opens the naming prompt; an empty path means the notes root. */
  onCreateChild: (path: string) => void;
  onRenameFolder: (path: string) => void;
  /** Opens the "move folder to..." prompt. */
  onMoveFolder: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onRenameNote: (id: string) => void;
  onMoveNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Opens the publishing panel for one note: what the blog makes of it. */
  onPublish: (id: string) => void;
  /** Moves every selected row; the panel asks where to. */
  onMoveSelection: () => void;
  /**
   * Moves one dragged row into a folder without asking - what a drag ends with.
   * `folder` is a folder path, or '' for the notes root. The answer is the move
   * the panel started, so a move that fails can leave the picking alone.
   */
  onQuickMove: (id: string, folder: string) => void | Promise<void>;
  /** Moves everything picked into a folder without asking. */
  onQuickMoveSelection: (folder: string) => void | Promise<void>;
  /** Downloads every selected note; a folder has no bytes of its own to send. */
  onDownloadSelection: () => void;
  /** Deletes every selected row (into the trash). */
  onDeleteSelection: () => void;
}

/** How long a press has to stay put before it opens the picking. */
const HOLD_SELECT_MS = 300;
/** Movement past this many pixels turns a press into a drag. */
const SLOP = 8;

const sameEntry = (a: SelectionEntry, b: SelectionEntry) => a.kind === b.kind && a.id === b.id;

/** The glyph for what a row holds: a note, a picture, or any other file. */
function kindIcon(kind: NoteSummary['kind'] | undefined) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'file') return File;
  return FileText;
}

/** Reads a row's key back: "note:<id>" for a note, "folder:<path>" for a folder. */
function entryOfRowKey(key: string | null | undefined): SelectionEntry | null {
  if (!key) return null;
  const cut = key.indexOf(':');
  if (cut <= 0) return null;
  const kind = key.slice(0, cut);
  if (kind !== 'note' && kind !== 'folder') return null;
  return { kind, id: key.slice(cut + 1) };
}

/** The folder a path sits in; a top-level one sits in the notes root. */
function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/** A folder's children, built once per render rather than scanned per row. */
function childrenOf(folders: FolderCount[], descending: boolean): Map<string, FolderCount[]> {
  const map = new Map<string, FolderCount[]>();
  for (const folder of folders) {
    const cut = folder.path.lastIndexOf('/');
    const parent = cut < 0 ? '' : folder.path.slice(0, cut);
    const list = map.get(parent) ?? [];
    list.push(folder);
    map.set(parent, list);
  }
  const direction = descending ? -1 : 1;
  for (const list of map.values()) {
    list.sort((a, b) => direction * a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }
  return map;
}

/**
 * The order of the notes inside one folder.
 *
 * Pinned notes stay on top whatever the column: being pinned is a property of
 * the note rather than a field being sorted on, and the one arrangement people
 * reach for when a note "must not get lost" should not be undone by switching
 * to a different column.
 */
function compareNotes(a: NoteSummary, b: NoteSummary, sort: SortKey, order: SortOrder): number {
  const pinned = Number(b.pinned) - Number(a.pinned);
  if (pinned !== 0) return pinned;
  const direction = order === 'desc' ? -1 : 1;
  switch (sort) {
    case 'created':
      return direction * (Date.parse(a.created) - Date.parse(b.created));
    case 'words':
      return direction * (a.wordCount - b.wordCount);
    case 'title':
      return direction * a.title.localeCompare(b.title, 'zh-Hans-CN');
    default:
      return direction * (Date.parse(a.updated) - Date.parse(b.updated));
  }
}

/**
 * The note list as a directory tree.
 *
 * Folders and their notes in one place, at the depth they actually live at -
 * which is the only arrangement where "where is this note" is answered by
 * looking rather than by filtering. It is the only arrangement the panel
 * offers: the card and grid modes that used to sit beside it were a way of
 * reading a set of notes, not of finding one.
 *
 * Everything a row can do is on its right-click menu rather than on a toolbar
 * that appeared under the pointer: a row's hover already hides its title behind
 * buttons, and clicking is how you navigate the tree - the menu is where the
 * verbs live. One press is three gestures and the pointer says which: let go
 * quickly and it was a click, move it and the row is dragged onto a folder,
 * hold it still for a moment and it opens the picking. A move never leaves a
 * selection behind, and a drag never opens one.
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
  const sort = useAppStore((s) => s.sort);
  const sortOrder = useAppStore((s) => s.sortOrder);
  const expandedFolders = useAppStore((s) => s.expandedFolders);
  const setExpandedFolders = useAppStore((s) => s.setExpandedFolders);
  const selection = useAppStore((s) => s.selection);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const { menu, openMenu, closeMenu } = useContextMenu();

  const byFolder = useMemo(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const note of notes) {
      const list = map.get(note.folder) ?? [];
      list.push(note);
      map.set(note.folder, list);
    }
    for (const list of map.values()) list.sort((a, b) => compareNotes(a, b, sort, sortOrder));
    return map;
  }, [notes, sort, sortOrder]);

  const tree = useMemo(() => childrenOf(folders, sortOrder === 'desc'), [folders, sortOrder]);

  // Held in the store, not here: hiding the note list unmounts this component,
  // and the tree should not forget where you were because you looked at a note.
  // The selection lives there for the same reason - and because the batch
  // actions belong to the panel, not to the rows that happen to be on screen.
  const open = useMemo(() => new Set(expandedFolders), [expandedFolders]);
  // No separate "picking" flag: the toolbar is up exactly while something is
  // picked, so the selection itself is the mode.
  const selecting = selection.length > 0;

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

  /* --- one press, three gestures: click, drag, or hold to pick ------------- */

  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const detachPress = useRef<(() => void) | null>(null);
  /** Set once a press has become a drag or a picking, so its click is ignored. */
  const swallowClick = useRef(false);
  /**
   * What this press has become: nothing yet, a picking (it was held still), or
   * a drag (the pointer moved). Only one of the three happens per press.
   */
  const pressMode = useRef<'idle' | 'multi' | 'drag'>('idle');
  /** Whether this press ever opened the picking - which is what a drag undoes. */
  const openedPicking = useRef(false);
  /** The row the press started on: what a drag from nothing carries. */
  const pressedEntry = useRef<SelectionEntry | null>(null);
  /** What was picked when the press began, to put back when a drag ends. */
  const baseSelection = useRef<SelectionEntry[]>([]);
  /** What the drag carries, fixed when it starts: one row, or a whole picking. */
  const dragCargo = useRef<SelectionEntry[]>([]);
  /** The row being held, for the light "this one is picked" style. */
  const [armedRow, setArmedRow] = useState<SelectionEntry | null>(null);
  /**
   * The card that follows the pointer while something is dragged.
   *
   * Held in state because it has to appear, follow and fade out; the position is
   * a translate rather than a layout move, so following the pointer costs no
   * layout at all.
   */
  const [ghost, setGhost] = useState<{ x: number; y: number; entry: SelectionEntry; count: number } | null>(null);
  /**
   * Where releasing would drop right now: a folder path, '' for the notes root,
   * or null when releasing would move nothing.
   */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  /**
   * Whether the press a click belongs to started on blank space.
   *
   * The click's own target cannot answer that. A hold that starts picking puts
   * the batch bar up, which pushes the rows down, so a pointer that never moved
   * comes up over the container - and the click that ends the press then looks
   * like a click on nothing when it is the click on the row that started it.
   * It starts true so a synthesised click with no press of its own still reads
   * the way it always did.
   */
  const pressOnBlank = useRef(true);

  const stopPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    detachPress.current?.();
    detachPress.current = null;
    pressOrigin.current = null;
    pressMode.current = 'idle';
    openedPicking.current = false;
    dragCargo.current = [];
    dropTargetRef.current = null;
    setDropTarget(null);
    setArmedRow(null);
    setGhost(null);
  }, []);

  /** Whether the press has changed what is picked. */
  const selectionChanged = () => {
    const base = baseSelection.current;
    const now = useAppStore.getState().selection;
    return now.length !== base.length || now.some((item) => !base.some((was) => sameEntry(was, item)));
  };

  /** Puts the picking back the way the press found it. */
  const restorePressSelection = () => {
    if (!selectionChanged()) return;
    useAppStore.getState().setSelection(baseSelection.current);
  };

  /**
   * What a release moves and how, as of the latest render.
   *
   * Held in a ref because the release arrives on a window listener that is
   * bound once per press: that listener would otherwise still be holding the
   * props of the render the press began in.
   */
  const commitDrop = useRef<(cargo: SelectionEntry[], folder: string) => void | Promise<void>>(() => undefined);
  useEffect(() => {
    commitDrop.current = (cargo, folder) => {
      if (cargo.length === 0) return undefined;
      // One row travels through the single call, a picking through the batch one.
      if (cargo.length > 1) return actions.onQuickMoveSelection(folder);
      return actions.onQuickMove(cargo[0].id, folder);
    };
  });

  /**
   * A press that is over.
   *
   * A tap leaves nothing here to do: the click that follows is a click, and it
   * opens or expands as it always has. A hold that opened the picking keeps it.
   * A drag moves what it was carrying, or - released where nothing can be
   * dropped - simply puts the picking back the way the press found it.
   *
   * Either of the last two swallows the click it leaves behind, wherever that
   * click lands: what is under the pointer moves while the press is down, so it
   * can land on the container rather than on the row. A move that lands also
   * empties the picking: what it moved is not where it was a moment ago.
   */
  const endPress = useCallback(() => {
    const mode = pressMode.current;
    const target = dropTargetRef.current;
    const cargo = dragCargo.current;
    const pickedAlongTheWay = openedPicking.current;
    stopPress();
    if (mode === 'idle') return;
    swallowClick.current = true;
    if (mode === 'multi') return;
    // A drag that never opened the picking leaves the selection as it found it.
    // This has to happen before the move, not after: the batch move reads what is
    // picked to know what to carry.
    if (!pickedAlongTheWay) restorePressSelection();
    if (target === null || cargo.length === 0) return;
    let move: void | Promise<void>;
    try {
      move = commitDrop.current(cargo, target);
    } catch {
      // The move never started, so nothing has moved: the picking stays where
      // the press found it.
      restorePressSelection();
      return;
    }
    // Whatever travelled is somewhere else now, and with it the path a folder
    // answers to and the id a file is addressed by. Nothing stays picked - a
    // selection left behind would point at where those rows used to be - unless
    // the move turns out to have failed, and then the picking goes back instead.
    const forget = () => useAppStore.getState().setSelection([]);
    if (move && typeof (move as Promise<void>).then === 'function') {
      void (move as Promise<void>).then(forget, () => restorePressSelection());
      return;
    }
    forget();
  }, [stopPress]);

  // A press still in flight when the tree goes away must not select or move.
  useEffect(() => stopPress, [stopPress]);

  /**
   * The element under a point, when the environment can say.
   *
   * jsdom has no elementFromPoint at all, and a drag that cannot say what it is
   * over lands nowhere rather than throwing.
   */
  const elementAt = (x: number, y: number): Element | null =>
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;

  /**
   * Whether a folder can take what the drag is carrying.
   *
   * A folder is never part of the load when it is the destination: it is where
   * the rest is going, and a folder cannot be moved inside itself or inside
   * anything below it. When nothing is left once those are taken out - or when
   * everything left is already in that folder - releasing would move nothing,
   * so there is no target to offer.
   */
  const canDrop = (folder: string): boolean => {
    const cargo = dragCargo.current.filter(
      (item) => !(item.kind === 'folder' && (item.id === folder || folder.startsWith(`${item.id}/`))),
    );
    if (cargo.length === 0) return false;
    return cargo.some((item) => {
      if (item.kind === 'folder') return parentPath(item.id) !== folder;
      const note = notes.find((entry) => entry.id === item.id);
      // A note the filter has hidden: assume it lives somewhere else.
      return note ? note.folder.replace(/^\/+|\/+$/g, '') !== folder : true;
    });
  };

  /**
   * Where a drag would land, read from the point the pointer is at.
   *
   * A folder row is a destination; below the last row the tree itself is one,
   * and that means the notes root. Anything else - a note, anywhere outside
   * the tree - is nowhere to drop.
   */
  const dropTargetAt = (x: number, y: number): string | null => {
    const under = elementAt(x, y);
    if (!under) return null;
    const row = under.closest('[data-tree-row]');
    if (!row) {
      if (!under.closest('[data-note-tree]')) return null;
      return canDrop('') ? '' : null;
    }
    const entry = entryOfRowKey(row.getAttribute('data-tree-row'));
    if (entry?.kind !== 'folder') return null;
    return canDrop(entry.id) ? entry.id : null;
  };

  /** Points the tree at wherever the pointer is, and says what it would take. */
  const aimAt = (x: number, y: number) => {
    const target = dropTargetAt(x, y);
    if (target === dropTargetRef.current) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  };

  /**
   * Movement past the slop is a drag, and it starts now: there is no wait to sit
   * through first. What it carries is decided once, here - a row held on its own
   * travels by itself, a row already part of a bigger picking takes that picking
   * with it, and a picking opened by this same press travels as what it is.
   */
  const startDrag = (x: number, y: number) => {
    const pressed = pressedEntry.current;
    if (!pressed || pressMode.current === 'drag') return;
    const fromPicking = pressMode.current === 'multi';
    pressMode.current = 'drag';
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    const base = baseSelection.current;
    dragCargo.current = fromPicking
      ? [...useAppStore.getState().selection]
      : base.length > 1 && base.some((item) => sameEntry(item, pressed))
        ? base
        : [pressed];
    // The card is up from the first pixel of the drag, over the row it carries.
    setArmedRow(null);
    setGhost({ x, y, entry: pressed, count: dragCargo.current.length });
    aimAt(x, y);
  };

  const beginPress = (event: React.PointerEvent, entry: SelectionEntry) => {
    // Only a left press can become a drag or a picking; the right button is the
    // menu's. (The check tolerates synthesised events that carry no button.)
    if (typeof event.button === 'number' && event.button !== 0) return;
    stopPress();
    // A press always comes before the click it produces, so anything still
    // marked for swallowing was released somewhere the click never arrived.
    swallowClick.current = false;
    pressOrigin.current = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
    pressedEntry.current = entry;
    baseSelection.current = useAppStore.getState().selection;

    const onMove = (move: PointerEvent) => {
      const from = pressOrigin.current;
      if (!from) return;
      const x = move.clientX ?? 0;
      const y = move.clientY ?? 0;
      if (pressMode.current === 'drag') {
        // The card follows the pointer, and the tree keeps saying where the
        // drop would land. Nothing here touches the selection.
        move.preventDefault();
        setGhost((current) => (current ? { ...current, x, y } : current));
        aimAt(x, y);
        return;
      }
      // Any real movement is the move gesture: it begins here, not after a wait.
      // A press that has barely moved is not a drag yet - it is still a click.
      if (Math.hypot(x - from.x, y - from.y) > SLOP) {
        move.preventDefault();
        startDrag(x, y);
      }
    };

    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      // Held still long enough: this is the picking, and the row it started on
      // is in it. The click that ends the press is not a click the user made.
      pressMode.current = 'multi';
      openedPicking.current = true;
      setArmedRow(entry);
      swallowClick.current = true;
      const current = useAppStore.getState().selection;
      if (!current.some((picked) => sameEntry(picked, entry))) toggleSelection(entry);
    }, HOLD_SELECT_MS);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endPress);
    // A cancelled pointer is not a release: it drops nothing.
    window.addEventListener('pointercancel', stopPress);
    detachPress.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endPress);
      window.removeEventListener('pointercancel', stopPress);
    };
  };

  /** The click that ends a long press is not a click the user made. */
  const swallowNextClick = (event: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  /* --- what a click means -------------------------------------------------- */

  /**
   * What a click means. Picking rows replaces clicking them: no opening, no
   * unfolding. Ctrl (or ⌘) is the shortcut that skips the hold - it toggles the
   * row there and then, and still neither opens nor unfolds anything.
   */
  const activate = (entry: SelectionEntry, open: () => void, event?: React.MouseEvent) => {
    if (event && (event.ctrlKey || event.metaKey)) {
      toggleSelection(entry);
      return;
    }
    if (selecting) toggleSelection(entry);
    else open();
  };

  /**
   * Remembers where the press that a click belongs to started, before the click
   * can be misread - see pressOnBlank.
   */
  const onTreePointerDownCapture = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement | null;
    pressOnBlank.current = !target?.closest('[data-tree-row]');
  };

  /** A press that started on the empty space around the rows ends the picking. */
  const onBackgroundClick = (event: React.MouseEvent) => {
    if (!selecting || !pressOnBlank.current) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-tree-row]')) return;
    clearSelection();
  };

  /**
   * The click a press leaves behind is not a click the user made, wherever it
   * lands. The rows move when the batch bar appears, so that click can land on
   * the container rather than on the row - and a click on the container is
   * normally how picking is left behind.
   */
  const onTreeClick = (event: React.MouseEvent) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onBackgroundClick(event);
  };

  useEffect(() => {
    if (!selecting) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape belongs to an open menu first; closing it should not also throw
      // the selection away.
      if (menu || document.querySelector('[data-context-menu]')) return;
      // Nor is Escape aimed at the tree while a prompt has the keyboard: it
      // closes that prompt, and cancelling a batch move must not lose the rows
      // it was going to move.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, menu, clearSelection]);

  /* --- the right-click menus ----------------------------------------------- */

  const openMenuAt = (event: React.MouseEvent, title: string, items: ContextMenuItem[]) => {
    openMenu(
      {
        clientX: event.clientX ?? 0,
        clientY: event.clientY ?? 0,
        preventDefault: () => event.preventDefault(),
      },
      items,
      title,
    );
  };

  /**
   * The menu for the space around the rows. Every other verb hangs off a row,
   * but a tree with nothing in it has no row to hang "new folder" off, so the
   * one verb that makes sense on blank space lives here.
   */
  const blankMenu = (): ContextMenuItem[] => [
    {
      id: 'tree-new-root-folder',
      label: '新建顶层文件夹',
      icon: <FolderPlus className="h-3.5 w-3.5" />,
      disabled: !canWrite,
      run: () => actions.onCreateChild(''),
    },
  ];

  /** A right-click belongs to the row under it; only blank space is the tree's. */
  const onTreeContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-tree-row]')) return;
    openMenuAt(event, '目录树', blankMenu());
  };

  /** What can be done to everything picked out, in one block. */
  const batchItems = (): ContextMenuItem[] => [
    {
      id: 'selection-download',
      label: `下载 ${selection.length} 项`,
      icon: <Download className="h-3.5 w-3.5" />,
      run: actions.onDownloadSelection,
    },
    {
      id: 'selection-move',
      label: `移动 ${selection.length} 项`,
      icon: <FolderInput className="h-3.5 w-3.5" />,
      disabled: !canWrite,
      run: actions.onMoveSelection,
    },
    {
      id: 'selection-delete',
      label: `删除 ${selection.length} 项`,
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      disabled: !canWrite,
      run: actions.onDeleteSelection,
    },
    {
      id: 'selection-clear',
      label: '取消选择',
      icon: <X className="h-3.5 w-3.5" />,
      shortcut: 'Esc',
      separatorBefore: true,
      run: clearSelection,
    },
  ];

  /**
   * The batch block goes on top when the row that was right-clicked is one of
   * the picked rows; the row's own verbs stay below it, so a right-click never
   * hides what that row alone can do.
   */
  const withBatch = (single: ContextMenuItem[], batched: boolean): ContextMenuItem[] =>
    batched
      ? [...batchItems(), ...single.map((item, index) => (index === 0 ? { ...item, separatorBefore: true } : item))]
      : single;

  /**
   * A row's own verbs.
   *
   * A note and any other file share the outer ones - a file also lives in a
   * folder and is renamed the same way. Pinning and favouriting are note-only:
   * the server keeps no such fields for a picture. A file gets a download
   * instead, because its own bytes are the point of it.
   */
  const noteMenu = (note: NoteSummary, batched: boolean): ContextMenuItem[] => {
    const isNote = note.kind === 'note';
    const KindIcon = kindIcon(note.kind);
    const items: ContextMenuItem[] = [
      {
        id: 'note-open',
        label: '打开',
        // For a picture or any other file this is the same selection a click
        // makes: the editor shows what it is rather than editing it as text.
        icon: <KindIcon className="h-3.5 w-3.5" />,
        run: () => actions.onSelectNote(note.id),
      },
      {
        id: 'note-rename',
        label: '重命名',
        icon: <Pencil className="h-3.5 w-3.5" />,
        disabled: !canWrite,
        run: () => actions.onRenameNote(note.id),
      },
      {
        id: 'note-move',
        label: '移动到文件夹',
        icon: <FolderInput className="h-3.5 w-3.5" />,
        disabled: !canWrite,
        run: () => actions.onMoveNote(note.id),
      },
    ];
    if (isNote) {
      items.push(
        {
          id: 'note-publish',
          label: '发布管理',
          icon: <Send className="h-3.5 w-3.5" />,
          disabled: !canWrite,
          run: () => actions.onPublish(note.id),
        },
        {
          id: 'note-pin',
          label: note.pinned ? '取消置顶' : '置顶',
          icon: <Pin className="h-3.5 w-3.5" />,
          separatorBefore: true,
          disabled: !canWrite,
          run: () => actions.onTogglePin(note.id),
        },
        {
          id: 'note-favorite',
          label: note.favorite ? '取消收藏' : '收藏',
          icon: <Star className="h-3.5 w-3.5" />,
          disabled: !canWrite,
          run: () => actions.onToggleFavorite(note.id),
        },
      );
    } else {
      items.push({
        id: 'note-download',
        label: '下载',
        icon: <Download className="h-3.5 w-3.5" />,
        // Navigating to the download URL lets the browser save the bytes under
        // whatever name the server sends, exactly as the batch download does.
        run: () => {
          window.location.href = noteDownloadUrl(note.id);
        },
      });
    }
    items.push({
      id: 'note-delete',
      label: '删除（移入回收站）',
      icon: <Trash2 className="h-3.5 w-3.5" />,
      danger: true,
      separatorBefore: true,
      disabled: !canWrite,
      run: () => actions.onDeleteNote(note.id),
    });
    return withBatch(items, batched);
  };

  const folderMenu = (path: string, batched: boolean): ContextMenuItem[] => {
    // Folders only exist inside folders, so making one at the top level is only
    // offered where it makes sense: a folder that is already at the top level.
    const topLevel = !path.includes('/');
    return withBatch(
      [
        {
          id: 'folder-new-child',
          label: '新建子文件夹',
          icon: <FolderPlus className="h-3.5 w-3.5" />,
          disabled: !canWrite,
          run: () => actions.onCreateChild(path),
        },
        ...(topLevel
          ? [
              {
                id: 'folder-new-root',
                label: '新建顶层文件夹',
                icon: <FolderPlus className="h-3.5 w-3.5" />,
                disabled: !canWrite,
                run: () => actions.onCreateChild(''),
              },
            ]
          : []),
        {
          id: 'folder-rename',
          label: '重命名文件夹',
          icon: <Pencil className="h-3.5 w-3.5" />,
          separatorBefore: true,
          disabled: !canWrite,
          run: () => actions.onRenameFolder(path),
        },
        {
          id: 'folder-move',
          label: '移动到文件夹',
          icon: <FolderInput className="h-3.5 w-3.5" />,
          disabled: !canWrite,
          run: () => actions.onMoveFolder(path),
        },
        {
          id: 'folder-delete',
          label: '删除文件夹（移入回收站，可恢复）',
          icon: <Trash2 className="h-3.5 w-3.5" />,
          danger: true,
          separatorBefore: true,
          disabled: !canWrite,
          run: () => actions.onDeleteFolder(path),
        },
      ],
      batched,
    );
  };

  /* --- rows ---------------------------------------------------------------- */

  const renderFolders = (parent: string, depth: number) => {
    const list = tree.get(parent) ?? [];
    return list.map((folder) => {
      const kids = tree.get(folder.path) ?? [];
      const own = byFolder.get(folder.path) ?? [];
      const expanded = open.has(folder.path);
      const active = activeFolder === folder.path.replace(/^\//, '');
      const entry: SelectionEntry = { kind: 'folder', id: folder.path };
      const picked = selection.some((pickedEntry) => sameEntry(pickedEntry, entry));
      return (
        <div key={folder.path}>
          <Row
            rowKey={`folder:${folder.path}`}
            depth={depth}
            active={active}
            selected={picked}
            dropTarget={dropTarget !== null && dropTarget !== '' && dropTarget === folder.path}
            armed={armedRow !== null && sameEntry(armedRow, entry)}
            // Opens and closes. Selecting the folder is not this row's job:
            // filtering the list to one of its own branches is what the tree
            // exists to avoid - unless rows are being picked, and then the
            // click picks this row instead of unfolding it.
            onActivate={(event) => activate(entry, () => toggle(folder.path), event)}
            onContextMenu={(event) =>
              openMenuAt(event, folder.path, folderMenu(folder.path, picked))
            }
            onPointerDown={(event) => beginPress(event, entry)}
            onPointerUp={endPress}
            onClickCapture={swallowNextClick}
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

  const renderNote = (note: NoteSummary, depth: number) => {
    const entry: SelectionEntry = { kind: 'note', id: note.id };
    const picked = selection.some((pickedEntry) => sameEntry(pickedEntry, entry));
    const isNote = note.kind === 'note';
    const RowIcon = kindIcon(note.kind);
    // A note is named by its title; a file by its name, which is what the
    // server sends as one - the basename is the fallback for a blank name.
    const label = note.title || (isNote ? '未命名笔记' : note.path.split('/').pop() || '未命名笔记');
    return (
      <Row
        key={note.id}
        rowKey={`note:${note.id}`}
        depth={depth}
        active={note.id === activeId}
        selected={picked}
        armed={armedRow !== null && sameEntry(armedRow, entry)}
        onActivate={(event) => activate(entry, () => actions.onSelectNote(note.id), event)}
        onContextMenu={(event) => openMenuAt(event, label, noteMenu(note, picked))}
        onPointerDown={(event) => beginPress(event, entry)}
        onPointerUp={endPress}
        onClickCapture={swallowNextClick}
        leading={<span className="w-5 shrink-0" />}
        icon={<RowIcon className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />}
        label={label}
        // A note's row carries when it last changed; a picture or any other
        // file carries how big it is, which is the one thing its bytes say.
        sub={isNote ? relativeTime(Date.parse(note.updated)) : formatBytes(note.size)}
        marked={
          isNote ? (
            <>
              {note.pinned ? <Pin className="h-3 w-3 shrink-0 text-[var(--accent)]" /> : null}
              {note.favorite ? <Star className="h-3 w-3 shrink-0 text-[var(--warn)]" /> : null}
            </>
          ) : null
        }
      />
    );
  };

  const rootNotes = byFolder.get('') ?? [];
  const roots = tree.get('') ?? [];
  /** What a drag would do, in words; null while it would do nothing. */
  const dropLabel =
    dropTarget === null ? null : dropTarget === '' ? '松开移动到 根目录' : `松开移动到 ${dropTarget.split('/').pop()}`;
  // What the card under the pointer says: the row it carries, or how many rows
  // when it is carrying a whole picking.
  const ghostNote = ghost && ghost.entry.kind === 'note' ? notes.find((note) => note.id === ghost.entry.id) : undefined;
  const GhostIcon = ghost?.entry.kind === 'folder' ? Folder : kindIcon(ghostNote?.kind);
  const ghostName = ghost
    ? ghost.entry.kind === 'folder'
      ? ghost.entry.id.split('/').pop() || ghost.entry.id
      : ghostNote?.title || ghost.entry.id
    : '';

  return (
    <div
      data-note-tree
      // The tree fills the whole scroll area rather than only being as tall as
      // its rows: the space below the last row is still the tree, so a
      // right-click down there opens the tree's own menu instead of the
      // browser's, and a drag released there drops into the notes root. Without
      // min-h-full that space belongs to the panel's scroll container, which
      // has none of these handlers.
      className="min-h-full space-y-0.5 px-2"
      onClick={onTreeClick}
      onPointerDownCapture={onTreePointerDownCapture}
      onContextMenu={onTreeContextMenu}
    >
      {/* The card that follows the pointer while something is dragged. It is a
          portal because the panel clips its own overflow: a card inside the tree
          would be cut off the moment the pointer left the panel. It takes no
          pointer events, so the row beneath it is still what the drop is aimed
          at, and it moves by translate, so following the pointer costs no
          layout. */}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <AnimatePresence>
              {ghost ? (
                <motion.div
                  key="drag-ghost"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="pointer-events-none fixed inset-0 z-[120]"
                >
                  <div
                    data-drag-ghost
                    className="glass absolute left-0 top-0 flex max-w-[220px] items-center gap-1.5 rounded-xl border border-[var(--line)] px-2 py-1 text-[11.5px] text-[var(--text)] shadow-strong transition-transform duration-75 ease-out"
                    style={{ transform: `translate3d(${ghost.x + 14}px, ${ghost.y + 12}px, 0)` }}
                  >
                    {ghost.count > 1 ? (
                      <>
                        <GhostIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                        <span className="shrink-0 font-medium">{`${ghost.count} 项`}</span>
                      </>
                    ) : (
                      <>
                        <GhostIcon className="h-3.5 w-3.5 shrink-0 text-[var(--faint)]" />
                        <span className="truncate">{ghostName}</span>
                      </>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )}
      {/* Where a drag would put what it is carrying. Over the rows rather than
          in the flow: a bar that appeared mid-drag would push the rows down
          under the pointer, and the row being aimed at would move out from
          under it. The wrapper holds no height, so nothing moves at all. */}
      {dropLabel ? (
        <div className="pointer-events-none sticky top-0 z-20 h-0">
          <div
            data-drop-hint={dropTarget === '' ? 'root' : dropTarget}
            className="mt-0.5 w-fit rounded-xl bg-[var(--panel-solid)] px-2 py-1 text-[10.5px] font-medium text-[var(--accent)] shadow-soft ring-1 ring-[var(--accent)]"
          >
            {dropLabel}
          </div>
        </div>
      ) : null}
      {/* The batch verbs live in the right-click menu: a bar across the top of
          the list repeated them and pushed the first row out of the way. */}
      {renderFolders('', 0)}
      {rootNotes.map((note) => renderNote(note, 0))}
      {roots.length === 0 && rootNotes.length === 0 ? (
        <p className="px-3 py-6 text-center text-[12px] text-[var(--faint)]">这里还没有笔记。</p>
      ) : null}
      <ContextMenu state={menu} onClose={closeMenu} />
    </div>
  );
}

function Row({
  depth,
  active,
  selected,
  dropTarget,
  armed,
  rowKey,
  onActivate,
  onContextMenu,
  onPointerDown,
  onPointerUp,
  onClickCapture,
  leading,
  icon,
  label,
  sub,
  count,
  marked,
}: {
  depth: number;
  active: boolean;
  selected: boolean;
  /** Whether a drag is aimed at this row right now. */
  dropTarget?: boolean;
  /** Whether this row is the one being held down. */
  armed?: boolean;
  /** What this row is, for tests and for the tree to find its own rows. */
  rowKey: string;
  onActivate: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: () => void;
  onClickCapture: (event: React.MouseEvent) => void;
  leading: React.ReactNode;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  count?: number;
  marked?: React.ReactNode;
}) {
  return (
    <div
      data-tree-row={rowKey}
      data-selected={selected || undefined}
      data-drop-target={dropTarget || undefined}
      data-armed={armed || undefined}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      className={cn(
        'group/row relative flex items-center gap-1.5 rounded-xl py-1.5 pr-1.5 text-[12.5px] transition-colors',
        // A row a drag is aimed at says so louder than a picked one: it is the
        // answer to "where will this land", not one more of the rows in hand.
        dropTarget
          ? 'bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--text)] ring-2 ring-[var(--accent)]'
          : selected
            ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text)] ring-1 ring-[var(--accent)]'
            : armed
              ? 'bg-[color-mix(in_srgb,var(--text)_7%,transparent)] text-[var(--text)] ring-1 ring-[var(--line-strong)]'
              : active
                ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                : 'text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]',
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      <button
        type="button"
        onClick={onActivate}
        className="focus-ring absolute inset-0 rounded-xl"
        aria-label={label}
        aria-current={active || undefined}
      />
      {/* No right-hand gutter and no toolbar: a title is shown whole, and what a
          row can do is on its right-click menu instead of under the pointer. */}
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-1.5">
        {leading}
        {icon}
        <span className={cn('truncate', (active || selected) && 'font-medium')}>{label}</span>
        {marked}
        {sub ? <span className="shrink-0 text-[10px] text-[var(--faint)]">{sub}</span> : null}
        {typeof count === 'number' && count > 0 ? (
          <span className="shrink-0 rounded-md bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">
            {count}
          </span>
        ) : null}
        {selected ? <Check className="ml-auto h-3 w-3 shrink-0 text-[var(--accent)]" /> : null}
      </span>
    </div>
  );
}
