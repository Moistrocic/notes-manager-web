import { AnimatePresence, motion } from 'framer-motion';
import { FilePlus2, LogIn, Menu, PanelLeftOpen, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppearanceDialog } from './components/AppearanceDialog';
import { Aurora } from './components/Aurora';
import { Wallpaper } from './components/Wallpaper';
import { WallpaperLoading } from './components/WallpaperLoading';
import { CommandPalette } from './components/CommandPalette';
import { Editor } from './components/Editor';
import { LoginScreen } from './components/LoginScreen';
import { NotesPanel } from './components/NoteList';
import { SettingsDialog } from './components/SettingsDialog';
import { Toasts } from './components/Toasts';
import { TrashDialog } from './components/TrashDialog';
import { Button, Tooltip } from './components/ui/primitives';
import { useHotkeys } from './hooks/useHotkeys';
import { useMediaQuery } from './hooks/useMediaQuery';
import { applyAccent, applyAurora } from './lib/accent';
import { shownWallpaper } from './lib/admin-background';
import { cn } from './lib/cn';
import { homeUrl, isManagerPath, noteUrl } from './lib/url';
import { useAppStore } from './store/useAppStore';

/**
 * Which of the three front doors is showing.
 *
 * Two addresses, two jobs: `/` is the site's own front page - blank for now,
 * carrying nothing but the way in - and `/manager/…` is the panel, where what
 * follows the prefix is the note, exactly as it was before. The address decides
 * which one is on screen, so a link to `/manager/…` opens the note and a link
 * to `/` does not open the panel behind the visitor's back.
 */
type Entry = 'landing' | 'login' | 'panel';

