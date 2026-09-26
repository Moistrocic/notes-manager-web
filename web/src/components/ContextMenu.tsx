import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

/**
 * The app's own right-click menu.
 *
 * The browser menu offers "reload", "view source" and "save image as" inside a
 * note editor or a note tree, none of which mean anything there. Every menu in
 * the app is one component so they all draw the same way and all close the same
 * way: an item runs, then the menu goes.
 */
export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  /** A right-aligned hint, such as a key combination. */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Draws a line above this item, to group the menu into blocks. */
  separatorBefore?: boolean;
  run: () => void | Promise<void>;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** A line at the top naming what was right-clicked. */
  title?: string;
}

/** Anything with pointer coordinates - a mouse event, or a synthesised one. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
}

const MARGIN = 8;

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Placed after measuring: a menu opened near the right or bottom edge has to
  // come back inside the window rather than hang off it.
  useLayoutEffect(() => {
    if (!state) {
      setPosition(null);
      return;
    }
    const box = ref.current?.getBoundingClientRect();
    const width = box?.width ?? 200;
    const height = box?.height ?? state.items.length * 30 + 12;
    const maxLeft = (typeof window === 'undefined' ? 1024 : window.innerWidth) - width - MARGIN;
    const maxTop = (typeof window === 'undefined' ? 768 : window.innerHeight) - height - MARGIN;
    setPosition({
      left: Math.max(MARGIN, Math.min(state.x, maxLeft)),
      top: Math.max(MARGIN, Math.min(state.y, maxTop)),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [state, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {state ? (
        <div className="fixed inset-0 z-[130]" data-context-menu-backdrop>
          {/* A press anywhere else dismisses: the menu is a decision, not a mode. */}
          <div
            className="absolute inset-0"
            onPointerDown={onClose}
            onContextMenu={(event) => {
              event.preventDefault();
              onClose();
            }}
          />
          <motion.div
            ref={ref}
            role="menu"
            data-context-menu
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            style={{ left: position?.left ?? state.x, top: position?.top ?? state.y }}
            // Opaque and darker than the panel behind it: the note text under
            // a translucent menu showed through and made both hard to read.
            className="absolute z-[131] min-w-[184px] max-w-[280px] rounded-2xl border border-[var(--line-strong)] bg-[var(--menu-bg)] p-1.5 shadow-strong"
          >
            {state.title ? (
              <div className="truncate px-2.5 pb-1 pt-1 text-[10.5px] text-[var(--faint)]">{state.title}</div>
            ) : null}
            {state.items.map((item) => (
              <div key={item.id}>
                {item.separatorBefore ? <div className="my-1 h-px bg-[var(--line)]" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item={item.id}
                  disabled={item.disabled}
                  onClick={() => {
                    onClose();
                    void item.run();
                  }}
                  className={cn(
                    'focus-ring flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    item.danger
                      ? 'text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]'
                      : 'text-[var(--muted)] hover:bg-[color-mix(in_srgb,var(--text)_7%,transparent)] hover:text-[var(--text)]',
                  )}
                >
                  {item.icon ? (
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut ? <span className="shrink-0 text-[10.5px] text-[var(--faint)]">{item.shortcut}</span> : null}
                </button>
              </div>
            ))}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Opens the menu above whatever was right-clicked.
 *
 * A hook rather than a wrapper component: a row has to decide its own items -
 * which change with what is selected - at the moment of the right-click.
 */
export function useContextMenu() {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((anchor: MenuAnchor, items: ContextMenuItem[], title?: string) => {
    anchor.preventDefault?.();
    setState({ x: anchor.clientX, y: anchor.clientY, items, title });
  }, []);
  return { menu: state, openMenu: open, closeMenu: close };
}
