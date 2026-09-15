import { motion } from 'framer-motion';
import { Eye, FolderOpen, Image as ImageIcon, Loader2, MonitorPlay, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
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
  readPreview,
  restoreLibrary,
  STEAM_LIBRARY_PATHS,
  steamPathHints,
  type WallpaperEntry,
  type WallpaperLibrary,
} from '../lib/local-wallpapers';
import { acceptFor, FOCUS_PRESETS, type WallpaperKind, type WallpaperSource } from '../lib/wallpaper';
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
        setLibrary({ via: 'directory', label: result.label, trail: [result.label], detected: false, entries: [], truncated: false });
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

  const useFromLibrary = async (entry: WallpaperEntry) => {
    setApplying(entry.path);
    try {
      const file = await readEntry(entry);
      await setWallpaperFile(file, 'library');
      if (entry.still) {
        pushToast({ title: '已使用静态预览图', message: entry.note ?? '这个壁纸无法在浏览器中播放', tone: 'info' });
      }
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

            {/* Where the picture sits inside the frame. object-fit: cover always
                crops something when the shapes differ; this decides what. */}
            <section className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-[var(--muted)]">取景位置</span>
                <span className="text-[11px] text-[var(--faint)]">正方形壁纸在这里选显示哪一块</span>
              </div>
              <div className="flex items-start gap-3">
                <div className="grid shrink-0 grid-cols-3 gap-1">
                  {FOCUS_PRESETS.map((preset) => {
                    const active = wallpaper.focusX === preset.x && wallpaper.focusY === preset.y;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        title={preset.label}
                        aria-label={preset.label}
                        aria-pressed={active}
                        onClick={() => setWallpaper({ focusX: preset.x, focusY: preset.y })}
                        className={cn(
                          'focus-ring h-6 w-6 rounded-md border transition-colors',
                          active
                            ? 'border-transparent bg-[var(--accent)]'
                            : 'border-[var(--line)] hover:border-[var(--accent)]',
                        )}
                      />
                    );
                  })}
                </div>
                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                  {(
                    [
                      { key: 'focusX' as const, label: '水平' },
                      { key: 'focusY' as const, label: '垂直' },
                    ] as const
                  ).map((control) => (
                    <label key={control.key} className="space-y-1.5">
                      <span className="flex items-center justify-between text-[12px] text-[var(--muted)]">
                        <span>{control.label}</span>
                        <span className="text-[var(--faint)]">{wallpaper[control.key]}%</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={wallpaper[control.key]}
                        onChange={(e) => setWallpaper({ [control.key]: Number(e.target.value) } as never)}
                        className="w-full accent-[var(--accent)]"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] p-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
                {wallpaperUrl ? (
                  wallpaper.kind === 'video' ? (
                    <video
                      src={wallpaperUrl}
                      className="h-full w-full object-cover"
                      style={{ objectPosition: `${wallpaper.focusX}% ${wallpaper.focusY}%` }}
                      muted
                      loop
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <img
                      src={wallpaperUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ objectPosition: `${wallpaper.focusX}% ${wallpaper.focusY}%` }}
                    />
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
  onUse: (entry: WallpaperEntry) => void;
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
  const usable = library?.entries.filter((entry) => entry.file).length ?? 0;
  const stills = library?.entries.filter((entry) => entry.still).length ?? 0;
  const unusable = total - usable;

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" loading={scanning} onClick={onChooseFolder}>
          <FolderOpen className="h-3.5 w-3.5" />
          {library ? '更换文件夹' : '检测壁纸文件夹'}
        </Button>
        {library ? (
          <Button variant="ghost" size="sm" onClick={onForget}>
            断开
          </Button>
        ) : null}
      </div>

      {/* How the folder was found: the user hands over something above the
          library and the path down to it is reported back. */}
      {library ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--faint)]">
            {library.detected ? <Sparkles className="h-3 w-3 text-[var(--accent)]" /> : <FolderOpen className="h-3 w-3" />}
            <span>{library.detected ? '已自动定位壁纸库' : '壁纸文件夹'}</span>
            <span className="ml-auto shrink-0">
              {usable} 个可设置
              {stills > 0 ? ` · ${stills} 个为静态预览` : ''}
              {unusable > 0 ? ` · ${unusable} 个不可用` : ''}
              {library.truncated ? ' · 仅显示前 240 个' : ''}
            </span>
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-[var(--text)]">
            {library.trail.join(' / ')}
          </div>
        </div>
      ) : null}

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
            <LocalThumb key={entry.path} entry={entry} busy={applying === entry.path} onClick={() => onUse(entry)} />
          ))}
        </div>
      ) : !askPermission && library ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-[var(--warn)]">
            没有在这里找到 Wallpaper Engine 壁纸库。你选择的是「{library.label}」，
            应用会在其中查找 {STEAM_LIBRARY_PATHS[0].join('/')}。
          </p>
          <SteamPathHints />
        </div>
      ) : null}

      {!library ? <SteamPathHints /> : null}

      <p className="text-[11px] leading-relaxed text-[var(--faint)]">
        {canPickDirectory()
          ? '浏览器不允许网页按路径读取磁盘，所以需要你授权一次。授权时可以选中 Steam 目录、某个盘符，或者直接选中 431960 这个总文件夹——选完之后应用会自动往下找到壁纸库，并记住它。文件不会上传，只有点中的那一张会存进浏览器。'
          : '当前浏览器不支持直接读取文件夹，选择后会通过文件选择器读取其中的图片和视频。文件不会上传。'}
      </p>
    </div>
  );
}