export default function App() {
  const booted = useAppStore((s) => s.booted);
  const user = useAppStore((s) => s.user);
  const boot = useAppStore((s) => s.boot);
  const settings = useAppStore((s) => s.wallpaper);
  const admin = useAppStore((s) => s.adminBackground);
  // The same overlay the background layer uses, so the theme's own background
  // takes the administrator's colours when theirs is the one showing.
  const wallpaper = shownWallpaper(settings, admin);
  const accent = useAppStore((s) => s.accent);
  // Every hook is called on every render. Reading the url inside the && would
  // call useAppStore only when a wallpaper is set, so the hook count would
  // change the moment boot() loads one and React would unmount the whole tree.
  const wallpaperUrl = useAppStore((s) => s.wallpaperUrl);
  // The layer shows the administrator's file when theirs is the one in use, and
  // the user's own URL otherwise - the theme's background has neither.
  const layerUrl = wallpaper === settings ? wallpaperUrl : wallpaper.url;
  const wallpaperActive = wallpaper.kind !== 'none' && Boolean(layerUrl);
  const [entered, setEntered] = useState(() =>
    typeof window === 'undefined' ? false : isManagerPath(window.location.pathname),
  );
  useHotkeys();

  // The visitor is inside the panel's address. Whether that shows the panel or
  // the sign-in card is then only a question of whether there is a session.
  const entry: Entry = !entered ? 'landing' : user ? 'panel' : 'login';

  /** Into the panel, address bar and all, so the link is shareable. */
  const enterManager = () => {
    const target = noteUrl(null);
    if (typeof window !== 'undefined' && window.location.pathname !== target) {
      window.history.pushState(null, '', target);
    }
    setEntered(true);
  };

  /** Back to the front page, which is where the login card's exit leads. */
  const leaveManager = () => {
    if (typeof window !== 'undefined' && window.location.pathname !== homeUrl()) {
      window.history.replaceState(null, '', homeUrl());
    }
    setEntered(false);
  };

  // One place decides the interface colour: the wallpaper's own when that is
  // turned on, the user's pick when it is off, the theme's colour otherwise.
  useEffect(() => {
    applyAccent(wallpaper.autoAccent ? accent : wallpaper.accentColor || null);
  }, [wallpaper.autoAccent, wallpaper.accentColor, accent]);

  // Only while the built-in background is the one showing; a wallpaper covers it.
  useEffect(() => {
    const live = wallpaper.kind === 'none';
    applyAurora(live ? wallpaper.auroraA : '', live ? wallpaper.auroraB : '');
  }, [wallpaper.kind, wallpaper.auroraA, wallpaper.auroraB]);

  // Fades the aurora down while a wallpaper is showing.
  useEffect(() => {
    document.documentElement.classList.toggle('wallpaper-on', wallpaperActive);
  }, [wallpaperActive]);

  useEffect(() => {
    void boot();
  }, [boot]);

  // The address bar is the source of truth for what is on screen: the back
  // button walks through the notes, and walking back past `/manager/` leaves
  // the panel for the front page.
  useEffect(() => {
    const onPopState = () => {
      setEntered(isManagerPath(window.location.pathname));
      if (useAppStore.getState().user) void useAppStore.getState().openFromLocation();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Wallpaper />
      <Aurora />
      <AnimatePresence mode="wait">
        {!booted ? (
          <Splash key="splash" />
        ) : entry === 'panel' ? (
          <Workspace key="workspace" />
        ) : entry === 'login' ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 h-full overflow-y-auto"
          >
            <LoginScreen onClose={leaveManager} />
          </motion.div>
        ) : (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 h-full w-full"
          >
            <LandingPage url={noteUrl(null)} onEnter={enterManager} />
          </motion.div>
        )}
      </AnimatePresence>
      <Toasts />
      <WallpaperLoading />
      <CommandPalette />
      <SettingsDialog />
      <AppearanceDialog />
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
          only exists while a note is open. A slim vertical grip on the left edge
          rather than a pill: it is out of the way of every heading, and it can
          be dragged to wherever it is not in the way at all. */}
      {!sidebarOpen && !focusMode ? <PanelHandle /> : null}

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

/** Where the grip on the left edge was last left. */
const HANDLE_KEY = 'notes-manager-panel-handle-top';

/** Keeps the grip on screen, whatever the window has become since. */
function clampHandleTop(value: number): number {
  if (typeof window === 'undefined') return value;
  const limit = Math.max(8, window.innerHeight - 72);
  return Math.max(8, Math.min(Math.round(value), limit));
}

function readHandleTop(): number {
  const fallback = typeof window === 'undefined' ? 320 : Math.round(window.innerHeight / 2) - 28;
  try {
    const raw = localStorage.getItem(HANDLE_KEY);
    const value = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(value) ? clampHandleTop(value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The way back to the note list, as a slim vertical grip on the left edge.
 *
 * A pill with a label in the corner used to do this, and it sat on top of
 * whatever the editor put there. A flat grip takes almost no room, and since
 * the one place it can be is a matter of taste, holding it down picks it up and
 * it stays where it is dropped.
 */
function PanelHandle() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const [top, setTop] = useState(readHandleTop);
  const [dragging, setDragging] = useState(false);
  const topRef = useRef(top);
  const press = useRef<{ y: number; top: number; long: boolean; moved: boolean; timer: number } | null>(null);
  // A press long enough to drag still ends with a click; that one must not
  // also open the list.
  const swallowClick = useRef(false);
  topRef.current = top;

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const startTop = topRef.current;
    press.current = {
      y: event.clientY,
      top: startTop,
      long: false,
      moved: false,
      timer: window.setTimeout(() => {
        if (!press.current) return;
        press.current.long = true;
        setDragging(true);
      }, 380),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = press.current;
    if (!state?.long) return;
    if (Math.abs(event.clientY - state.y) > 3) state.moved = true;
    setTop(clampHandleTop(state.top + (event.clientY - state.y)));
  };

  const release = (cancelled: boolean) => {
    const state = press.current;
    press.current = null;
    if (!state) return;
    window.clearTimeout(state.timer);
    if (!state.long) return;
    setDragging(false);
    swallowClick.current = true;
    if (state.moved && !cancelled) {
      try {
        localStorage.setItem(HANDLE_KEY, String(Math.round(topRef.current)));
      } catch {
        /* a browser with no storage still remembers it for this session */
      }
    }
  };

  const label = dragging ? '拖动到合适的位置，松开后固定' : '显示笔记列表（长按可移动位置）';

  return (
    <button
      type="button"
      aria-label={label}
      aria-grabbed={dragging || undefined}
      data-panel-handle
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => release(false)}
      onPointerCancel={() => release(true)}
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        toggleSidebar(true);
      }}
      style={{ top: clampHandleTop(top) }}
      className={cn(
        'glass focus-ring fixed -left-px z-30 flex h-14 items-center justify-center rounded-r-full shadow-strong transition-[width,background-color] duration-200',
        dragging ? 'w-4 cursor-grabbing opacity-90' : 'w-2.5 cursor-pointer hover:w-4',
      )}
    >
      <span className="h-6 w-[2px] rounded-full bg-[color-mix(in_srgb,var(--text)_30%,transparent)]" />
    </button>
  );
}

/**
 * The site's front page, still to be written.
 *
 * Deliberately blank: what belongs here is a page of its own, and until that
 * exists the only thing this one carries is the way into the panel - the same
 * door for signing in and for coming back once signed in.
 */
function LandingPage({ url, onEnter }: { url: string; onEnter: () => void }) {
  return (
    <Tooltip label="进入管理面板" side="bottom">
      {/* A real link, so the panel has an address that can be kept, shared and
          opened in a new tab - the click only saves it the page load. */}
      <a
        href={url}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onEnter();
        }}
        aria-label="管理面板登录入口"
        data-panel-entry
        className="glass focus-ring fixed right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-2xl text-[var(--muted)] shadow-soft transition-colors hover:text-[var(--accent)]"
      >
        <LogIn className="h-4 w-4" />
      </a>
    </Tooltip>
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
