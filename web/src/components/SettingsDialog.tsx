import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  FileCog,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  RefreshCw,
  Save,
  Wand2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { sceneStillUrl } from '../lib/scene/render-still';
import type { BackgroundSettings, AppSettingsPayload } from '../lib/types';
import { useAppStore } from '../store/useAppStore';
import { StatusDetail, StatusPill } from './StatusPill';
import { WallpaperCrop } from './WallpaperCrop';
import { Badge, Button, Field, Input, Modal, Switch } from './ui/primitives';

type Driver = 'auto' | 'openlist' | 'local';

/** What the administrator can make the default background out of. */
const BACKGROUND_KINDS: { value: BackgroundSettings['kind']; label: string; hint: string }[] = [
  { value: 'off', label: '不设置', hint: '每个人自己在「外观」里选' },
  { value: 'aurora', label: '主题极光', hint: '主题自带的动态背景，可选两个颜色' },
  { value: 'image', label: '图片', hint: 'JPG / PNG / WebP / GIF' },
  { value: 'video', label: '视频', hint: 'MP4 / WebM' },
  { value: 'scene', label: '场景壁纸', hint: 'Wallpaper Engine 的 .pkg，可实时渲染' },
];

const KIND_LABELS: Record<string, string> = { image: '图片', video: '视频', scene: '场景壁纸' };

const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'off',
  file: '',
  note: '',
  crop: { x: 0, y: 0, w: 1, h: 1 },
  blur: 0,
  dim: 0.35,
  dynamic: false,
  auroraA: '',
  auroraB: '',
};

