import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import type { PublishEntry } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { Badge, Button, Modal, Tooltip } from '../ui/primitives';
import { PublishDialog } from './PublishDialog';
import { errorMessage } from './errors';

interface PublishManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: PublishEntry[] };

/**
 * Every note the publish dialog has been used on, published or not.
 *
 * The table is the list endpoint's own shape, fetched when the dialog opens
 * rather than kept in the store: it is an administration screen, read now and
 * then, and the panel's note list is not this.
 *
 * A row is a summary - each cell on one line - so double-clicking it opens the
 * whole thing, and the two verbs at its end are icons with names of their own.
 * Editing opens the same PublishDialog the panel does; deleting asks first,
 * because the confirmation has to say that the note itself stays.
 */
export function PublishManagerDialog({ open, onClose }: PublishManagerDialogProps) {
  const forgetPublish = useAppStore((s) => s.forgetPublish);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [editing, setEditing] = useState<string | null>(null);
  const [detail, setDetail] = useState<PublishEntry | null>(null);
  const [confirming, setConfirming] = useState<PublishEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchEntries = useCallback(async (mode: 'load' | 'refresh') => {
    if (mode === 'load') setLoad({ status: 'loading' });
    try {
      const payload = await api.listPublish();
      setLoad({ status: 'ready', entries: payload.entries });
    } catch (err) {
      setLoad({ status: 'error', message: errorMessage(err) });
    }
  }, []);

  // Opening fetches the table again and puts away whatever was standing in
  // front of it - a confirmation from last time must not be waiting to be
  // clicked.
  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setDetail(null);
    setConfirming(null);
    setDeleteError(null);
    void fetchEntries('load');
  }, [open, fetchEntries]);

  const entries = load.status === 'ready' ? load.entries : [];
  const nested = Boolean(editing || detail || confirming);

  /**
   * Escape closes the dialog on top, not the one under it.
   *
   * Every Modal answers Escape on the window, so the edit, the detail and the
   * confirmation - all opened from this table - used to take the table down
   * with them. While one of them is up, this dialog ignores its own close: the
   * child answers the key, and the table is still there behind it. Its own
   * close button is under the child at that moment anyway.
   */
  const closeSelf = () => {
    if (nested) return;
    onClose();
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await forgetPublish(confirming.id);
      // The row comes off the table; the note itself has not moved, so fetching
      // the whole thing again would only make the table flicker.
      setLoad((state) =>
        state.status === 'ready'
          ? { status: 'ready', entries: state.entries.filter((entry) => entry.id !== confirming.id) }
          : state,
      );
      setConfirming(null);
    } catch (err) {
      // Kept open: the reason is here, and the row is still on the table.
      setDeleteError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={closeSelf}
        title="发布管理"
        subtitle="用过发布设置的笔记：发布状态、时间，以及卡片上显示的标题与简介。"
        width="max-w-5xl"
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        }
      >
        {load.status === 'loading' ? (
          <p className="text-[13px] text-[var(--muted)]" data-publish-loading>
            载入中…
          </p>
        ) : load.status === 'error' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[13px] leading-relaxed text-[var(--danger)]" data-publish-error>
              {load.message}
            </p>
            <Button variant="outline" onClick={() => void fetchEntries('load')}>
              重试
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-[var(--muted)]" data-publish-empty>
            还没有笔记用过发布设置。在笔记上打开发布设置并保存之后，这里会列出它。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left text-[12.5px]" data-publish-table>
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.08em] text-[var(--faint)]">
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">发布时间</th>
                  <th className="px-3 py-2 font-medium">文件路径</th>
                  <th className="px-3 py-2 font-medium">文件名称</th>
                  <th className="px-3 py-2 font-medium">标题</th>
                  <th className="px-3 py-2 font-medium">简介</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    data-publish-row={entry.path}
                    data-publish-state={entry.published ? 'published' : 'draft'}
                    onDoubleClick={() => setDetail(entry)}
                    title="双击查看完整信息"
                    className="border-t border-[var(--line)] transition-colors hover:bg-[color-mix(in_srgb,var(--text)_4%,transparent)]"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={entry.published ? 'success' : 'neutral'}>
                        {entry.published ? '已发布' : '不发布'}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                      {entry.publishedAt ? formatDateTime(entry.publishedAt) : '-'}
                    </td>
                    <td className="max-w-[14rem] truncate whitespace-nowrap px-3 py-2.5 text-[var(--muted)]" title={entry.path}>
                      {entry.path}
                    </td>
                    <td className="max-w-[10rem] truncate whitespace-nowrap px-3 py-2.5 text-[var(--muted)]" title={entry.name}>
                      {entry.name}
                    </td>
                    <td className="max-w-[12rem] truncate whitespace-nowrap px-3 py-2.5 text-[var(--text)]" title={entry.title}>
                      {entry.title}
                    </td>
                    <td className="max-w-[16rem] truncate whitespace-nowrap px-3 py-2.5 text-[var(--muted)]" title={entry.summary}>
                      {entry.summary || '-'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip label="编辑发布信息" side="top">
                          <button
                            type="button"
                            aria-label="编辑发布信息"
                            onClick={() => setEditing(entry.id)}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip label="删除发布信息" side="top">
                          <button
                            type="button"
                            aria-label="删除发布信息"
                            onClick={() => {
                              setDeleteError(null);
                              setConfirming(entry);
                            }}
                            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Editing a row: the dialog the panel opens for one note, so there is one
          place where publish settings are decided. */}
      <PublishDialog
        noteId={editing}
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          // The title and the summary are what the table shows, so it is asked
          // again once the dialog is done with - without going blank first.
          void fetchEntries('refresh');
        }}
      />

      {/* Double-clicking a row: everything the row had to cut off. */}
      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title ?? ''}
        subtitle={detail?.path}
        width="max-w-2xl"
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setDetail(null)}>
              关闭
            </Button>
          </div>
        }
      >
        {detail ? (
          <div className="space-y-4 text-[13px]" data-publish-detail>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Badge tone={detail.published ? 'success' : 'neutral'}>{detail.published ? '已发布' : '不发布'}</Badge>
              <span className="text-[11.5px] text-[var(--faint)]">
                发布时间 {detail.publishedAt ? formatDateTime(detail.publishedAt) : '-'}
              </span>
              <span className="text-[11.5px] text-[var(--faint)]">·</span>
              <span className="text-[11.5px] text-[var(--faint)]">修改时间 {formatDateTime(detail.updatedAt)}</span>
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-[var(--faint)]">文件</p>
              <p className="mt-1 break-all text-[var(--muted)]">{detail.path}</p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-[var(--faint)]">标题</p>
              <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">{detail.title}</p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-[var(--faint)]">简介</p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--muted)]">
                {detail.summary || '（没有简介：卡片显示正文开头自动生成的一段）'}
              </p>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Deleting a row: the confirmation says what is deleted and what is not. */}
      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="删除发布信息"
        subtitle={confirming?.name}
        width="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              删除发布信息
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-[13px] leading-relaxed text-[var(--muted)]" data-publish-confirm>
          <p>
            只删除这篇笔记的发布信息：发布的标题与简介会被清掉，<strong className="font-medium text-[var(--text)]">笔记文件本身不会被删除</strong>，内容、名称和位置都不动。
          </p>
          <p className="text-[12.5px] text-[var(--faint)]">{confirming?.path}</p>
          {deleteError ? (
            <p className="text-[12.5px] text-[var(--danger)]" data-publish-error>
              {deleteError}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
