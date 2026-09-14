import { motion } from 'framer-motion';
import { Eye, Image as ImageIcon, MonitorPlay, RotateCcw, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { acceptFor, type WallpaperKind, type WallpaperSource } from '../lib/wallpaper';
import { useAppStore } from '../store/useAppStore';
import { Button, Field, Input, Modal } from './ui/primitives';

const KINDS: { value: WallpaperKind; label: string; icon: typeof ImageIcon; hint: string }[] = [
  { value: 'none', label: '无', icon: X, hint: '使用主题自带的极光背景' },
  { value: 'image', label: '图片', icon: ImageIcon, hint: 'JPG / PNG / WebP / GIF' },
  { value: 'video', label: '视频', icon: MonitorPlay, hint: 'MP4 / WebM，静音循环播放' },
];

const PRESETS = [
  { label: '深空', url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=2400&q=80' },
  { label: '山脉', url: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=2400&q=80' },
  { label: '城市夜景', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=2400&q=80' },
  { label: '极简渐变', url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=2400&q=80' },
];

/** Wallpaper settings. Client side only, so every account can use it. */
export function AppearanceDialog() {
  const open = useAppStore((s) => s.appearanceOpen);
  const setOpen = useAppStore((s) => s.setAppearanceOpen);
  const wallpaper = useAppStore((s) => s.wallpaper);
  const wallpaperUrl = useAppStore((s) => s.wallpaperUrl);
  const setWallpaper = useAppStore((s) => s.setWallpaper);
  const setWallpaperFile = useAppStore((s) => s.setWallpaperFile);
  const clearWallpaper = useAppStore((s) => s.clearWallpaper);
  const pushToast = useAppStore((s) => s.pushToast);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState(wallpaper.url);
  const [busy, setBusy] = useState(false);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 64 * 1024 * 1024) {
      pushToast({ title: '文件太大', message: '壁纸请控制在 64 MB 以内', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await setWallpaperFile(file);
    } catch (err) {
      pushToast({ title: '壁纸保存失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="外观"
      subtitle="壁纸只保存在这台浏览器中，不会上传到服务器"
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-[var(--faint)]">换一台设备需要重新设置</p>
          <Button variant="outline" size="sm" onClick={() => void clearWallpaper()}>
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section>
          <h3 className="mb-2.5 text-[12.5px] font-semibold text-[var(--text)]">背景</h3>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((kind) => {
              const Icon = kind.icon;
              const active = wallpaper.kind === kind.value;
              return (
                <button
                  key={kind.value}
                  type="button"
                  onClick={() => {
                    setWallpaper({ kind: kind.value });
                    if (kind.value === 'none') void clearWallpaper();
                  }}
                  className={cn(
                    'focus-ring relative rounded-2xl border p-3 text-left transition-all',
                    active
                      ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] hover:border-[var(--line-strong)]',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="wallpaper-kind"
                      className="absolute inset-0 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <Icon className={cn('relative mb-1.5 h-4 w-4', active ? 'text-[var(--accent)]' : 'text-[var(--faint)]')} />
                  <div className="relative text-[12.5px] font-medium text-[var(--text)]">{kind.label}</div>
                  <div className="relative mt-0.5 text-[10.5px] leading-relaxed text-[var(--faint)]">{kind.hint}</div>
                </button>
              );
            })}
          </div>
        </section>

        {wallpaper.kind !== 'none' ? (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                {(['url', 'file'] as WallpaperSource[]).map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => setWallpaper({ source })}
                    className={cn(
                      'focus-ring rounded-full border px-3 py-1 text-[11.5px] transition-colors',
                      wallpaper.source === source
                        ? 'border-transparent bg-[var(--accent)] text-white'
                        : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]',
                    )}
                  >
                    {source === 'url' ? '图片链接' : '本地文件'}
                  </button>
                ))}
              </div>

              {wallpaper.source === 'url' ? (
                <div className="space-y-2">
                  <Field label="图片 / 视频地址">
                    <div className="flex gap-2">
                      <Input
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setWallpaper({ url: urlDraft.trim() });
                        }}
                        placeholder="https://…"
                      />
                      <Button variant="primary" onClick={() => setWallpaper({ url: urlDraft.trim() })}>
                        应用
                      </Button>
                    </div>
                  </Field>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setUrlDraft(preset.url);
                          setWallpaper({ kind: 'image', source: 'url', url: preset.url });
                        }}
                        className="focus-ring rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={acceptFor(wallpaper.kind)}
                    className="hidden"
                    onChange={(e) => void pickFile(e.target.files?.[0])}
                  />
                  <Button variant="outline" loading={busy} onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" />
                    选择本地文件
                  </Button>
                  <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
                    文件保存在浏览器本地（IndexedDB），不会上传，也不占用服务器空间。
                  </p>
                </div>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { key: 'blur' as const, label: '模糊', min: 0, max: 40, step: 1, suffix: 'px' },
                  { key: 'dim' as const, label: '暗度', min: 0, max: 0.85, step: 0.05, suffix: '' },
                  { key: 'scale' as const, label: '缩放', min: 1, max: 2, step: 0.05, suffix: '×' },
                ] as const
              ).map((control) => (
                <label key={control.key} className="space-y-1.5">
                  <span className="flex items-center justify-between text-[12px] text-[var(--muted)]">
                    <span>{control.label}</span>
                    <span className="text-[var(--faint)]">
                      {control.key === 'dim'
                        ? `${Math.round(wallpaper[control.key] * 100)}%`
                        : `${wallpaper[control.key]}${control.suffix}`}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={wallpaper[control.key]}
                    onChange={(e) => setWallpaper({ [control.key]: Number(e.target.value) } as never)}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>
              ))}
            </section>

            <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] p-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                {wallpaperUrl ? (
                  wallpaper.kind === 'video' ? (
                    <video src={wallpaperUrl} className="h-full w-full object-cover" muted loop autoPlay playsInline />
                  ) : (
                    <img src={wallpaperUrl} alt="" className="h-full w-full object-cover" />
                  )
                ) : null}
              </div>
              <div className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-[var(--faint)]">
                <Eye className="mb-1 h-3.5 w-3.5" />
                {wallpaperUrl
                  ? '效果已实时应用，关闭本窗口即可继续使用。'
                  : wallpaper.source === 'url'
                    ? '填写地址后点「应用」。'
                    : '还没有选择文件。'}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
