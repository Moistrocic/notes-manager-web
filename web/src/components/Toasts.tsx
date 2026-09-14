import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/useAppStore';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const TONES = {
  info: 'text-[var(--accent)]',
  success: 'text-[var(--success)]',
  error: 'text-[var(--danger)]',
};

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(360px,calc(100vw-40px))] flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="glass pointer-events-auto flex items-start gap-3 rounded-2xl px-3.5 py-3 shadow-strong"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONES[toast.tone])} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-[var(--text)]">{toast.title}</div>
                {toast.message ? (
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-[var(--muted)]">
                    {toast.message}
                  </div>
                ) : null}
              </div>
              {toast.action ? (
                <button
                  type="button"
                  onClick={() => {
                    void toast.action?.run();
                    dismiss(toast.id);
                  }}
                  className="focus-ring shrink-0 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[11.5px] font-medium text-[var(--accent)] transition-transform active:scale-95"
                >
                  {toast.action.label}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="focus-ring shrink-0 rounded-md p-0.5 text-[var(--faint)] transition-colors hover:text-[var(--text)]"
                aria-label="关闭提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