/** The standard locations, so the first pick is a paste and an Enter. */
function SteamPathHints() {
  const hints = steamPathHints();
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] p-2.5">
      <p className="text-[11px] leading-relaxed text-[var(--muted)]">
        在文件夹选择框里可以直接把路径粘贴进去。常见位置：
      </p>
      <ul className="mt-1.5 space-y-1">
        {hints.map((hint) => (
          <li key={hint} className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[10.5px] text-[var(--text)]">{hint}</code>
            <button
              type="button"
              onClick={() => {
                void copyText(hint).then((ok) => setCopied(ok ? hint : null));
              }}
              className="focus-ring shrink-0 rounded-lg border border-[var(--line)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {copied === hint ? '已复制' : '复制'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Clipboard access needs a secure context, so keep a fallback for plain http. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** One grid cell. The file is only read once the cell scrolls into view. */
function LocalThumb({ entry, busy, onClick }: { entry: WallpaperEntry; busy: boolean; onClick: () => void }) {
  const holder = useRef<HTMLButtonElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // Wallpaper Engine ships a still for every wallpaper; prefer it over
      // decoding a whole video just to draw a 100px tile.
      const file = await readPreview(entry);
      const objectUrl = URL.createObjectURL(file);
      const isStill = Boolean(entry.preview) || entry.kind !== 'video';
      // a poster frame, otherwise videos show a black tile
      setUrl(isStill ? objectUrl : `${objectUrl}#t=0.1`);
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

  // A preview still is always drawn as a picture; only a bare video file is
  // shown as a video.
  const asStill = Boolean(entry.preview) || entry.kind !== 'video';
  const usable = Boolean(entry.file);
  const badge = entry.type ? TYPE_LABELS[entry.type] : entry.kind === 'video' ? TYPE_LABELS.video : null;

  return (
    <button
      ref={holder}
      type="button"
      onClick={onClick}
      disabled={!usable}
      title={entry.note ? `${entry.title}\n${entry.note}` : entry.title}
      className={cn(
        'focus-ring group relative aspect-video overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)] transition-all',
        usable ? 'hover:border-[var(--accent)]' : 'cursor-not-allowed opacity-60',
      )}
    >
      {failed ? (
        <span className="flex h-full items-center justify-center px-1 text-center text-[10px] text-[var(--faint)]">
          无法预览
        </span>
      ) : url ? (
        asStill ? (
          <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
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
      {badge ? (
        <span className="pointer-events-none absolute right-1 top-1 rounded-md bg-black/55 px-1 py-0.5 text-[9px] leading-none text-white">
          {badge}
        </span>
      ) : null}
      {entry.still ? (
        <span className="pointer-events-none absolute left-1 top-1 rounded-md bg-black/55 px-1 py-0.5 text-[9px] leading-none text-white">
          静态
        </span>
      ) : null}
      {!usable ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/65 px-1.5 py-1 text-center text-[9px] leading-tight text-white">
          无法使用
        </span>
      ) : (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[9.5px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          {entry.title}
        </span>
      )}
    </button>
  );
}

/** Wallpaper Engine's project.json types, in the user's language. */
const TYPE_LABELS: Record<string, string> = {
  scene: '场景',
  video: '视频',
  image: '图片',
  web: '网页',
  application: '应用',
};
