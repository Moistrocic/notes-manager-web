import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

/**
 * What the background is doing, in the corner.
 *
 * A scene wallpaper is tens of megabytes and several seconds of parsing before
 * the first pixel, which is long enough to look broken - especially on a remote
 * server, where the same work happens over a slower connection. The layer knows
 * how far along it is; this says so.
 *
 * Nothing appears for the first moment: most wallpapers come out of the browser
 * cache, and a badge that flashes on every page load is worse than no badge.
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
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70]">
      <div className="flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel-solid)_88%,transparent)] px-3 py-1.5 shadow-soft backdrop-blur">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" />
        <span className="text-[11.5px] text-[var(--muted)]">{loading.label}</span>
        {percent === null ? null : (
          <>
            <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_12%,transparent)]">
              <span
                className="block h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right font-mono text-[11px] text-[var(--faint)]">{percent}%</span>
          </>
        )}
      </div>
    </div>
  );
}