/** A file size, for a list of files nobody wants to read in bytes. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** A file name inside a sentence, so the paths read as paths. */
function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1">{children}</code>
  );
}

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const pushToast = useAppStore((s) => s.pushToast);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const refreshNotes = useAppStore((s) => s.refreshNotes);
  const providers = useAppStore((s) => s.providers);
  const status = useAppStore((s) => s.status);
  const adminBackground = useAppStore((s) => s.adminBackground);
  const refreshAdminBackground = useAppStore((s) => s.refreshAdminBackground);

  const [payload, setPayload] = useState<AppSettingsPayload | null>(null);
  const [driver, setDriver] = useState<Driver>('auto');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [root, setRoot] = useState('/notes');
  const [perUser, setPerUser] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  /** The default background being edited, saved with the rest of the form. */
  const [background, setBackground] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
  /** A composited frame of the scene being picked, for the crop editor. */
  const [cropStill, setCropStill] = useState<string | null>(null);
  // Reported by /api/system/status, so it is the running server's own version.
  const version = useAppStore((s) => s.status?.version);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    void api
      .settings()
      .then((data) => {
        setPayload(data);
        setDriver(data.settings.storage.driver);
        setUrl(data.settings.storage.openlist.url);
        setToken(data.settings.storage.openlist.token);
        setRoot(data.settings.storage.openlist.root);
        setPerUser(data.settings.storage.openlist.perUser);
        setBackground(data.settings.background ?? DEFAULT_BACKGROUND);
      })
      .catch((err: Error) => pushToast({ title: '读取设置失败', message: err.message, tone: 'error' }));
  }, [open, pushToast]);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSettings({
        storage: {
          driver,
          openlist: { url: url.trim(), token: token.trim(), root: root.trim() || '/notes', perUser },
        },
        background,
      });
      pushToast({ title: '设置已保存', tone: 'success' });
      await Promise.all([refreshStatus(), refreshNotes({ silent: true }), refreshAdminBackground()]);
      const data = await api.settings();
      setPayload(data);
    } catch (err) {
      pushToast({ title: '保存失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testOpenList(url.trim(), token.trim() || undefined);
      setTestResult({ ok: result.ok, message: result.message });
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const envLocked = (key: string) => payload?.effective.sources?.[key] === 'env';

  /** A file kind needs a file; the theme's own background does not. */
  const needsFile = background.kind === 'image' || background.kind === 'video' || background.kind === 'scene';
  const available = adminBackground?.available ?? [];
  const matchingFiles = needsFile ? available.filter((entry) => entry.kind === background.kind) : [];
  const backgroundsDir = payload ? `${payload.paths.dataDir}/backgrounds` : 'data/backgrounds';
  const kindLabel = (kind: BackgroundSettings['kind']) => KIND_LABELS[kind] ?? '背景';

  /** Choosing a kind also chooses a file, when there is one of that kind. */
  const chooseKind = (kind: BackgroundSettings['kind']) => {
    setBackground((current) => {
      if (kind !== 'image' && kind !== 'video' && kind !== 'scene') return { ...current, kind, file: '' };
      const kept = available.find((entry) => entry.kind === kind && entry.name === current.file);
      const first = kept ?? available.find((entry) => entry.kind === kind);
      return { ...current, kind, file: first?.name ?? '' };
    });
  };

  // The picture the crop editor draws over: the file itself, or - for a scene,
  // which no img can read - one composited frame of it.
  const previewUrl =
    needsFile && background.file ? `/api/background/file?name=${encodeURIComponent(background.file)}` : null;
  /** The size is part of the cache key: a replaced file is a different frame. */
  const previewBytes = available.find((entry) => entry.name === background.file)?.bytes ?? 0;
  const cropSource = background.kind === 'scene' ? cropStill : previewUrl;

  useEffect(() => {
    if (!open || background.kind !== 'scene' || !previewUrl) {
      setCropStill(null);
      return undefined;
    }
    let cancelled = false;
    let made: string | null = null;
    void (async () => {
      try {
        made = await sceneStillUrl(previewUrl, `admin:${background.file}:${previewBytes}`);
        if (cancelled) {
          URL.revokeObjectURL(made);
          return;
        }
        setCropStill(made);
      } catch {
        /* nothing to draw over; the editor says so instead */
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
      setCropStill(null);
    };
  }, [open, background.kind, background.file, previewUrl, previewBytes]);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="存储与服务器设置"
      subtitle="笔记默认写入 OpenList 目录；没有 OpenList 时自动使用本地磁盘"
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[var(--faint)]">环境变量优先级高于此处保存的值</p>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Driver */}
        <section>
          <SectionTitle icon={Database} title="存储驱动" hint="决定笔记写到哪里" />
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                { value: 'auto', label: '自动（推荐）', desc: 'OpenList 在线时用它，否则回落本地磁盘', icon: Wand2 },
                { value: 'openlist', label: '仅 OpenList', desc: '强制使用 OpenList，不可用时直接报错', icon: Cloud },
                { value: 'local', label: '仅本地', desc: '笔记保存在服务器本地目录', icon: HardDrive },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const active = driver === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDriver(option.value)}
                  className={cn(
                    'focus-ring relative rounded-2xl border p-3 text-left transition-all',
                    active
                      ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line)] hover:border-[var(--line-strong)]',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="driver-active"
                      className="absolute inset-0 rounded-2xl border border-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <Icon className={cn('relative mb-2 h-4 w-4', active ? 'text-[var(--accent)]' : 'text-[var(--faint)]')} />
                  <div className="relative text-[12.5px] font-medium text-[var(--text)]">{option.label}</div>
                  <div className="relative mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">{option.desc}</div>
                </button>
              );
            })}
          </div>
          {envLocked('driver') ? (
            <p className="mt-2 text-[11px] text-[var(--warn)]">STORAGE_DRIVER 由环境变量锁定，修改此处不会生效。</p>
          ) : null}
        </section>

        {/* Live connection detail. It used to sit under the note list, where it
            took a card's worth of room to say something you read once. */}
        <section>
          <SectionTitle icon={Cloud} title="当前连接" hint="服务器的实际状态" />
          <div className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3">
            <div className="flex items-center gap-2">
              <StatusPill status={status?.storage} compact />
              <button
                type="button"
                onClick={() => void refreshStatus()}
                className="focus-ring flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
                aria-label="刷新存储状态"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2">
              <StatusDetail status={status?.storage} />
            </div>
          </div>
        </section>

        {/* The background everyone gets, and how it should look. The files are
            the administrator's own, dropped into backgrounds/ with a file
            manager; everything about them is set here. */}
        <section>
          <SectionTitle icon={ImageIcon} title="默认背景" hint="所有人打开面板时看到的背景" />
          <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {BACKGROUND_KINDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => chooseKind(option.value)}
                  title={option.hint}
                  className={cn(
                    'focus-ring rounded-full border px-3 py-1 text-[11.5px] transition-colors',
                    background.kind === option.value
                      ? 'border-transparent bg-[var(--accent)] text-white'
                      : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0"
                onClick={() => void refreshAdminBackground()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新读取
              </Button>
            </div>

            {needsFile ? (
              <div className="space-y-2">
                <div className="text-[11.5px] text-[var(--faint)]">
                  背景文件 · 服务器数据目录下的 <Code>backgrounds/</Code>
                </div>
                {matchingFiles.length > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {matchingFiles.map((entry) => (
                      <button
                        key={entry.name}
                        type="button"
                        onClick={() => setBackground((current) => ({ ...current, file: entry.name }))}
                        className={cn(
                          'focus-ring flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[12px] transition-colors',
                          background.file === entry.name
                            ? 'border-[color-mix(in_srgb,var(--accent)_55%,transparent)] bg-[var(--accent-soft)] text-[var(--text)]'
                            : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                        <span className="shrink-0 text-[11px] text-[var(--faint)]">{formatBytes(entry.bytes)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[var(--warn)]">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      这里还没有{kindLabel(background.kind)}文件。把文件放进{' '}
                      <Code>{backgroundsDir}</Code> 之后点「重新读取」。
                    </span>
                  </div>
                )}
              </div>
            ) : null}

            {background.kind === 'aurora' ? (
              <div className="flex flex-wrap items-center gap-3">
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
                      value={background[field.key] || field.fallback}
                      onChange={(e) => setBackground((current) => ({ ...current, [field.key]: e.target.value }))}
                      className="h-7 w-10 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                    />
                  </label>
                ))}
                {background.auroraA || background.auroraB ? (
                  <button
                    type="button"
                    onClick={() => setBackground((current) => ({ ...current, auroraA: '', auroraB: '' }))}
                    className="focus-ring rounded-lg border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    恢复主题色
                  </button>
                ) : (
                  <span className="text-[11px] text-[var(--faint)]">当前跟随主题的两个强调色</span>
                )}
              </div>
            ) : null}

            {needsFile ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
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
                            ? `${Math.round(background[control.key] * 100)}%`
                            : `${background[control.key]}${control.suffix}`}
                        </span>
                      </span>
                      <input
                        type="range"
                        min={control.min}
                        max={control.max}
                        step={control.step}
                        value={background[control.key]}
                        onChange={(e) =>
                          setBackground((current) => ({ ...current, [control.key]: Number(e.target.value) }))
                        }
                        className="w-full accent-[var(--accent)]"
                      />
                    </label>
                  ))}
                </div>

                {background.kind === 'scene' ? (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] p-2.5">
                    <div className="min-w-0">
                      <div className="text-[12px] text-[var(--muted)]">实时渲染</div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--faint)]">
                        开启后场景壁纸在 worker 里实时播放（有动画，较耗电）；关闭则合成一张静态背景图，所有人打开面板都只下载那一张。
                      </p>
                    </div>
                    <Switch
                      checked={background.dynamic}
                      onChange={(value) => setBackground((current) => ({ ...current, dynamic: value }))}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-[var(--muted)]">取景区</span>
                    <span className="text-[11px] text-[var(--faint)]">框住的部分会填满屏幕</span>
                  </div>
                  {cropSource ? (
                    <WallpaperCrop
                      src={cropSource}
                      kind={background.kind === 'scene' ? 'scene' : background.kind === 'video' ? 'video' : 'image'}
                      crop={background.crop}
                      onChange={(crop) => setBackground((current) => ({ ...current, crop }))}
                      unavailable={
                        background.kind === 'scene' ? '正在从场景里取一帧用于预览…' : '这个文件还没有可以预览的图片。'
                      }
                    />
                  ) : (
                    <p className="text-[11px] text-[var(--faint)]">选好文件后可以在这里框选要显示的区域。</p>
                  )}
                </div>
              </>
            ) : null}

            <Field label="备注" hint="给以后接手的人看">
              <Input
                value={background.note}
                onChange={(e) => setBackground((current) => ({ ...current, note: e.target.value }))}
                placeholder="例如：洛茜 Rossi · 创意工坊 3691554683"
              />
            </Field>

            <p className="text-[11px] leading-relaxed text-[var(--faint)]">
              {background.kind === 'off'
                ? '没有默认背景：每个人在「外观」里自己选。已经选过的人不会被打扰。'
                : '所有人的「外观 → 背景」都会用这套设置，并且可以自己关掉开关改用个人选择；取景区、模糊、暗度与是否实时渲染都以这里为准。'}{' '}
              改完点右下角保存。
            </p>
          </div>
        </section>

        {/* OpenList */}
        <section>
          <SectionTitle icon={Cloud} title="OpenList 连接" hint="填写 OpenList 地址与 API 令牌" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="OpenList 地址" hint={envLocked('openlistUrl') ? 'env 锁定' : undefined}>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://127.0.0.1:5244"
                disabled={envLocked('openlistUrl')}
              />
            </Field>
            <Field label="API 令牌" hint="OpenList → 设置 → API">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="留空则使用登录用户的令牌"
                type="password"
                disabled={envLocked('openlistToken')}
              />
            </Field>
            <Field label="笔记根目录" hint={envLocked('openlistRoot') ? 'env 锁定' : undefined}>
              <Input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/notes" disabled={envLocked('openlistRoot')} />
            </Field>
            <div className="flex flex-col justify-end gap-2.5 pb-1">
              <Switch checked={perUser} onChange={setPerUser} label="每个用户使用独立子目录" />
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                开启后笔记保存到 <code className="font-mono">{root || '/notes'}/&lt;用户名&gt;</code>
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void test()} loading={testing}>
              <RefreshCw className="h-3.5 w-3.5" />
              测试连接
            </Button>
            {testResult ? (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  'inline-flex items-center gap-1.5 text-[11.5px]',
                  testResult.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]',
                )}
              >
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {testResult.message}
              </motion.span>
            ) : null}
            {providers?.openlist ? <Badge tone="success">当前在线</Badge> : <Badge tone="warn">当前离线</Badge>}
          </div>
        </section>

        {/* Paths */}
        <section>
          <SectionTitle icon={HardDrive} title="服务器配置文件" hint="优先级最高，改完需重启服务" />
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-[var(--accent-soft)] p-3">
            <div className="flex items-center gap-2 text-[11.5px] text-[var(--accent)]">
              <FileCog className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">配置文件</span>
              {payload?.paths.envFileLoaded ? (
                <Badge tone="success">已加载</Badge>
              ) : (
                <Badge tone="warn">不存在，使用默认值</Badge>
              )}
            </div>
            <p className="mt-1.5 break-all font-mono text-[11.5px] text-[var(--text)]">
              {payload?.paths.envFile ?? '—'}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              环境变量的优先级高于此处保存的设置，被环境变量接管的字段会标注「env 锁定」。
              修改该文件后执行 <code className="font-mono">systemctl restart notes-manager</code> 生效。
            </p>
          </div>

          <div className="mt-3 space-y-1.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] p-3 font-mono text-[11px] text-[var(--muted)]">
            {[
              ['版本', version ? 'v' + version : undefined],
              ['项目根目录', payload?.paths.projectRoot],
              ['数据目录', payload?.paths.dataDir],
              ['本地笔记目录', payload?.paths.localNotesRoot],
              ['OpenList 根目录', payload?.effective.storage.openlist.root],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-[var(--faint)]">{label}</span>
                <span className="truncate">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Password */}
        {providers?.local ? (
          <section>
            <SectionTitle icon={KeyRound} title="本地管理员密码" hint="仅影响本地账户登录" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="当前密码">
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </Field>
              <Field label="新密码" hint="至少 6 位">
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                void api
                  .changePassword(currentPassword, newPassword)
                  .then(() => {
                    pushToast({ title: '密码已更新', tone: 'success' });
                    setCurrentPassword('');
                    setNewPassword('');
                  })
                  .catch((err: Error) => pushToast({ title: '修改失败', message: err.message, tone: 'error' }));
              }}
            >
              更新密码
            </Button>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Cloud; title: string; hint?: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-[var(--accent)]" />
      <h3 className="text-[12.5px] font-semibold text-[var(--text)]">{title}</h3>
      {hint ? <span className="text-[11px] text-[var(--faint)]">· {hint}</span> : null}
    </div>
  );
}
