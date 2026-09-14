import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  FileCog,
  HardDrive,
  KeyRound,
  RefreshCw,
  Save,
  Trash2,
  Type,
  Upload,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { formatBytes } from '../lib/format';
import type { AppSettingsPayload } from '../lib/types';
import { useAppStore } from '../store/useAppStore';
import { Badge, Button, Field, Input, Modal, Switch } from './ui/primitives';

type Driver = 'auto' | 'openlist' | 'local';

export function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen);
  const setOpen = useAppStore((s) => s.setSettingsOpen);
  const pushToast = useAppStore((s) => s.pushToast);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const refreshNotes = useAppStore((s) => s.refreshNotes);
  const providers = useAppStore((s) => s.providers);

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
  const [fontName, setFontName] = useState('');
  const [fontBusy, setFontBusy] = useState(false);
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const fonts = useAppStore((s) => s.fonts);
  const fontSelection = useAppStore((s) => s.fontSelection);
  const uploadFont = useAppStore((s) => s.uploadFont);
  const deleteFont = useAppStore((s) => s.deleteFont);
  const selectFonts = useAppStore((s) => s.selectFonts);

  const onUploadFont = async (file: File | undefined) => {
    if (!file) return;
    setFontBusy(true);
    try {
      await uploadFont(file, fontName.trim());
      setFontName('');
    } catch (err) {
      pushToast({ title: '导入失败', message: (err as Error).message, tone: 'error' });
    } finally {
      setFontBusy(false);
      if (fontInputRef.current) fontInputRef.current.value = '';
    }
  };

  const onDeleteFont = async (id: string) => {
    try {
      await deleteFont(id);
    } catch (err) {
      pushToast({ title: '删除失败', message: (err as Error).message, tone: 'error' });
    }
  };

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
      });
      pushToast({ title: '设置已保存', tone: 'success' });
      await Promise.all([refreshStatus(), refreshNotes({ silent: true })]);
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

        {/* Fonts */}
        <section>
          <SectionTitle icon={Type} title="界面字体" hint="上传字体文件，重启后依然生效" />
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="界面字体">
                <select
                  value={fonts.find((f) => f.id === fontSelection.sans) ? fontSelection.sans : ''}
                  onChange={(e) => void selectFonts({ sans: e.target.value })}
                  className="focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 text-sm text-[var(--text)] outline-none"
                >
                  <option value="">系统默认</option>
                  {fonts.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="代码 / 编辑器字体">
                <select
                  value={fonts.find((f) => f.id === fontSelection.mono) ? fontSelection.mono : ''}
                  onChange={(e) => void selectFonts({ mono: e.target.value })}
                  className="focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 text-sm text-[var(--text)] outline-none"
                >
                  <option value="">系统默认</option>
                  {fonts.map((font) => (
                    <option key={font.id} value={font.id}>
                      {font.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fontInputRef}
                type="file"
                accept=".woff2,.woff,.ttf,.otf"
                className="hidden"
                onChange={(e) => void onUploadFont(e.target.files?.[0])}
              />
              <Input
                value={fontName}
                onChange={(e) => setFontName(e.target.value)}
                placeholder="字体名称（留空则用文件名）"
                className="h-9 max-w-[240px] text-[12.5px]"
              />
              <Button variant="outline" size="sm" loading={fontBusy} onClick={() => fontInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                导入字体
              </Button>
              <span className="text-[11px] text-[var(--faint)]">woff2 / woff / ttf / otf，最大 32 MB</span>
            </div>

            {fonts.length > 0 ? (
              <ul className="space-y-1.5">
                {fonts.map((font) => (
                  <li
                    key={font.id}
                    className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ fontFamily: `"${font.name}", var(--font-sans)` }}>
                      {font.name}
                    </span>
                    <Badge tone="neutral">{font.format}</Badge>
                    <span className="text-[11px] text-[var(--faint)]">{formatBytes(font.size)}</span>
                    {fontSelection.sans === font.id || fontSelection.mono === font.id ? (
                      <Badge tone="accent">使用中</Badge>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void onDeleteFont(font.id)}
                      className="focus-ring rounded-lg p-1 text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
                      aria-label={`删除字体 ${font.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-[var(--faint)]">还没有导入字体，当前使用系统默认字体。</p>
            )}
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
