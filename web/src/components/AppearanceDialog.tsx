import { motion } from 'framer-motion';
import { Eye, FolderOpen, Image as ImageIcon, Loader2, MonitorPlay, RotateCcw, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import {
  canPickDirectory,
  closeLibrary,
  currentLibrary,
  grantLibrary,
  libraryFromFiles,
  pickLibrary,
  readEntry,
  restoreLibrary,
  type LocalWallpaper,
  type WallpaperLibrary,
} from '../lib/local-wallpapers';
import { acceptFor, type WallpaperKind, type WallpaperSource } from '../lib/wallpaper';
import { useAppStore } from '../store/useAppStore';
import { Button, Field, Input, Modal } from './ui/primitives';

const KINDS: { value: WallpaperKind; label: string; icon: typeof ImageIcon; hint: string }[] = [
  { value: 'none', label: '无', icon: X, hint: '使用主题自带的极光背景' },
  { value: 'image', label: '图片', icon: ImageIcon, hint: 'JPG / PNG / WebP / GIF' },
  { value: 'video', label: '视频', icon: MonitorPlay, hint: 'MP4 / WebM，静音循环播放' },
];

const SOURCES: { value: WallpaperSource; label: string }[] = [
  { value: 'url', label: '图片链接' },
  { value: 'file', label: '本地文件' },
  { value: 'library', label: '本地壁纸库' },
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
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState(wallpaper.url);
  const [busy, setBusy] = useState(false);

  // The local library lives outside the store: it is a listing of files on this
  // machine, not a setting, and it has to be re-established on every page load.
  const [library, setLibrary] = useState<WallpaperLibrary | null>(() => currentLibrary());
  const [scanning, setScanning] = useState(false);
  const [askPermission, setAskPermission] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const result = await restoreLibrary();
      if (!alive) return;
      if (result.status === 'ok') setLibrary(result.library);
      else if (result.status === 'needs-permission') {
        setAskPermission(true);
        setLibrary({ via: 'directory', label: result.label, entries: [], truncated: false });
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const chooseFolder = async () => {
    setScanning(true);
    try {
      const result = await pickLibrary();
      if (result.status === 'unsupported') {
        folderRef.current?.click();
        return;
      }
      if (result.status === 'cancelled') return;
      setAskPermission(false);
      setLibrary(result.library);
      if (result.library.entries.length === 0) {
        pushToast({ title: '没有找到壁纸', message: '这个文件夹里没有浏览器能显示的图片或视频', tone: 'info' });
      }
    } catch (err) {
      pushToast({ title: '无法读取文件夹', message: (err as Error).message, tone: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const reGrant = async () => {
    setScanning(true);
    try {
      const result = await grantLibrary();
      if (result.status === 'ok') {
        setAskPermission(false);
        setLibrary(result.library);
      } else {
        setAskPermission(false);
      }
    } catch {
      setAskPermission(false);
    } finally {
      setScanning(false);
    }
  };

  const useFromLibrary = async (entry: LocalWallpaper) => {
    setApplying(entry.path);
    try {
      const file = await readEntry(entry);
      await setWallpaperFile(file, 'library');
    } catch (err) {
      pushToast({ title: '壁纸载入失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setApplying(null);
    }
  };

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
                {SOURCES.map((source) => (
                  <button
                    key={source.value}
                    type="button"
                    onClick={() => setWallpaper({ source: source.value })}
                    className={cn(
                      'focus-ring rounded-full border px-3 py-1 text-[11.5px] transition-colors',
                      wallpaper.source === source.value
                        ? 'border-transparent bg-[var(--accent)] text-white'
                        : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]',
                    )}
                  >
                    {source.label}
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
              ) : wallpaper.source === 'file' ? (
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
              ) : (
                <WallpaperLibraryPanel
                  library={library}
                  scanning={scanning}
                  askPermission={askPermission}
                  applying={applying}
                  activePath={wallpaper.source === 'library' ? wallpaperUrl : null}
                  onChooseFolder={() => void chooseFolder()}
                  onReGrant={() => void reGrant()}
                  onForget={() => {
                    void forgetAndReset();
                  }}
                  onUse={(entry) => void useFromLibrary(entry)}
                />
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
                    : wallpaper.source === 'library'
                      ? '从下面的壁纸库里点一张图。'
                      : '还没有选择文件。'}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Fallback for browsers without showDirectoryPicker: the input is always
          rendered so both paths share one code path. */}
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          const first = files[0] as File & { webkitRelativePath?: string };
          const label = first.webkitRelativePath?.split('/')[0] ?? '本地文件夹';
          setLibrary(libraryFromFiles(files, label));
          setAskPermission(false);
          if (folderRef.current) folderRef.current.value = '';
        }}
      />
    </Modal>
  );

  async function forgetAndReset() {
    await closeLibrary();
    setLibrary(null);
    setAskPermission(false);
  }
}

interface LibraryPanelProps {
  library: WallpaperLibrary | null;
  scanning: boolean;
  askPermission: boolean;
  applying: string | null;
  activePath: string | null;
  onChooseFolder: () => void;
  onReGrant: () => void;
  onForget: () => void;
  onUse: (entry: LocalWallpaper) => void;
}

function WallpaperLibraryPanel({
  library,
  scanning,
  askPermission,
  applying,
  onChooseFolder,
  onReGrant,
  onForget,
  onUse,
}: LibraryPanelProps) {
  const total = library?.entries.length ?? 0;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" loading={scanning} onClick={onChooseFolder}>
          <FolderOpen className="h-3.5 w-3.5" />
          {library ? '更换文件夹' : '选择壁纸文件夹'}
        </Button>
        {library ? (
          <Button variant="ghost" size="sm" onClick={onForget}>
            断开
          </Button>
        ) : null}
        {library ? (
          <span className="min-w-0 truncate text-[11px] text-[var(--faint)]">
            {library.label} · {total} 个{library.truncated ? '（仅显示前 240 个）' : ''}
          </span>
        ) : null}
      </div>

      {askPermission ? (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] p-3">
          <p className="text-[11.5px] leading-relaxed text-[var(--text)]">
            浏览器出于安全考虑，重新打开页面后需要再确认一次才能读取「{library?.label || '上次的文件夹'}」。
          </p>
          <Button variant="primary" size="sm" className="mt-2" loading={scanning} onClick={onReGrant}>
            恢复访问
          </Button>
        </div>
      ) : null}

      {total > 0 ? (
        <div className="grid max-h-[280px] grid-cols-3 gap-2 overflow-y-auto rounded-2xl border border-[var(--line)] p-2 sm:grid-cols-4">
          {library?.entries.map((entry) => (
            <LocalThumb
              key={entry.path}
              entry={entry}
              busy={applying === entry.path}
              onClick={() => onUse(entry)}
            />
          ))}
        </div>
      ) : !askPermission && library ? (
        <p className="text-[11px] text-[var(--faint)]">这个文件夹里没有浏览器能显示的图片或视频。</p>
      ) : null}

      <p className="text-[11px] leading-relaxed text-[var(--faint)]">
        {canPickDirectory()
          ? '读取的是你电脑上已有的壁纸文件夹，比如 Wallpaper Engine 的 steamapps/workshop/content/431960。文件不会上传，只有你点中的那一张会存到浏览器里。'
          : '当前浏览器不支持直接读取文件夹，选择后会通过文件选择器读取其中的图片和视频。文件不会上传。'}
      </p>
    </div>
  );
}

/** One grid cell. The file is only read once the cell scrolls into view. */
function LocalThumb({ entry, busy, onClick }: { entry: LocalWallpaper; busy: boolean; onClick: () => void }) {
  const holder = useRef<HTMLButtonElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const file = await readEntry(entry);
      // a poster frame, otherwise videos show a black tile
      const objectUrl = URL.createObjectURL(file);
      setUrl(entry.kind === 'video' ? `${objectUrl}#t=0.1` : objectUrl);
    } catch {
      setFailed(true);
    }
  }, [entry]);

  useEffect(() => {
    const node = holder.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      void load();
      return;
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [load]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url.split('#')[0]);
  }, [url]);

  return (
    <button
      ref={holder}
      type="button"
      onClick={onClick}
      title={entry.path}
      className="focus-ring group relative aspect-video overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)] transition-all hover:border-[var(--accent)]"
    >
      {failed ? (
        <span className="flex h-full items-center justify-center text-[10px] text-[var(--faint)]">无法预览</span>
      ) : url ? (
        entry.kind === 'video' ? (
          <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
        ) : (
          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        )
      ) : (
        <span className="flex h-full items-center justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--faint)]" />
        </span>
      )}

      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45">
          <Loader2 className="h-4 w-4 animate-spin text-white" />
        </span>
      ) : null}
      {entry.kind === 'video' ? (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-md bg-black/55 p-0.5">
          <MonitorPlay className="h-3 w-3 text-white" />
        </span>
      ) : null}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[9.5px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {entry.name}
      </span>
    </button>
  );
}
