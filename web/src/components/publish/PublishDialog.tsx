import { useEffect, useMemo, useState } from 'react';
import { renderMarkdown } from '../../lib/markdown';
import { useAppStore } from '../../store/useAppStore';
import { Badge, Button, Input, Modal, Switch } from '../ui/primitives';
import { errorMessage } from './errors';

interface PublishDialogProps {
  /** The note whose publish settings are being edited. */
  noteId: string | null;
  open: boolean;
  onClose: () => void;
}

/**
 * One note's publish settings: whether it is on the blog, and what the card
 * shows instead of the note's own title and opening.
 *
 * The two overrides are optional by design. Left as they are - the title field
 * holding the note's own title, the summary empty - nothing is overridden, and
 * the card falls back to the note itself. Empty is therefore a value, not a
 * missing one: the server reads "" as "no override", which is what makes the
 * card go back to the opening of the body.
 */
export function PublishDialog({ noteId, open, onClose }: PublishDialogProps) {
  const note = useAppStore((s) => (noteId ? s.notes.find((item) => item.id === noteId) ?? null : null));
  const setPublish = useAppStore((s) => s.setPublish);

  const [published, setPublished] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the dialog starts from what the note holds now: an edit left over
  // from last time would be published by the next click. It also covers the
  // note arriving late - the panel's list may still be loading.
  useEffect(() => {
    if (!open) return;
    setPublished(note?.blog ?? false);
    setTitle(note ? note.blogTitle ?? note.title : '');
    setSummary(note?.blogSummary ?? '');
    setError(null);
    setSaving(false);
    // Only on opening, and again if the note it is about turns up afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note?.id]);

  // Only while it is open. The panel renders this dialog whether or not anybody
  // is looking at it, and renderMarkdown needs a DOM (DOMPurify) that a server
  // render does not have - computing a preview nobody could see broke SSR for
  // the whole panel. Closed, there is nothing to preview.
  const preview = useMemo(() => (open && summary.trim() ? renderMarkdown(summary) : ''), [open, summary]);

  const submit = async () => {
    if (!noteId) return;
    setSaving(true);
    setError(null);
    try {
      // The summary goes as it stands, empty included: that is the value which
      // clears the override rather than a title nobody typed being thrown away.
      await setPublish(noteId, { published, title, summary });
      onClose();
    } catch (err) {
      // The dialog stays open: what was typed is still here to be fixed, and
      // the store has already said what went wrong in a toast.
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="发布设置"
      subtitle={note ? note.path : '这篇笔记不在当前列表里'}
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button variant="primary" loading={saving} disabled={!note} onClick={() => void submit()}>
            确定
          </Button>
        </div>
      }
    >
      {!note ? (
        <p className="text-[13px] leading-relaxed text-[var(--muted)]" data-publish-missing>
          找不到这篇笔记{noteId ? '（' + noteId + '）' : ''}。它可能已经被删除，或者移出了当前目录。
        </p>
      ) : (
        <div className="space-y-5" data-publish-form>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[var(--line)] px-4 py-3">
            <Switch checked={published} onChange={setPublished} label="发布到博客" />
            <Badge tone={published ? 'success' : 'neutral'}>{published ? '已发布' : '不发布'}</Badge>
            <span className="text-[11.5px] text-[var(--faint)]">
              {published ? '保存后，这篇笔记会出现在博客上。' : '保存后，这篇笔记只在面板里可见。'}
            </span>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12.5px] font-medium text-[var(--muted)]">博客标题</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label="博客标题"
              placeholder={note.title}
            />
            <span className="block text-[11px] leading-relaxed text-[var(--faint)]">
              卡片上的标题。留空或与笔记同名时，卡片显示笔记自己的标题。
            </span>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] font-medium text-[var(--muted)]">博客简介</span>
              <span className="text-[11px] text-[var(--faint)]">支持 Markdown</span>
            </div>
            {/* Side by side while there is room: what is typed and what it will
                look like are the same decision. Below md they stack. */}
            <div className="grid gap-3 md:grid-cols-2">
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                aria-label="博客简介"
                data-publish-summary
                placeholder="留空则由正文开头自动生成——卡片上的简介就是这段内容。"
                className="focus-ring scroll-area h-64 w-full resize-none rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
              />
              <div
                data-publish-preview
                className="scroll-area h-64 overflow-y-auto rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-4 py-3"
              >
                {summary.trim() ? (
                  <div
                    className="markdown-body text-[13.5px]"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-[var(--faint)]">
                    简介留空时，卡片显示正文开头自动生成的一段。
                  </p>
                )}
              </div>
            </div>
          </div>

          {error ? (
            <p className="text-[12.5px] leading-relaxed text-[var(--danger)]" data-publish-error>
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
