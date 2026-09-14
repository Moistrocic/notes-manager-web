import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  FileText,
  Folder,
  FolderPlus,
  Layers,
  LogOut,
  Moon,
  Plus,
  Settings,
  Star,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Badge, Button, Input, Tooltip } from './ui/primitives';
import { StatusDetail, StatusPill } from './StatusPill';

export function Sidebar() {
  const user = useAppStore((s) => s.user);
  const status = useAppStore((s) => s.status);
  const notes = useAppStore((s) => s.notes);
  const tags = useAppStore((s) => s.tags);
  const folders = useAppStore((s) => s.folders);
  const stats = useAppStore((s) => s.stats);
  const activeTag = useAppStore((s) => s.activeTag);
  const activeFolder = useAppStore((s) => s.activeFolder);
  const favoriteOnly = useAppStore((s) => s.favoriteOnly);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setActiveTag = useAppStore((s) => s.setActiveTag);
  const setActiveFolder = useAppStore((s) => s.setActiveFolder);
  const setFavoriteOnly = useAppStore((s) => s.setFavoriteOnly);
  const setTrashOpen = useAppStore((s) => s.setTrashOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const createNote = useAppStore((s) => s.createNote);
  const createFolder = useAppStore((s) => s.createFolder);
  const deleteFolder = useAppStore((s) => s.deleteFolder);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const logout = useAppStore((s) => s.logout);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [showTags, setShowTags] = useState(true);

  const favoriteCount = notes.filter((n) => n.favorite).length;
  const pinnedCount = notes.filter((n) => n.pinned).length;

  const navItems = [
    {
      id: 'all',
      label: '全部笔记',
      icon: Layers,
      count: stats?.notes ?? notes.length,
      active: !favoriteOnly && activeTag === null && activeFolder === null,
      onClick: () => {
        setFavoriteOnly(false);
        setActiveTag(null);
        setActiveFolder(null);
      },
    },
    {
      id: 'favorite',
      label: '收藏',
      icon: Star,
      count: favoriteCount,
      active: favoriteOnly,
      onClick: () => {
        setFavoriteOnly(true);
        setActiveTag(null);
        setActiveFolder(null);
      },
    },
  ];

  return (
    <aside className="flex h-full w-full flex-col gap-3 p-3">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-1 pt-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-soft">
          <FileText className="h-4.5 w-4.5" style={{ height: 18, width: 18 }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold tracking-tight">笔记管理面板</div>
          <div className="truncate text-[10.5px] text-[var(--faint)]">
            {status?.storage.driver === 'openlist' ? 'OpenList 驱动' : '本地驱动'} · v{status?.version ?? '—'}
          </div>
        </div>
        <Tooltip label="收起侧栏">
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={() => toggleSidebar(false)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      {/* New note */}
      <Button
        variant="primary"
        size="lg"
        className="w-full justify-center"
        onClick={() => void createNote({ folder: activeFolder ?? undefined })}
      >
        <Plus className="h-4 w-4" />
        新建笔记
      </Button>

      {/* Nav */}
      <nav className="space-y-0.5">
        {navItems.map(({ id, ...item }) => (
          <SidebarItem key={id} {...item} />
        ))}
        <SidebarItem
          label="回收站"
          icon={Trash2}
          count={undefined}
          active={false}
          onClick={() => setTrashOpen(true)}
        />
      </nav>

      <div className="scroll-area -mr-1 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* Folders */}
        <section>
          <div className="mb-1.5 flex items-center justify-between px-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">文件夹</span>
            <button
              type="button"
              onClick={() => setAddingFolder((v) => !v)}
              className="focus-ring rounded-md p-0.5 text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
              aria-label="新建文件夹"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>
          <AnimatePresence initial={false}>
            {addingFolder ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden px-1 pb-1.5"
              >
                <Input
                  autoFocus
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && folderName.trim()) {
                      void createFolder(folderName.trim());
                      setFolderName('');
                      setAddingFolder(false);
                    }
                    if (e.key === 'Escape') setAddingFolder(false);
                  }}
                  placeholder="文件夹名称，回车创建"
                  className="h-8 text-[12px]"
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="space-y-0.5">
            {folders.length === 0 && !addingFolder ? (
              <p className="px-2 py-1 text-[11px] text-[var(--faint)]">还没有文件夹</p>
            ) : null}
            {folders.map((folder) => (
              <div key={folder.path} className="group/folder relative">
                <SidebarItem
                  label={folder.name}
                  icon={Folder}
                  count={folder.count}
                  active={activeFolder === folder.path}
                  onClick={() => {
                    setActiveFolder(activeFolder === folder.path ? null : folder.path);
                    setFavoriteOnly(false);
                    setActiveTag(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => void deleteFolder(folder.path)}
                  className="focus-ring absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--faint)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover/folder:opacity-100"
                  aria-label={`删除文件夹 ${folder.path}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Tags */}
        <section>
          <button
            type="button"
            onClick={() => setShowTags((v) => !v)}
            className="mb-1.5 flex w-full items-center justify-between px-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)] transition-colors hover:text-[var(--muted)]"
          >
            <span>标签</span>
            <span className="text-[10px]">{tags.length}</span>
          </button>
          <AnimatePresence initial={false}>
            {showTags ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap gap-1.5 overflow-hidden px-1.5"
              >
                {tags.length === 0 ? (
                  <p className="px-0.5 py-1 text-[11px] text-[var(--faint)]">暂无标签</p>
                ) : null}
                {tags.slice(0, 24).map((tag) => {
                  const active = activeTag === tag.tag;
                  return (
                    <motion.button
                      key={tag.tag}
                      layout
                      type="button"
                      onClick={() => {
                        setActiveTag(active ? null : tag.tag);
                        setFavoriteOnly(false);
                        setActiveFolder(null);
                      }}
                      whileHover={{ y: -1 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        'focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                        active
                          ? 'border-transparent bg-[var(--accent)] text-white'
                          : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
                      )}
                    >
                      #{tag.tag}
                      <span className={cn('text-[9.5px]', active ? 'text-white/70' : 'text-[var(--faint)]')}>
                        {tag.count}
                      </span>
                    </motion.button>
                  );
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </div>

      {/* Footer */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Badge tone="accent">{formatNumber(stats?.words ?? 0)} 字</Badge>
          {pinnedCount > 0 ? <Badge tone="neutral">{pinnedCount} 置顶</Badge> : null}
        </div>
        <StatusPill status={status?.storage} onRefresh={() => void refreshStatus()} />
        <StatusDetail status={status?.storage} />

        <div className="flex items-center gap-1.5 rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <UserRound className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium">{user?.displayName ?? user?.username ?? '—'}</div>
            <div className="truncate text-[10px] text-[var(--faint)]">
              {user?.provider === 'openlist' ? 'OpenList 账户' : '本地管理员'}
              {user?.role === 'admin' ? ' · 管理员' : ''}
            </div>
          </div>
          <Tooltip label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </Tooltip>
          {user?.role === 'admin' ? (
            <Tooltip label="设置">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="focus-ring flex h-7 w-7 items-center justify-center rounded-xl text-[var(--faint)] transition-colors hover:text-[var(--accent)]"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label="退出登录">
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
    </aside>
  );
}

function SidebarItem({
  label,
  icon: Icon,
  count,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'focus-ring group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors',
        active ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]',
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      ) : null}
      <Icon className={cn('relative h-4 w-4 shrink-0', active && 'text-[var(--accent)]')} />
      <span className="relative flex-1 truncate">{label}</span>
      {typeof count === 'number' && count > 0 ? (
        <span className="relative rounded-md bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-0.5 text-[10.5px] text-[var(--faint)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}
