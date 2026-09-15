import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { cn } from '../../lib/cn';

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */
type ButtonVariant = 'primary' | 'ghost' | 'soft' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent-2)_70%,var(--accent))] shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--accent)_80%,transparent)] hover:brightness-110',
  soft: 'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  ghost: 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]',
  outline: 'border border-[var(--line-strong)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
  danger: 'text-white bg-[var(--danger)] hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-2xl',
  icon: 'h-9 w-9 rounded-xl justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'soft',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  hint,
  ...rest
}: ButtonProps & {
  /**
   * The hover label. A button's hint belongs in a Tooltip like every other one
   * in the app; the native title attribute draws an unstyleable box that looks
   * nothing like the rest.
   */
  hint?: string;
}) {
  const button = (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'focus-ring inline-flex select-none items-center font-medium transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
  return hint ? <Tooltip label={hint}>{button}</Tooltip> : button;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */
export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cn(
        'focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] px-3 text-sm text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--faint)] focus:border-[var(--accent)]',
        className,
      )}
    />
  );
}

/**
 * A dropdown.
 *
 * One component so every select in the app agrees on height, radius, border and
 * colour; the arrow is ours rather than the platform's, which is what made a
 * bare <select> look like it came from a different application.
 */
export function Select({
  className,
  containerClassName,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { containerClassName?: string }) {
  return (
    <div className={cn('relative', containerClassName)}>
      <select
        {...rest}
        className={cn(
          'focus-ring h-10 w-full cursor-pointer appearance-none rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] pl-3 pr-8 text-sm text-[var(--text)] outline-none transition-all duration-200 hover:border-[var(--line-strong)] focus:border-[var(--accent)]',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint)]" />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between text-[12.5px] font-medium text-[var(--muted)]">
        <span>{label}</span>
        {hint ? <span className="font-normal text-[var(--faint)]">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring group inline-flex items-center gap-2.5 rounded-xl py-1 text-sm text-[var(--text)]',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-300',
          checked ? 'border-transparent bg-[var(--accent)]' : 'border-[var(--line-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-[rgba(4,7,16,0.55)] backdrop-blur-md"
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn(
              'relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel-solid)] shadow-strong',
              width,
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-4">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">{title}</h2>
                {subtitle ? <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{subtitle}</p> : null}
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </header>
            <div className="scroll-area flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer ? <footer className="border-t border-[var(--line)] px-6 py-4">{footer}</footer> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-lg', className)} />;
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[var(--muted)]',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    success: 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)]',
    warn: 'bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-[var(--warn)]',
    danger: 'bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A hover label.
 *
 * `side` matters more than it looks: the left panel animates its width, so it
 * carries overflow-hidden, and a label opening downward from the last row is
 * clipped by that panel (and by the bottom of the window). Rows that sit
 * against such an edge ask for "top" instead.
 */
/** Any class that takes an element out of the normal flow. */
const POSITION_CLASS = /\b(?:static|fixed|absolute|relative|sticky)\b/;

/**
 * A label that appears on hover.
 *
 * Rendered into the document body and positioned from the trigger's own
 * rectangle. An absolutely positioned bubble inside the trigger cannot escape
 * an ancestor with overflow hidden - which is what an expanding folder row is -
 * so tooltips in the note tree were being cut off by the very container they
 * were describing.
 */
export function Tooltip({
  label,
  children,
  side = 'bottom',
  className,
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  /**
   * Goes on the wrapper. The wrapper is a positioned element, so a child that
   * wants to be absolutely placed has to say so here instead - otherwise its
   * offsets resolve against this span rather than the box it meant.
   *
   * Supplying a position class replaces the default rather than joining it:
   * cn() is clsx and does not merge, so "relative" and "absolute" would both be
   * emitted and the one later in Tailwind's output would win - which is
   * "relative", putting the wrapper back in the flow and pushing its siblings
   * out of place.
   */
  className?: string;
}) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({
      left: rect.left + rect.width / 2,
      top: side === 'top' ? rect.top - 6 : rect.bottom + 6,
    });
  };

  // A tooltip is decoration; the control it describes still needs a name of its
  // own, or it has none at all to a screen reader - and none in the markup once
  // the bubble only exists while hovered. Supplied here so every call site gets
  // it without having to remember.
  const named =
    isValidElement(children) && (children.props as { 'aria-label'?: string })['aria-label'] === undefined
      ? cloneElement(children as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': label })
      : children;

  return (
    <span
      ref={anchor}
      className={cn(POSITION_CLASS.test(className ?? '') ? 'inline-flex' : 'relative inline-flex', className)}
      onPointerEnter={show}
      onPointerLeave={() => setAt(null)}
      onPointerDown={() => setAt(null)}
    >
      {named}
      {at && typeof document !== 'undefined'
        ? createPortal(
            <span
              role="tooltip"
              style={{ left: at.left, top: at.top }}
              className={cn(
                'pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--elevated)] px-2 py-1 text-[11.5px] text-[var(--muted)] shadow-soft',
                side === 'top' ? '-translate-y-full' : '',
              )}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
