import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useEffect } from 'react';
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

export function Button({ variant = 'soft', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
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

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cn(
        'focus-ring scroll-area w-full resize-none rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] p-3 text-sm text-[var(--text)] outline-none transition-all duration-200 placeholder:text-[var(--faint)] focus:border-[var(--accent)]',
        className,
      )}
    />
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
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="focus-ring group inline-flex items-center gap-2.5 rounded-xl py-1 text-sm text-[var(--text)]"
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

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative inline-flex items-center gap-1 rounded-xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-ring relative z-10 inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors duration-200',
              active ? 'text-[var(--text)]' : 'text-[var(--faint)] hover:text-[var(--muted)]',
            )}
          >
            {active ? (
              <motion.span
                layoutId={`seg-${options.map((o) => o.value).join('')}`}
                className="absolute inset-0 -z-10 rounded-lg border border-[var(--line)] bg-[var(--elevated)] shadow-soft"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
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

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-40 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg border border-[var(--line)] bg-[var(--elevated)] px-2 py-1 text-[11.5px] text-[var(--muted)] opacity-0 shadow-soft transition-all duration-150 group-hover/tip:translate-y-0 group-hover/tip:opacity-100">
        {label}
      </span>
    </span>
  );
}
