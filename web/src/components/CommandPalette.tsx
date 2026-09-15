import { AnimatePresence, motion } from 'framer-motion';
import {
  Columns2,
  Eye,
  FileText,
  ListTree,
  LayoutGrid,
  List as ListIcon,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/format';
import { useAppStore, useCanWrite } from '../store/useAppStore';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: typeof Search;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const notes = useAppStore((s) => s.notes);
  const selectNote = useAppStore((s) => s.selectNote);
  const createNote = useAppStore((s) => s.createNote);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setView = useAppStore((s) => s.setView);
  const setEditorMode = useAppStore((s) => s.setEditorMode);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);
  const user = useAppStore((s) => s.user);
  const canWrite = useCanWrite();
  const toggleMeta = useAppStore((s) => s.toggleMeta);
  const metaOpen = useAppStore((s) => s.metaOpen);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      ...(canWrite
        ? [
            {
              id: 'new',
              label: '新建笔记',
              group: '操作',
              icon: Plus,
              run: () => void createNote(),
            },
          ]
        : []),
      {
        id: 'outline',
        label: metaOpen ? '隐藏大纲' : '显示大纲',
        group: '操作',
        icon: ListTree,
        run: () => toggleMeta(),
      },
      {
        id: 'theme',
        label: theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题',
        group: '操作',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'view',
        label: '切换列表 / 网格视图',
        group: '操作',
        icon: LayoutGrid,
        run: () => setView(useAppStore.getState().view === 'list' ? 'grid' : 'list'),
      },
      {
        id: 'edit',
        label: '编辑模式',
        group: '编辑器',
        icon: Pencil,
        run: () => setEditorMode('edit'),
      },
      {
        id: 'split',
        label: '分栏模式',
        group: '编辑器',
        icon: Columns2,
        run: () => setEditorMode('split'),
      },
      {
        id: 'preview',
        label: '预览模式',
        group: '编辑器',
        icon: Eye,
        run: () => setEditorMode('preview'),
      },
      {
        id: 'trash',
        label: '打开回收站',
        group: '导航',
        icon: Trash2,
        run: () => setTrashOpen(true),
      },
    ];
    if (user?.role === 'admin') {
      actions.push({ id: 'settings', label: '存储与服务器设置', group: '导航', icon: Settings, run: () => setSettingsOpen(true) });
    }
    return actions;
  }, [
    canWrite,
    createNote,
    metaOpen,
    setEditorMode,
    setSettingsOpen,
    setTheme,
    setTrashOpen,
    setView,
    theme,
    toggleMeta,
    user?.role,
  ]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedCommands = commands.filter((c) => !q || c.label.toLowerCase().includes(q) || c.group.includes(q));
    const matchedNotes = notes
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)))
      .slice(0, q ? 8 : 5)
      .map<Command>((note) => ({
        id: `note:${note.id}`,
        label: note.title || '未命名笔记',
        hint: relativeTime(note.updated),
        group: '笔记',
        icon: FileText,
        run: () => void selectNote(note.id),
      }));
    return [...matchedCommands, ...matchedNotes];
  }, [commands, notes, query, selectNote]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)));
  }, [results.length]);

  const runAt = (index: number) => {
    const command = results[index];
    if (!command) return;
    setOpen(false);
    void command.run();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((c) => (results.length ? (c + 1) % results.length : 0));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        runAt(cursor);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, cursor]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgba(4,7,16,0.5)] backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel-solid)] shadow-strong"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4">
              <Search className="h-4 w-4 shrink-0 text-[var(--faint)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                placeholder="搜索笔记或输入命令…"
                className="h-12 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
              />
              <kbd className="rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--faint)]">ESC</kbd>
            </div>

            <div ref={listRef} className="scroll-area max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-[var(--faint)]">没有找到匹配项</p>
              ) : null}
              {results.map((item, index) => {
                const Icon = item.icon;
                const showGroup = item.group !== lastGroup;
                lastGroup = item.group;
                return (
                  <div key={item.id}>
                    {showGroup ? (
                      <div className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">
                        {item.group}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => runAt(index)}
                      className={cn(
                        'focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                        index === cursor ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate text-[13px]">{item.label}</span>
                      {item.hint ? <span className="shrink-0 text-[11px] text-[var(--faint)]">{item.hint}</span> : null}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2 text-[10.5px] text-[var(--faint)]">
              <span className="inline-flex items-center gap-1">
                <ListIcon className="h-3 w-3" /> ↑↓ 选择
              </span>
              <span>↵ 执行</span>
              <span className="ml-auto">Ctrl/⌘ + K</span>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
