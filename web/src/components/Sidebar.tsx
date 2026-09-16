import { FileText, ImagePlus, LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Tooltip } from './ui/primitives';

/** Account, storage state and the app level actions. */
export function SessionFooter() {
  const user = useAppStore((s) => s.user);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setAppearanceOpen = useAppStore((s) => s.setAppearanceOpen);
  const logout = useAppStore((s) => s.logout);

  return (
    <div className="space-y-2">
      {/* The storage card used to sit here. Where notes are kept is a badge
          beside the version now, and the connection detail belongs with the
          server settings rather than in the list of notes. */}
      <div className="flex items-center gap-1.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          {user?.openlistGuest ? <FileText className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium">{user?.displayName ?? user?.username ?? '—'}</div>
          <div className="truncate text-[10px] text-[var(--faint)]">
            {user?.guest
              ? user.openlistGuest
                ? 'OpenList 游客'
                : '游客（只读）'
              : user?.provider === 'openlist'
                ? 'OpenList 账户'
                : '本地管理员'}
            {user?.role === 'admin' ? ' · 管理员' : ''}
            {user?.openlistBasePath && user.openlistBasePath !== '/' ? ` · ${user.openlistBasePath}` : ''}
          </div>
        </div>
        <Tooltip label="外观（壁纸）" side="top">
          <button
            type="button"
            onClick={() => setAppearanceOpen(true)}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip label={theme === 'dark' ? '切换到亮色' : '切换到暗色'} side="top">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </Tooltip>
        {user?.role === 'admin' ? (
          <Tooltip label="设置" side="top">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip label="退出登录" side="top">
          <button
            type="button"
            onClick={() => void logout()}
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--danger)]"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
