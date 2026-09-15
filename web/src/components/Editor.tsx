import { AnimatePresence, motion } from 'framer-motion';
import {
  Bold,
  Code2,
  Columns2,
  Download,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  Maximize2,
  Minimize2,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Quote,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { noteDownloadUrl } from '../lib/api';
import { cn } from '../lib/cn';
import { formatDateTime, relativeTime } from '../lib/format';
import { slugifyHeading } from '../lib/markdown';
import { extractHeadings, type Heading } from '../lib/outline';
import { replaceAnchor } from '../lib/url';
import { useAppStore, useCanWrite, useReadOnlyReason } from '../store/useAppStore';
import { Badge, Button, Tooltip } from './ui/primitives';
import { CodeEditor, type EditorApi } from './CodeEditor';
import { Preview, type PreviewApi } from './Preview';
import { NoteMetaBar } from './NoteMetaBar';
import { OutlinePanel } from './OutlinePanel';

const TOOLBAR_GROUPS: { icon: typeof Bold; label: string; run: (api: EditorApi) => void }[][] = [
  [
    { icon: Bold, label: '加粗 (Ctrl+B)', run: (api) => api.wrap('**', '**', '粗体') },
    { icon: Italic, label: '斜体 (Ctrl+I)', run: (api) => api.wrap('*', '*', '斜体') },
    { icon: Strikethrough, label: '删除线', run: (api) => api.wrap('~~', '~~', '删除线') },
    { icon: Code2, label: '行内代码', run: (api) => api.wrap('`', '`', 'code') },
  ],
  [
    { icon: Heading1, label: '一级标题', run: (api) => api.linePrefix('# ') },
    { icon: Heading2, label: '二级标题', run: (api) => api.linePrefix('## ') },
    { icon: Quote, label: '引用', run: (api) => api.linePrefix('> ') },
  ],
  [
    { icon: List, label: '无序列表', run: (api) => api.linePrefix('- ') },
    { icon: ListOrdered, label: '有序列表', run: (api) => api.linePrefix('1. ') },
    { icon: Link2, label: '链接', run: (api) => api.wrap('[', '](https://)', '链接文字') },
  ],
];

export function Editor() {
  const activeNote = useAppStore((s) => s.activeNote);
  const loadingNote = useAppStore((s) => s.loadingNote);
  const editorMode = useAppStore((s) => s.editorMode);
  const setEditorMode = useAppStore((s) => s.setEditorMode);
  const patchActive = useAppStore((s) => s.patchActive);
  const saveActive = useAppStore((s) => s.saveActive);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const saving = useAppStore((s) => s.saving);
  const dirty = useAppStore((s) => s.dirty);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const theme = useAppStore((s) => s.theme);
  const metaOpen = useAppStore((s) => s.metaOpen);
  const toggleMeta = useAppStore((s) => s.toggleMeta);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const openInternalLink = useAppStore((s) => s.openInternalLink);
  const pendingAnchor = useAppStore((s) => s.pendingAnchor);
  const setPendingAnchor = useAppStore((s) => s.setPendingAnchor);
  const splitRatio = useAppStore((s) => s.splitRatio);
  const setSplitRatio = useAppStore((s) => s.setSplitRatio);
  const focusMode = useAppStore((s) => s.focusMode);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const canWrite = useCanWrite();
  const readOnlyReason = useReadOnlyReason();

  const apiRef = useRef<EditorApi | null>(null);
  const previewApiRef = useRef<PreviewApi | null>(null);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const wordCount = useMemo(() => {
    const text = activeNote?.content ?? '';
    const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
    const latin = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
    return cjk + latin;
  }, [activeNote?.content]);

  /** Drag the divider between the editor and the preview. */
  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = panesRef.current;
      if (!container) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      setDragging(true);
      const onMove = (moveEvent: PointerEvent) => {
        if (rect.width <= 0) return;
        setSplitRatio((moveEvent.clientX - rect.left) / rect.width);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setSplitRatio],
  );

  /**
   * The single way to move inside the open note.
   *
   * Every entry point - the outline, a `[text](#anchor)` link, a deep link -
   * goes through here, so the address bar, the editor and the preview always
   * agree. They previously drifted: the outline scrolled both panes but left the
   * address bar alone, while an anchor link updated the address bar but not the
   * editor.
   */
  const goToHeading = useCallback((heading: Heading, index: number) => {
    replaceAnchor(slugifyHeading(heading.text));
    apiRef.current?.revealLine(heading.line);
    previewApiRef.current?.scrollToHeading({ index, text: heading.text, level: heading.level });
  }, []);

  /** Follows a `#anchor` link written inside a note. */
  const followAnchor = useCallback(
    (anchor: string) => {
      const content = useAppStore.getState().activeNote?.content ?? '';
      const headings = extractHeadings(content);
      const index = headings.findIndex((h) => slugifyHeading(h.text) === anchor);
      if (index >= 0) {
        goToHeading(headings[index], index);
        return;
      }
      // Not a heading: still record it and let the preview find any element.
      replaceAnchor(anchor);
      previewApiRef.current?.scrollToAnchor(anchor);
    },
    [goToHeading],
  );

  // A deep link (`.../Readme.md#11-分层`) can only be applied once the note and
  // its preview exist.
  useEffect(() => {
    if (!pendingAnchor || !activeNote) return undefined;
    const timer = window.setTimeout(() => {
      const headings = extractHeadings(activeNote.content);
      const index = headings.findIndex((h) => slugifyHeading(h.text) === pendingAnchor);
      if (index >= 0) goToHeading(headings[index], index);
      else previewApiRef.current?.scrollToAnchor(pendingAnchor);
      setPendingAnchor(null);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [pendingAnchor, activeNote, setPendingAnchor, goToHeading]);

  // While dragging, keep the pointer and suppress text selection everywhere.
  useEffect(() => {
    if (!dragging) return undefined;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.userSelect = previous;
      document.body.style.cursor = '';
    };
  }, [dragging]);

  if (!activeNote && !loadingNote) return null;

  if (loadingNote && !activeNote) {
    return (
      <div className="flex h-full flex-col gap-4 p-8">
        <div className="shimmer h-9 w-2/5 rounded-xl" />
        <div className="shimmer h-4 w-1/4 rounded-lg" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="shimmer h-4 rounded-lg" style={{ width: `${60 + ((index * 13) % 38)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!activeNote) return null;

  const modeOptions = [
    { value: 'edit' as const, label: '编辑', icon: Pencil },
    { value: 'split' as const, label: '分栏', icon: Columns2 },
    { value: 'preview' as const, label: '预览', icon: Eye },
  ];

  // The three editor modes, reused by the header and by the focus-mode bar.
  const renderModeSwitch = (compactBar = false) => (
    <div
      className={cn(
        'flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-1',
        !compactBar && 'hidden md:flex',
      )}
    >
      {modeOptions.map((option) => {
        const Icon = option.icon;
        const active = editorMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setEditorMode(option.value)}
            title={option.label}
            className={cn(
              'focus-ring relative flex h-7 w-8 items-center justify-center rounded-lg transition-colors',
              active ? 'text-[var(--text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
            )}
          >
            {active ? (
              <motion.span
                layoutId={compactBar ? 'focus-mode-switch' : 'editor-mode'}
                className="absolute inset-0 rounded-lg border border-[var(--line)] bg-[var(--elevated)] shadow-soft"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <Icon className="relative h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      {focusMode ? (
        /* Focus mode: nothing but the note, with a single mini bar on top. */
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-[var(--line)] px-3 py-2">
          {renderModeSwitch(true)}
          <span className="h-5 w-px bg-[var(--line)]" />
          <Tooltip label={metaOpen ? '隐藏大纲' : '显示大纲'}>
            <Button
              variant={metaOpen ? 'soft' : 'ghost'}
              size="icon"
              aria-label={metaOpen ? '隐藏大纲' : '显示大纲'}
              onClick={() => toggleMeta()}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label="退出专注模式">
            <Button variant="soft" size="icon" aria-label="退出专注模式" onClick={() => toggleFocusMode(false)}>
              <Minimize2 className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      ) : (
        <>
      {/* Header ------------------------------------------------------- */}
      <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <input
            value={activeNote.title}
            onChange={(e) => canWrite && patchActive({ title: e.target.value })}
            onBlur={() => void saveActive(true)}
            readOnly={!canWrite}
            placeholder="笔记标题"
            className={cn(
              'focus-ring w-full truncate rounded-lg bg-transparent text-[19px] font-semibold tracking-tight text-[var(--text)] outline-none placeholder:text-[var(--faint)]',
              !canWrite && 'cursor-default',
            )}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--faint)]">
            <span>更新于 {relativeTime(activeNote.updated)}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{wordCount} 字</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden truncate md:inline" title={activeNote.path}>
              {activeNote.path}
            </span>
            {canWrite ? (
              <AnimatePresence mode="wait">
                <motion.span
                  key={saving ? 'saving' : dirty ? 'dirty' : 'saved'}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      saving ? 'animate-pulse bg-[var(--warn)]' : dirty ? 'bg-[var(--warn)]' : 'bg-[var(--success)]',
                    )}
                  />
                  {saving ? '保存中…' : dirty ? '未保存' : lastSavedAt ? `已保存 ${relativeTime(new Date(lastSavedAt))}` : '已同步'}
                </motion.span>
              </AnimatePresence>
            ) : (
              <Badge tone="warn">
                <Lock className="h-3 w-3" />
                只读
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {renderModeSwitch()}
          {!sidebarOpen ? (
            <Tooltip label="显示笔记列表">
              <Button variant="ghost" size="icon" aria-label="显示笔记列表" onClick={() => toggleSidebar(true)}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip label={metaOpen ? '隐藏大纲' : '显示大纲'}>
            <Button
              variant={metaOpen ? 'soft' : 'ghost'}
              size="icon"
              aria-label={metaOpen ? '隐藏大纲' : '显示大纲'}
              onClick={() => toggleMeta()}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label={focusMode ? '退出专注模式' : '专注模式（隐藏列表与工具栏）'}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={focusMode ? '退出专注模式' : '进入专注模式'}
              onClick={() => toggleFocusMode()}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          {/* Straight to the file the server stores, front matter and all. */}
          <Tooltip label="下载这篇笔记（.md）">
            <Button
              variant="ghost"
              size="icon"
              aria-label="下载这篇笔记"
              onClick={() => {
                window.location.href = noteDownloadUrl(activeNote.id);
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label={canWrite ? '删除笔记' : '没有删除权限'}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={canWrite ? '删除笔记' : '没有删除权限'}
              disabled={!canWrite}
              onClick={() => void deleteNote(activeNote.id)}
              className="text-[var(--faint)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label="关闭">
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭笔记"
              onClick={() => useAppStore.getState().closeNote()}
              className="lg:hidden"
            >
              <X className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {!canWrite ? (
        <div className="flex items-center gap-2 border-b border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-4 py-1.5 text-[11.5px] text-[var(--warn)] sm:px-6">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          <span>
            只读模式：{readOnlyReason ?? '当前账号没有写入权限'}。可以浏览和复制内容，但无法修改。
          </span>
        </div>
      ) : null}

      <NoteMetaBar readOnly={!canWrite} />

      {/* Toolbar ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-4 py-2 sm:px-6">
        {TOOLBAR_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0.5">
            {group.map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.label} label={canWrite ? item.label : '没有编辑权限'} side="top">
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => {
                    if (!canWrite) return;
                    if (editorMode === 'preview') {
                      // The editor has to mount before we can format a selection.
                      setEditorMode('split');
                      window.setTimeout(() => {
                        if (apiRef.current) item.run(apiRef.current);
                      }, 60);
                      return;
                    }
                    if (apiRef.current) item.run(apiRef.current);
                  }}
                  className={cn(
                    'focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-all duration-150',
                    canWrite
                      ? 'hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-[var(--accent)] active:scale-90'
                      : 'cursor-not-allowed opacity-35',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
                </Tooltip>
              );
            })}
            {groupIndex < TOOLBAR_GROUPS.length - 1 ? <span className="mx-1 h-5 w-px bg-[var(--line)]" /> : null}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {activeNote.folder ? `/${activeNote.folder}` : '根目录'}
          </Badge>
          <span className="hidden text-[11px] text-[var(--faint)] lg:inline">创建于 {formatDateTime(activeNote.created)}</span>
        </div>
      </div>

        </>
      )}

      {/* Content ------------------------------------------------------ */}
      <div className="relative flex min-h-0 flex-1">
        <div ref={panesRef} className="flex min-w-0 flex-1">
          <AnimatePresence initial={false} mode="popLayout">
            {editorMode !== 'preview' ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="flex min-w-0 flex-col"
                style={editorMode === 'split' ? { width: `${splitRatio * 100}%` } : { flex: '1 1 0%' }}
              >
                <CodeEditor
                  value={activeNote.content}
                  onChange={(value) => canWrite && patchActive({ content: value })}
                  onSave={() => void saveActive(true)}
                  dark={theme === 'dark'}
                  apiRef={apiRef}
                  readOnly={!canWrite}
                  placeholderText="开始书写…  支持 Markdown 语法"
                />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {editorMode === 'split' ? (
            <Tooltip label="拖动调整分栏宽度，双击恢复居中" side="top">
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="调整分栏宽度"
                onPointerDown={startResize}
                onDoubleClick={() => setSplitRatio(0.5)}
                className={cn(
                  'group relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors',
                  dragging ? 'bg-[var(--accent)]' : 'hover:bg-[color-mix(in_srgb,var(--accent)_45%,transparent)]',
                )}
              >
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--line)] group-hover:bg-transparent" />
              </div>
            </Tooltip>
          ) : null}

          <AnimatePresence initial={false} mode="popLayout">
            {editorMode !== 'edit' ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="min-w-0 flex-1"
              >
                <Preview
                  content={activeNote.content}
                  apiRef={previewApiRef}
                  onOpenLink={(href) => void openInternalLink(href)}
                  onOpenAnchor={followAnchor}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {metaOpen ? (
            <motion.div
              key="outline"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 228, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="shrink-0 overflow-hidden"
            >
              <OutlinePanel onNavigate={goToHeading} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
