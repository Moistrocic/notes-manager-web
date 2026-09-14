import { motion } from 'framer-motion';
import { AlertCircle, Cloud, HardDrive, KeyRound, Loader2, Lock, LogIn, Server, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Field, Input } from './ui/primitives';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/useAppStore';

type Provider = 'auto' | 'openlist' | 'local';

export function LoginScreen() {
  const providers = useAppStore((s) => s.providers);
  const login = useAppStore((s) => s.login);
  const authBusy = useAppStore((s) => s.authBusy);
  const bootError = useAppStore((s) => s.bootError);

  const [provider, setProvider] = useState<Provider>('auto');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [needsOtp, setNeedsOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  const openlistReady = providers?.openlist ?? false;

  // "not configured" and "configured but unreachable" need different advice, so
  // they must not both read as "offline".
  const openlist =
    providers && !providers.openlistConfigured
      ? {
          state: 'unconfigured' as const,
          tone: 'warn' as const,
          label: 'OpenList 未配置',
          hint: '还没有填写 OpenList 地址，笔记会保存在本机磁盘。用本地管理员登录后，在「设置 → OpenList 连接」中填写地址即可切换。',
        }
      : providers?.openlist
        ? {
            state: 'online' as const,
            tone: 'success' as const,
            label: 'OpenList 在线',
            hint: '',
          }
        : {
            state: 'unreachable' as const,
            tone: 'danger' as const,
            label: 'OpenList 无法连接',
            hint:
              `已配置 ${providers?.openlistUrl ?? 'OpenList 地址'}，但服务器无法访问它：${providers?.openlistError ?? '连接失败'}。` +
              '注意 127.0.0.1 指的是服务器本身，而不是你打开浏览器的那台电脑。',
          };

  useEffect(() => {
    if (!providers) return;
    if (!openlistReady && providers.local) setProvider('local');
  }, [providers, openlistReady]);

  const tabs = useMemo(() => {
    const list: { value: Provider; label: string; icon: typeof Cloud; hint: string }[] = [];
    if (providers?.openlist) {
      list.push({ value: 'openlist', label: 'OpenList 账户', icon: Cloud, hint: providers.openlistUrl ?? '' });
    }
    if (providers?.local) {
      list.push({ value: 'local', label: '本地管理员', icon: HardDrive, hint: '服务器本地账户' });
    }
    if (list.length > 1) {
      list.unshift({ value: 'auto', label: '自动', icon: Server, hint: '优先使用 OpenList 账户' });
    }
    return list;
  }, [providers]);


  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await login({
        username: username.trim(),
        password,
        otp: needsOtp ? otp : undefined,
        provider: tabs.length === 1 ? tabs[0].value : provider,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      if (code === 'otp_required') {
        setNeedsOtp(true);
        setError('该 OpenList 账户启用了两步验证，请输入动态验证码');
      } else {
        setError(message);
      }
      setShake((n) => n + 1);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative z-10 grid w-full max-w-5xl gap-10 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, x: -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 28 }}
          className="hidden lg:block"
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[12px] text-[var(--muted)] backdrop-blur">
            <span className={cn('h-1.5 w-1.5 rounded-full', openlistReady ? 'bg-[var(--success)]' : 'bg-[var(--warn)]')} />
            {openlistReady ? `OpenList 已连接 · ${providers?.openlistUrl ?? ''}` : 'OpenList 未连接 · 使用本地存储'}
          </div>
          <h1 className="text-[42px] font-semibold leading-[1.1] tracking-tight">
            <span className="gradient-text">笔记管理面板</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
            把 Markdown 笔记直接写进你的 OpenList 目录，随时随地用任意设备访问。
            没有 OpenList？本地面板同样完整可用。
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {['OpenList 账户登录', 'Markdown 实时预览', '标签与文件夹', '全文检索', '回收站找回'].map((item, index) => (
              <motion.span
                key={item}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + index * 0.06 }}
                className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[12.5px] text-[var(--muted)] backdrop-blur"
              >
                {item}
              </motion.span>
            ))}
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          key={shake}
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1, x: shake ? [0, -9, 9, -6, 6, 0] : 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="gradient-border glass relative mx-auto w-full max-w-[430px] rounded-3xl p-7 shadow-strong"
        >
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-soft">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">登录工作台</h2>
              <p className="text-[12.5px] text-[var(--muted)]">使用 OpenList 或本地管理员账户</p>
            </div>
          </div>

          {tabs.length > 1 ? (
            <div className="mb-5 grid grid-cols-3 gap-1.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-1.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.value === provider;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => {
                      setProvider(tab.value);
                      setError(null);
                    }}
                    className={cn(
                      'focus-ring relative flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11.5px] font-medium transition-colors',
                      active ? 'text-[var(--text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="login-tab"
                        className="absolute inset-0 rounded-xl border border-[var(--line)] bg-[var(--elevated)] shadow-soft"
                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      />
                    ) : null}
                    <Icon className="relative h-4 w-4" />
                    <span className="relative">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <form onSubmit={submit} className="space-y-4">
            <Field label="用户名">
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={provider === 'local' ? 'admin' : 'OpenList 用户名'}
                  autoComplete="username"
                  className="pl-9"
                  required
                />
              </div>
            </Field>

            <Field label="密码">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pl-9"
                  required
                />
              </div>
            </Field>

            {needsOtp ? (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <Field label="两步验证码">
                  <Input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6 位动态验证码"
                    inputMode="numeric"
                    maxLength={6}
                    className="tracking-[0.4em]"
                  />
                </Field>
              </motion.div>
            ) : null}

            {error || bootError ? (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-3 py-2.5 text-[12.5px] text-[var(--danger)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error ?? bootError}</span>
              </motion.div>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={authBusy}>
              {authBusy ? '正在登录…' : '进入工作台'}
              {!authBusy ? <LogIn className="h-4 w-4" /> : <Loader2 className="hidden" />}
            </Button>
          </form>

          <div className="mt-5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-[var(--faint)]">
              <Badge tone={openlist.tone}>
                <Cloud className="h-3 w-3" />
                {openlist.label}
              </Badge>
              <Badge tone={providers?.local ? 'accent' : 'neutral'}>
                <HardDrive className="h-3 w-3" />
                {providers?.local ? '本地账户已启用' : '本地账户已禁用'}
              </Badge>
              {tabs.length ? (
                <span className="whitespace-nowrap">
                  {tabs.find((tab) => tab.value === provider)?.hint ?? tabs[0]?.hint}
                </span>
              ) : null}
            </div>

            {openlist.state !== 'online' ? (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'rounded-xl border px-3 py-2 text-[11.5px] leading-relaxed',
                  openlist.state === 'unconfigured'
                    ? 'border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-[var(--warn)]'
                    : 'border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]',
                )}
              >
                {openlist.hint}
              </motion.div>
            ) : null}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
