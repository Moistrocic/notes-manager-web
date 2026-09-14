import { AnimatePresence, motion } from 'framer-motion';
import { RotateCcw, Trash2 } from 'lucide-react';
import { relativeTime } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Button, Modal } from './ui/primitives';

export function TrashDialog() {
  const open = useAppStore((s) => s.trashOpen);
  const setOpen = useAppStore((s) => s.setTrashOpen);
  const trash = useAppStore((s) => s.trash);
  const restoreNote = useAppStore((s) => s.restoreNote);
  const deleteNote = useAppStore((s) => s.deleteNote);
  const emptyTrash = useAppStore((s) => s.emptyTrash);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="回收站"
      subtitle="删除的笔记会移动到 OpenList 中的 _trash 目录，可随时恢复"
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[11.5px] text-[var(--faint)]">{trash.length} 项</span>
          <Button
            variant="outline"
            size="sm"
            disabled={trash.length === 0}
            onClick={() => void emptyTrash()}
            className="hover:border-[var(--danger)] hover:text-[var(--danger)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空回收站
          </Button>
        </div>
      }
    >
      {trash.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <div className="float-y mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-[var(--line)] bg-[var(--panel)] text-[var(--faint)]">
            <Trash2 className="h-6 w-6" />
          </div>
          <p className="text-[13px] text-[var(--muted)]">回收站是空的</p>
        </div>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {trash.map((note) => (
              <motion.li
                key={note.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="card-hover flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[var(--text)]">{note.title || '未命名笔记'}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--faint)]">
                    <span>删除于 {relativeTime(note.deletedAt ?? note.updated)}</span>
                    {note.originFolder ? <span>· 原位置 /{note.originFolder}</span> : null}
                  </div>
                </div>
                <Button variant="soft" size="sm" onClick={() => void restoreNote(note.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[var(--faint)] hover:text-[var(--danger)]"
                  onClick={() => void deleteNote(note.id, { permanent: true })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Modal>
  );
}
