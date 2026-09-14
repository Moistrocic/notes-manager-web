import { AnimatePresence, motion } from 'framer-motion';
import { Check, FolderInput, Palette, Pin, Plus, Star, Tag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/primitives';

const COLORS = ['#8b6cff', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#a78bfa', '#60a5fa', '#f472b6'];

export function NoteMetaBar() {
  const activeNote = useAppStore((s) => s.activeNote);
  const folders = useAppStore((s) => s.folders);
  const patchActive = useAppStore((s) => s.patchActive);
  const saveActive = useAppStore((s) => s.saveActive);
  const setColor = useAppStore((s) => s.setColor);
  const [tagInput, setTagInput] = useState('');
  const [showColors, setShowColors] = useState(false);
  const [showFolders, setShowFolders] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setShowColors(false);
        setShowFolders(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!activeNote) return null;

  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, '');
    if (!value) return;
    if (activeNote.tags.includes(value)) {
      setTagInput('');
      return;
    }
    patchActive({ tags: [...activeNote.tags, value] });
    setTagInput('');
  };

  const removeTag = (tag: string) => patchActive({ tags: activeNote.tags.filter((t) => t !== tag) });

  return (
    <div
      ref={wrapperRef}
      className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag className="h-3.5 w-3.5 text-[var(--faint)]" />
        <AnimatePresence initial={false}>
          {activeNote.tags.map((tag) => (
            <motion.span
              key={tag}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 480, damping: 30 }}
              className="group inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--accent)]"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label={`移除标签 ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag();
            }
            if (e.key === 'Backspace' && !tagInput && activeNote.tags.length) {
              removeTag(activeNote.tags[activeNote.tags.length - 1]);
            }
          }}
          onBlur={addTag}
          placeholder="添加标签"
          className="focus-ring h-6 w-24 rounded-lg border border-transparent bg-transparent px-1.5 text-[11.5px] text-[var(--text)] outline-none transition-all placeholder:text-[var(--faint)] focus:w-32 focus:border-[var(--line)]"
        />
        <button
          type="button"
          onClick={addTag}
          className="focus-ring flex h-5 w-5 items-center justify-center rounded-md text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
          aria-label="添加标签"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant={activeNote.pinned ? 'soft' : 'ghost'}
          size="sm"
          onClick={() => patchActive({ pinned: !activeNote.pinned })}
          title="置顶"
        >
          <Pin className={cn('h-3.5 w-3.5', activeNote.pinned && 'fill-current')} />
          <span className="hidden sm:inline">置顶</span>
        </Button>
        <Button
          variant={activeNote.favorite ? 'soft' : 'ghost'}
          size="sm"
          onClick={() => patchActive({ favorite: !activeNote.favorite })}
          title="收藏"
        >
          <Star className={cn('h-3.5 w-3.5', activeNote.favorite && 'fill-current')} />
          <span className="hidden sm:inline">收藏</span>
        </Button>

        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setShowColors((v) => !v)} title="强调色">
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">颜色</span>
          </Button>
          <AnimatePresence>
            {showColors ? (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="absolute right-0 top-[calc(100%+6px)] z-30 flex gap-2 rounded-2xl border border-[var(--line)] bg-[var(--elevated)] p-2.5 shadow-strong"
              >
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => {
                      setColor(activeNote.id, color);
                      setShowColors(false);
                    }}
                    className="focus-ring h-6 w-6 rounded-full transition-transform hover:scale-115 active:scale-95"
                    style={{ background: color }}
                    aria-label={color}
                  >
                    {activeNote.color === color ? <Check className="mx-auto h-3.5 w-3.5 text-white" /> : null}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setColor(activeNote.id, null);
                    setShowColors(false);
                  }}
                  className="focus-ring h-6 w-6 rounded-full border border-[var(--line-strong)] text-[10px] text-[var(--faint)] transition-transform hover:scale-115"
                >
                  ×
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="relative">
          <Button variant="ghost" size="sm" onClick={() => setShowFolders((v) => !v)} title="移动到文件夹">
            <FolderInput className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">移动</span>
          </Button>
          <AnimatePresence>
            {showFolders ? (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="scroll-area absolute right-0 top-[calc(100%+6px)] z-30 max-h-64 w-52 overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--elevated)] p-1.5 shadow-strong"
              >
                {[{ path: '', name: '根目录', count: 0 }, ...folders].map((folder) => (
                  <button
                    key={folder.path || 'root'}
                    type="button"
                    onClick={() => {
                      patchActive({ folder: folder.path });
                      setShowFolders(false);
                      void saveActive(true);
                    }}
                    className={cn(
                      'focus-ring flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                      activeNote.folder === folder.path
                        ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                        : 'text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-[var(--text)]',
                    )}
                  >
                    <span className="truncate">{folder.name}</span>
                    <span className="text-[11px] text-[var(--faint)]">{folder.count || ''}</span>
                  </button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
