import { motion } from 'framer-motion';
import { FolderOpen, Image as ImageIcon, Loader2, MonitorPlay, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
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
  readLibraryFile,
  readPreview,
  restoreLibrary,
  type WallpaperEntry,
  type WallpaperLibrary,
} from '../lib/local-wallpapers';
import { canPlayScenes } from '../lib/scene/play-scene';
import { renderSceneStillFrom } from '../lib/scene/render-still';
import { acceptFor, type WallpaperKind, type WallpaperSource } from '../lib/wallpaper';
import { FontSettings } from './FontSettings';
import { WallpaperCrop } from './WallpaperCrop';
import { useAppStore } from '../store/useAppStore';
import { Button, Field, Input, Modal, Switch } from './ui/primitives';

/**
 * The three kinds of background.
 *
 * Video is not a fourth button: a video file is picked, stored and shown by the
 * same path as a picture, so it lives under 本地图片 rather than taking a slot
 * that would have to be explained.
 */
const KINDS: { value: WallpaperKind; label: string; icon: typeof ImageIcon; hint: string }[] = [
  { value: 'none', label: '极光', icon: X, hint: '主题自带的动态背景，可调色' },
  { value: 'image', label: '本地图片', icon: ImageIcon, hint: 'JPG / PNG / WebP，也支持 MP4 / WebM' },
  { value: 'scene', label: '场景壁纸', icon: MonitorPlay, hint: 'Wallpaper Engine 的 .pkg，不保证都能加载' },
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
  const accent = useAppStore((s) => s.accent);
  const scenePreview = useAppStore((s) => s.scenePreview);
  const setScenePreview = useAppStore((s) => s.setScenePreview);
  const admin = useAppStore((s) => s.adminBackground);
  const identityKey = useAppStore((s) => s.wallpaperIdentity);
  // While the administrator's background is the one showing, the controls that
  // would change it are not offered.
  const locked = wallpaper.useAdminBackground && admin?.configured === true;

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
  const [busyNote, setBusyNote] = useState<string | null>(null);

  /**
   * The crop editor's picture of a scene.
   *
   * Composited from the container into a canvas of its own, at the scene's own
   * shape, rather than read off the wallpaper canvas: that one is sized by the
   * selection, so capturing it made the editor's frame change whenever the
   * selection did - the selection was being drawn against a moving frame, and
   * narrowing it made the frame shorter, which made the next drag land wrong.
   *
   * The frame is remembered under the wallpaper's identity rather than its blob
   * URL, which is different on every page load.
   */
  useEffect(() => {
    if (!open || wallpaper.kind !== 'scene' || !wallpaperUrl) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        // Let the dialog paint before the heavy part. Compositing happens on the
        // main thread, so parsing a 45 MB container and decoding its textures
        // freezes the page for as long as it takes - and a page that does not
        // respond looks exactly like a server that does not.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
        const still = await renderSceneStillFrom(wallpaperUrl, {
          cacheKey: `preview:${identityKey ?? wallpaperUrl}`,
          // Half the pixels of 1600, and it is only ever shown behind a box in a
          // dialog. The first render is the expensive part either way; this is
          // the one paid again for every wallpaper.
          maxWidth: 1024,
        });
        if (!cancelled) setScenePreview(URL.createObjectURL(still.blob));
      } catch {
        /* nothing to draw over; the editor says so instead */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, wallpaper.kind, wallpaperUrl, identityKey, setScenePreview]);

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

  /**
   * Picking a kind is picking your own background.
   *
   * While the administrator's background is showing these buttons used to be
   * inert, so clicking 极光 did nothing at all and the picture stayed - which
   * reads as the dialog being broken. A click now means what it says: the
   * switch goes off and the choice is taken.
   */
  const chooseKind = (kind: WallpaperKind) => {
    setWallpaper(locked ? { useAdminBackground: false, kind } : { kind });
    // The built-in background has no file behind it, and keeping a 45 MB one
    // around for a background nobody is looking at helps nobody.
    if (kind === 'none') void clearWallpaper();
  };

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
      const file = (await readSceneEntry(entry)) ?? (await readEntry(entry));
      await setWallpaperFile(file, 'library');
      // A scene is stored as its container either way: whether it animates or
      // is shown as a picture of itself is the switch's decision, taken by the
      // background layer, and it can only change its mind while the container
      // is still there. Say which one it landed on, since the first static
      // composite takes a few seconds and the frame is empty until it is done.
      if (entry.scene && canPlayScenes()) {
        pushToast(
          wallpaper.dynamicScene
            ? { title: '动态场景已启用', message: '实时渲染，比较耗电；在下面关掉开关即可换回静态背景图', tone: 'info' }
            : { title: '已使用静态背景图', message: '打开「动态场景壁纸」就会实时渲染', tone: 'info' },
        );
      }
      if (entry.still && !entry.scene) {
        pushToast({ title: '已使用静态预览图', message: entry.note ?? '这个壁纸无法在浏览器中播放', tone: 'info' });
      }
    } catch (err) {
      pushToast({ title: '壁纸载入失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setApplying(null);
      setBusyNote(null);
    }
  };

  /**
   * The scene.pkg behind a library entry.
   *
   * The preview.jpg beside it is a square workshop thumbnail, not the picture -
   * for a wide scene it is usually a close crop of one character - so the
   * container is what gets stored, and what everything else is derived from.
   * Null means there is nothing to read and the entry's own file will do.
   */
  const readSceneEntry = async (entry: WallpaperEntry): Promise<File | null> => {
    if (!entry.scene || !canPlayScenes()) return null;
    setBusyNote('正在载入场景壁纸…');
    try {
      const pkg = await readLibraryFile(entry.scene);
      return new File([pkg], entry.scene.split('/').pop() ?? 'scene.pkg');
    } catch (err) {
      pushToast({ title: '场景壁纸载入失败，改用预览图', message: (err as Error).message, tone: 'info' });
      return null;
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
      // The wallpaper is what is being chosen, so it has to stay visible.
      backdrop="light"
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

          {/* Default on, and the user may turn it off. While it is on the
              administrator's choice is the one that shows and the controls
              below are hidden rather than disabled: a row of greyed-out buttons
              invites the question of how to un-grey them. */}
          <section className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-[var(--line)] p-2.5">
            <div className="min-w-0">
              <div className="text-[12px] text-[var(--muted)]">使用管理员设置的默认背景</div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">
                {locked && admin?.configured
                  ? `正在使用管理员设置的背景${admin.note ? `：${admin.note}` : ''}。关掉这个开关就能自己选。`
                  : admin && !admin.configured
                    ? '管理员还没有放置背景文件，下面由你自己决定。'
                    : '已关闭，下面由你自己决定。'}
              </p>
            </div>
            <Switch
              checked={wallpaper.useAdminBackground}
              onChange={(value) => setWallpaper({ useAdminBackground: value })}
              className="mt-0.5 shrink-0"
            />
          </section>

          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((kind) => {
              const Icon = kind.icon;
              const active = wallpaper.kind === kind.value;
              return (
                <button
                  key={kind.value}
                  type="button"
                  onClick={() => chooseKind(kind.value)}
                  className={cn(
                    'focus-ring relative rounded-2xl border p-3 text-left transition-all',
                    active
                      ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] hover:border-[var(--line-strong)]',
                    // Dimmed while the administrator's background is the one
                    // showing, but still clickable: see chooseKind().
                    locked && !active && 'opacity-40',
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

          {locked ? (
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
              上面任意一项点一下，就会关掉「使用管理员设置的默认背景」，改用你自己的选择。
            </p>
          ) : null}

          {/* The built-in background is the theme's two accents, so this is
              where they can be changed - the accent setting colours the whole
              interface, which is not what someone tinting a background wants. */}
          {!locked && wallpaper.kind === 'none' ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
              <span className="text-[12px] text-[var(--muted)]">极光配色</span>
              {(
                [
                  { key: 'auroraA' as const, label: '主色', fallback: '#6d4cff' },
                  { key: 'auroraB' as const, label: '辅色', fallback: '#0ea5e9' },
                ] as const
              ).map((field) => (
                <label key={field.key} className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[var(--faint)]">{field.label}</span>
                  <input
                    type="color"
                    aria-label={`极光${field.label}`}
                    value={wallpaper[field.key] || field.fallback}
                    onChange={(e) => setWallpaper({ [field.key]: e.target.value } as never)}
                    className="h-7 w-10 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                  />
                </label>
              ))}
              {wallpaper.auroraA || wallpaper.auroraB ? (
                <button
                  type="button"
                  onClick={() => setWallpaper({ auroraA: '', auroraB: '' })}
                  className="focus-ring rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  恢复主题色
                </button>
              ) : (
                <span className="text-[11px] text-[var(--faint)]">当前跟随主题的两个强调色</span>
              )}
            </div>
          ) : null}
        </section>

        {!locked && wallpaper.kind !== 'none' ? (
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
                <div className="space-y-2.5">
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
                  {busyNote ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-[var(--accent)]">
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                      {busyNote}
                    </p>
                  ) : null}
                </div>
              )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { key: 'blur' as const, label: '模糊', min: 0, max: 40, step: 1, suffix: 'px' },
                  { key: 'dim' as const, label: '暗度', min: 0, max: 0.85, step: 0.05, suffix: '' },
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

            {/* Scenes can either be composited once or run live. The still is the
                default because it costs nothing to keep on screen. */}
            <section className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--line)] p-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-[var(--muted)]">动态场景壁纸</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">
                  {canPlayScenes()
                    ? '开启后场景壁纸实时渲染（在 worker 里画，不占用界面；较耗电），关闭则合成一张静态背景图。切换后立即生效。'
                    : '当前浏览器不支持（需要 WebGL2 与 OffscreenCanvas），场景壁纸会合成静态背景图。'}
                </p>
              </div>
              <Switch
                checked={wallpaper.dynamicScene}
                disabled={!canPlayScenes()}
                onChange={(value) => setWallpaper({ dynamicScene: value })}
                className="mt-0.5 shrink-0"
              />
            </section>

            {/* Which part of the picture fills the screen. A rectangle, because a
                zoom factor and an anchor point cannot be reasoned about together. */}
            <section className="space-y-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] text-[var(--muted)]">取景区</span>
                <span className="text-[11px] text-[var(--faint)]">框住的部分会填满屏幕</span>
              </div>
              {wallpaperUrl ? (
                <WallpaperCrop
                  // A live scene is stored as its scene.pkg, which no img can
                  // render; the layer hands over a captured frame instead.
                  src={wallpaper.kind === 'scene' ? scenePreview : wallpaperUrl}
                  kind={wallpaper.kind === 'video' ? 'video' : wallpaper.kind === 'scene' ? 'scene' : 'image'}
                  crop={wallpaper.crop}
                  onChange={(crop) => setWallpaper({ crop })}
                  unavailable={
                    wallpaper.kind === 'scene' ? '正在从场景里取一帧用于预览…' : '这张壁纸没有可以预览的图片。'
                  }
                />
              ) : (
                <p className="text-[11px] text-[var(--faint)]">选择壁纸后可以在这里框选要显示的区域。</p>
              )}
            </section>

            {/* Interface colour: taken from the picture by default, because a
                wallpaper and an accent that fight each other look like a bug. */}
            <section className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--line)] p-2.5">
              <div className="min-w-0">
                <div className="text-[12px] text-[var(--muted)]">界面颜色跟随背景</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">
                  {wallpaper.autoAccent
                    ? '从壁纸里取一个主色当作界面强调色。取不到时（图片来自其他站点会被浏览器拦住）用主题自带颜色。'
                    : '已关闭，使用下面选定的颜色。'}
                </p>
              </div>
              <Switch
                checked={wallpaper.autoAccent}
                onChange={(value) => setWallpaper({ autoAccent: value })}
                className="mt-0.5 shrink-0"
              />
            </section>

            {wallpaper.autoAccent ? (
              <div className="flex items-center gap-2 px-1 text-[11px] text-[var(--faint)]">
                <span>当前取色</span>
                <span
                  className="h-4 w-4 rounded-full border border-[var(--line)]"
                  style={{ background: accent ?? 'var(--accent)' }}
                />
                <span className="font-mono">{accent ?? '主题默认'}</span>
              </div>
            ) : (
              <section className="flex items-center gap-3 rounded-2xl border border-[var(--line)] p-2.5">
                <span className="text-[12px] text-[var(--muted)]">界面颜色</span>
                <input
                  type="color"
                  aria-label="界面颜色"
                  value={wallpaper.accentColor || '#6d4cff'}
                  onChange={(e) => setWallpaper({ accentColor: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                />
                <span className="font-mono text-[11px] text-[var(--faint)]">
                  {wallpaper.accentColor || '主题默认'}
                </span>
                {wallpaper.accentColor ? (
                  <button
                    type="button"
                    onClick={() => setWallpaper({ accentColor: '' })}
                    className="focus-ring ml-auto rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    恢复主题色
                  </button>
                ) : null}
              </section>
            )}
          </>
        ) : null}

        {/* Fonts live here rather than in the server settings: they are part of
            how the app looks, alongside the theme and the wallpaper. */}
        <section>
          <h3 className="mb-2.5 text-[12.5px] font-semibold text-[var(--text)]">界面字体</h3>
          <FontSettings />
        </section>
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
            没有在「{library.label}」里找到壁纸。场景壁纸需要文件夹里有 scene.pkg，
            其它壁纸需要 preview.jpg 之类的图片。
          </p>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-[var(--faint)]">
        {canPickDirectory()
          ? '浏览器不允许网页按路径读取磁盘，所以需要你授权一次。选中任意一个文件夹即可——它以及它下面的所有子文件夹都会被搜索，找到壁纸就列出来，并记住这个文件夹。文件不会上传，只有点中的那一张会存进浏览器。'
          : '当前浏览器不支持直接读取文件夹，选择后会通过文件选择器读取其中的图片和视频。文件不会上传。'}
      </p>
    </div>
  );
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
