import { AnimatePresence, motion } from 'framer-motion';
import {
  Bold,
  Code2,
  Columns2,
  Eye,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Pencil,
  Quote,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { formatDateTime, relativeTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Badge, Button, Tooltip } from './ui/primitives';
import { CodeEditor, type EditorApi } from './CodeEditor';
import { Preview } from './Preview';
import { NoteMetaBar } from './NoteMetaBar';

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
  const closeNote = useAppStore((s) => s.closeNote);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const saving = useAppStore((s) => s.saving);
  const dirty = useAppStore((s) => s.dirty);
  const lastSavedAt = useAppStore((s) => s.lastSavedAt);
  const theme = useAppStore((s) => s.theme);
  const [focusMode, setFocusMode] = useState(false);

  const apiRef = useRef<EditorApi | null>(null);

  const wordCount = useMemo(() => {
    const text = activeNote?.content ?? '';
    const cjk = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
    const latin = text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
    return cjk + latin;
  }, [activeNote?.content]);

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

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {/* Header ------------------------------------------------------- */}
      <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <input
            value={activeNote.title}
            onChange={(e) => patchActive({ title: e.target.value })}
            onBlur={() => void saveActive(true)}
            placeholder="笔记标题"
            className="focus-ring w-full truncate rounded-lg bg-transparent text-[19px] font-semibold tracking-tight text-[var(--text)] outline-none placeholder:text-[var(--faint)]"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--faint)]">
            <span>更新于 {relativeTime(activeNote.updated)}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{wordCount} 字</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden truncate md:inline" title={activeNote.path}>
              {activeNote.path}
            </span>
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
                    saving
                      ? 'animate-pulse bg-[var(--warn)]'
                      : dirty
                        ? 'bg-[var(--warn)]'
                        : 'bg-[var(--success)]',
                  )}
                />
                {saving ? '保存中…' : dirty ? '未保存' : lastSavedAt ? `已保存 ${relativeTime(new Date(lastSavedAt))}` : '已同步'}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="hidden items-center gap-1 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-1 md:flex">
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
                      layoutId="editor-mode"
                      className="absolute inset-0 rounded-lg border border-[var(--line)] bg-[var(--elevated)] shadow-soft"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <Icon className="relative h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <Tooltip label={focusMode ? '退出专注模式' : '专注模式'}>
            <Button variant="ghost" size="icon" onClick={() => setFocusMode((v) => !v)}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label="删除笔记">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void deleteNote(activeNote.id)}
              className="text-[var(--faint)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip label="关闭">
            <Button variant="ghost" size="icon" onClick={closeNote} className="lg:hidden">
              <X className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <NoteMetaBar />

      {/* Toolbar ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--line)] px-4 py-2 sm:px-6">
        {TOOLBAR_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0.5">
            {group.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  title={item.label}
                  onClick={() => {
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
                  className="focus-ring flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-[var(--accent)] active:scale-90"
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
            {groupIndex < TOOLBAR_GROUPS.length - 1 ? <span className="mx-1 h-5 w-px bg-[var(--line)]" /> : null}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral" className="hidden sm:inline-flex">
            {activeNote.folder ? `/${activeNote.folder}` : '根目录'}
          </Badge>
          <span className="hidden text-[11px] text-[var(--faint)] lg:inline">
            创建于 {formatDateTime(activeNote.created)}
          </span>
        </div>
      </div>

      {/* Content ------------------------------------------------------ */}
      <div className="relative flex min-h-0 flex-1">
        <AnimatePresence initial={false} mode="popLayout">
          {editorMode !== 'preview' ? (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className={cn('min-w-0 flex-1', editorMode === 'split' && 'border-r border-[var(--line)]')}
            >
              <CodeEditor
                value={activeNote.content}
                onChange={(value) => patchActive({ content: value })}
                onSave={() => void saveActive(true)}
                dark={theme === 'dark'}
                apiRef={apiRef}
                placeholderText="开始书写…  支持 Markdown 语法"
              />
            </motion.div>
          ) : null}
          {editorMode !== 'edit' ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="min-w-0 flex-1"
            >
              <Preview content={activeNote.content} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
