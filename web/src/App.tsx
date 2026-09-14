import { AnimatePresence, motion } from 'framer-motion';
import { FilePlus2, Menu, PanelLeftOpen, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Aurora } from './components/Aurora';
import { CommandPalette } from './components/CommandPalette';
import { Editor } from './components/Editor';
import { LoginScreen } from './components/LoginScreen';
import { NotesPanel } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { Toasts } from './components/Toasts';
import { TrashDialog } from './components/TrashDialog';
import { Button } from './components/ui/primitives';
import { useHotkeys } from './hooks/useHotkeys';
import { useMediaQuery } from './hooks/useMediaQuery';
import { cn } from './lib/cn';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const booted = useAppStore((s) => s.booted);
  const user = useAppStore((s) => s.user);
  const boot = useAppStore((s) => s.boot);
  useHotkeys();

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Aurora />
      <AnimatePresence mode="wait">
        {!booted ? (
          <Splash key="splash" />
        ) : user ? (
          <Workspace key="workspace" />
        ) : (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 h-full overflow-y-auto"
          >
            <LoginScreen />
          </motion.div>
        )}
      </AnimatePresence>
      <Toasts />
      <CommandPalette />
      <SettingsDialog />
      <TrashDialog />
    </div>
  );
}

function Splash() {
  return (
    <motion.div
      key="splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative z-10 flex h-full flex-col items-center justify-center gap-5"
    >
      <motion.div
        animate={{ scale: [1, 1.06, 1], rotate: [0, 3, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-strong"
      >
        <Sparkles className="h-7 w-7" />
      </motion.div>
      <div className="text-center">
        <div className="gradient-text text-[17px] font-semibold">笔记管理面板</div>
        <div className="mt-1 text-[12px] text-[var(--faint)]">正在连接存储…</div>
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">
        <motion.div
          className="h-full w-1/2 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </motion.div>
  );
}

function Workspace() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const activeNote = useAppStore((s) => s.activeNote);
  const closeNote = useAppStore((s) => s.closeNote);
  const focusMode = useAppStore((s) => s.focusMode);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    if (!isDesktop) toggleSidebar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  return (
    <motion.div
      key="workspace"
      initial={{ opacity: 0, scale: 0.995 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10 flex h-full w-full gap-3 p-3"
    >
      {/* Single left column: navigation + list. Collapsible as a whole. */}
      <AnimatePresence initial={false}>
        {sidebarOpen && isDesktop ? (
          <motion.div
            key="left-panel"
            initial={{ width: 0, opacity: 0, x: -24 }}
            animate={{ width: 340, opacity: 1, x: 0 }}
            exit={{ width: 0, opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="hidden shrink-0 overflow-hidden lg:block"
          >
            <div className="glass h-full w-[340px] rounded-3xl shadow-soft">
              <NotesPanel />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Editor */}
      <div className="glass relative flex min-w-0 flex-1 overflow-hidden rounded-3xl shadow-soft">
        <div className={cn('flex min-w-0 flex-1 flex-col', !activeNote && 'hidden lg:flex')}>
          <AnimatePresence mode="wait">
            {activeNote ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
                className="flex min-h-0 flex-1"
              >
                <Editor />
              </motion.div>
            ) : (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hidden min-w-0 flex-1 lg:flex"
              >
                <EmptyWorkspace />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile: the list takes the whole area until a note is opened */}
        {!activeNote ? (
          <div className="flex w-full min-w-0 flex-col lg:hidden">
            <div className="flex items-center gap-2 px-3 pt-3">
              <Button variant="ghost" size="icon" onClick={() => toggleSidebar(true)} aria-label="打开侧栏">
                <Menu className="h-4 w-4" />
              </Button>
              <span className="text-[13px] font-medium">笔记</span>
            </div>
            <div className="min-h-0 flex-1">
              <NotesPanel />
            </div>
          </div>
        ) : null}
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && !isDesktop ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => toggleSidebar(false)}
              className="absolute inset-0 bg-[rgba(4,7,16,0.5)] backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: -320, opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="glass absolute inset-y-0 left-0 w-[320px] rounded-r-3xl shadow-strong"
            >
              <NotesPanel />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Always available way back to the list - the button in the editor header
          only exists while a note is open. */}
      {!sidebarOpen && !focusMode ? (
        <motion.button
          type="button"
          initial={{ opacity: 0, x: -14 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -14 }}
          onClick={() => toggleSidebar(true)}
          title="显示笔记列表"
          className="glass focus-ring fixed left-4 top-4 z-30 flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-medium shadow-strong"
        >
          <PanelLeftOpen className="h-4 w-4" />
          显示列表
        </motion.button>
      ) : null}

      {/* Floating "back to list" for small screens */}
      {activeNote && !isDesktop ? (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={closeNote}
          className="glass fixed bottom-5 left-5 z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-[12.5px] font-medium shadow-strong lg:hidden"
        >
          <PanelLeftOpen className="h-4 w-4" />
          返回列表
        </motion.button>
      ) : null}
    </motion.div>
  );
}

function EmptyWorkspace() {
  const createNote = useAppStore((s) => s.createNote);
  const stats = useAppStore((s) => s.stats);
  const user = useAppStore((s) => s.user);
  const status = useAppStore((s) => s.status);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center px-10 text-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <div className="float-y mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-strong">
          <FilePlus2 className="h-9 w-9" />
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight">
          你好，<span className="gradient-text">{user?.displayName ?? user?.username}</span>
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-[var(--muted)]">
          从左侧选择一篇笔记，或创建新的笔记。内容会实时保存到
          {status?.storage.driver === 'openlist' ? ' OpenList 目录。' : ' 服务器本地目录。'}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" size="lg" onClick={() => void createNote()}>
            <FilePlus2 className="h-4 w-4" />
            新建笔记
          </Button>
          <Button variant="outline" size="lg" onClick={() => setPaletteOpen(true)}>
            打开命令面板
            <kbd className="rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </Button>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[11.5px] text-[var(--faint)]">
          <span>{stats?.notes ?? 0} 篇笔记</span>
          <span>·</span>
          <span>{stats?.tags ?? 0} 个标签</span>
          <span>·</span>
          <span>{stats?.folders ?? 0} 个文件夹</span>
          {stats?.updatedAt ? (
            <>
              <span>·</span>
              <span>最近更新 {new Date(stats.updatedAt).toLocaleDateString('zh-CN')}</span>
            </>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
