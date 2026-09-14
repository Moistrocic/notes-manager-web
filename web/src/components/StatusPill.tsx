import { motion } from 'framer-motion';
import { AlertTriangle, Cloud, CloudOff, HardDrive, RefreshCw } from 'lucide-react';
import { cn } from '../lib/cn';
import type { StorageStatus } from '../lib/types';

export function StatusPill({
  status,
  onRefresh,
  compact,
}: {
  status: StorageStatus | null | undefined;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  if (!status) {
    return <div className="shimmer h-9 rounded-xl" />;
  }
  const isOpenList = status.driver === 'openlist';
  const Icon = isOpenList ? Cloud : status.degraded ? CloudOff : HardDrive;
  const tone = isOpenList
    ? 'text-[var(--success)]'
    : status.degraded
      ? 'text-[var(--warn)]'
      : 'text-[var(--muted)]';

  return (
    <div
      className={cn(
        'group flex items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] px-3 py-2',
        compact && 'px-2.5 py-1.5',
      )}
    >
      <span className={cn('relative flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,currentColor_14%,transparent)]', tone)}>
        <Icon className="h-3.5 w-3.5" />
        {isOpenList ? <span className="pulse-ring absolute inset-0 rounded-xl" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--text)]">
          {isOpenList ? 'OpenList 存储' : status.degraded ? '本地存储（降级）' : '本地存储'}
        </div>
        <div className="truncate text-[10.5px] text-[var(--faint)]" title={status.displayRoot}>
          {status.displayRoot}
        </div>
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="focus-ring flex h-6 w-6 items-center justify-center rounded-lg text-[var(--faint)] opacity-0 transition-all group-hover:opacity-100 hover:text-[var(--accent)]"
          aria-label="刷新存储状态"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

export function StatusDetail({ status }: { status: StorageStatus | null | undefined }) {
  if (!status) return null;
  const needsToken = status.driver === 'openlist' && !status.tokenAttached;
  return (
    <div className="space-y-1 px-1">
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-[10.5px] leading-relaxed text-[var(--faint)]"
      >
        {status.detail}
        {status.openlist.version ? ` · v${status.openlist.version}` : ''}
      </motion.p>
      {needsToken ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] px-2 py-1.5 text-[10.5px] leading-relaxed text-[var(--warn)]"
        >
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>当前账户没有 OpenList 令牌：请改用 OpenList 账户登录，或在「设置」中填写 API 令牌。</span>
        </motion.p>
      ) : null}
    </div>
  );
}
