import { Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { availableFonts, fontExists } from '../lib/fonts';
import { formatBytes } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Badge, Button, Field, Input } from './ui/primitives';

/**
 * Interface and code fonts.
 *
 * It reads the store itself rather than taking a dozen props, because it is a
 * self-contained block of the appearance dialog: the choice is a site-wide
 * setting, but it belongs next to the theme and wallpaper that go with it.
 */
export function FontSettings() {
  const fonts = useAppStore((s) => s.fonts);
  const fontSelection = useAppStore((s) => s.fontSelection);
  const uploadFont = useAppStore((s) => s.uploadFont);
  const deleteFont = useAppStore((s) => s.deleteFont);
  const selectFonts = useAppStore((s) => s.selectFonts);
  const pushToast = useAppStore((s) => s.pushToast);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Bundled fonts first, then uploads; each dropdown only offers what fits.
  const list = availableFonts(fonts);
  const optionsFor = (role: 'sans' | 'mono') => list.filter((font) => font.kind === role || font.kind === 'both');

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadFont(file, name.trim());
      setName('');
      pushToast({ title: '字体已导入', message: file.name, tone: 'success' });
    } catch (err) {
      pushToast({ title: '字体导入失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="界面字体">
          <select
            value={fontExists(fonts, fontSelection.sans) ? fontSelection.sans : ''}
            onChange={(e) => void selectFonts({ sans: e.target.value })}
            className="focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 text-sm text-[var(--text)] outline-none"
          >
            <option value="">系统默认</option>
            {optionsFor('sans').map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
                {font.builtin ? '（内置）' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="代码 / 编辑器字体">
          <select
            value={fontExists(fonts, fontSelection.mono) ? fontSelection.mono : ''}
            onChange={(e) => void selectFonts({ mono: e.target.value })}
            className="focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 text-sm text-[var(--text)] outline-none"
          >
            <option value="">系统默认</option>
            {optionsFor('mono').map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
                {font.builtin ? '（内置）' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".woff2,.woff,.ttf,.otf"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="字体名称（留空则用文件名）"
          className="h-9 max-w-[240px] text-[12.5px]"
        />
        <Button variant="outline" size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
          导入字体
        </Button>
        <span className="text-[11px] text-[var(--faint)]">woff2 / woff / ttf / otf，最大 32 MB</span>
      </div>

      <ul className="space-y-1.5">
        {list.map((font) => (
          <li
            key={font.id}
            className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] px-3 py-2"
          >
            <span
              className="min-w-0 flex-1 truncate text-[12.5px]"
              style={{ fontFamily: `"${font.family}", var(--font-sans)` }}
            >
              {font.name}
            </span>
            {font.builtin ? <Badge tone="neutral">内置</Badge> : null}
            <Badge tone="neutral">{font.record?.format ?? 'woff2'}</Badge>
            {font.record ? <span className="text-[11px] text-[var(--faint)]">{formatBytes(font.record.size)}</span> : null}
            {fontSelection.sans === font.id || fontSelection.mono === font.id ? (
              <Badge tone="accent">使用中</Badge>
            ) : null}
            {font.record ? (
              <button
                type="button"
                onClick={() => void deleteFont(font.id)}
                className="focus-ring rounded-lg p-1 text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
                aria-label={`删除字体 ${font.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {fonts.length === 0 ? (
        <p className="text-[11px] text-[var(--faint)]">还可以导入自己的字体文件，导入的字体会列在内置字体下方。</p>
      ) : null}
    </section>
  );
}
