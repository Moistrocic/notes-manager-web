import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * What the background is doing, across the top of the screen.
 *
 * A scene wallpaper is tens of megabytes and several seconds of parsing before
 * the first pixel, which is long enough to look broken - especially on a remote
 * server, where the same work happens over a slower connection. The layer knows
 * how far along it is, so the wait gets a number: a percentage while the
 * container downloads. The phases that follow it cannot be measured from here
 * (parsing, decoding, compositing are single calls into the library), and those
 * say what they are doing over a bar that moves rather than inventing a figure.
 *
 * Nothing appears for the first moment: a wallpaper out of the browser cache
 * would otherwise flash it on every page load.
 */
const DELAY_MS = 400;

export function WallpaperLoading() {
  const loading = useAppStore((s) => s.wallpaperLoading);
  const [visible, setVisible] = useState(false);
  // Whether a load is in progress, rather than which one: the layer reports a
  // new object for every progress update, and restarting the timer on each of
  // them meant the badge never appeared at all while a download was running.
  const active = loading !== null;

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!loading || !visible) return null;
  const percent = loading.ratio === null ? null : Math.round(Math.min(1, Math.max(0, loading.ratio)) * 100);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4" role="status" aria-live="polite">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel-solid)_92%,transparent)] px-4 py-3 shadow-strong backdrop-blur">
        <div className="flex items-baseline gap-3">
          <Loader2 className="h-3.5 w-3.5 shrink-0 translate-y-0.5 animate-spin text-[var(--accent)]" />
          <span className="min-w-0 flex-1 text-[12.5px] text-[var(--text)]">{loading.label}</span>
          {percent === null ? null : (
            <span className="shrink-0 font-mono text-[17px] font-semibold leading-none tabular-nums text-[var(--accent)]">
              {percent}%
            </span>
          )}
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]">
          {percent === null ? (
            <span className="progress-unknown block h-full w-2/5 rounded-full" />
          ) : (
            <span
              className="block h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}