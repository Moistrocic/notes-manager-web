import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { clampCrop, CROP_PRESETS, cropForRatio, type CropRect } from '../lib/wallpaper';

/**
 * Picks the part of a wallpaper that fills the screen.
 *
 * The whole picture is shown, with a rectangle drawn over it: drag inside to
 * move it, drag a corner to resize. The rectangle is the answer to "what will I
 * see", which a zoom slider plus an anchor point could never express - those
 * two fight each other as soon as you zoom.
 *
 * The preview box is given the picture's own aspect ratio, so a point in the
 * box maps to a point in the picture with no letterboxing arithmetic.
 */
export function WallpaperCrop({
  src,
  kind,
  crop,
  onChange,
}: {
  src: string;
  kind: 'image' | 'video' | 'scene';
  crop: CropRect;
  onChange: (crop: CropRect) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; fromX: number; fromY: number; start: CropRect } | null>(
    null,
  );
  // Unknown until the file loads; a scene's real shape is not in the container.
  const [aspect, setAspect] = useState<number | null>(kind === 'scene' ? 16 / 9 : null);

  useEffect(() => {
    setAspect(kind === 'scene' ? 16 / 9 : null);
  }, [src, kind]);

  const begin = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { mode, fromX: event.clientX, fromY: event.clientY, start: crop };
  };

  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    const box = boxRef.current;
    if (!state || !box) return;
    const bounds = box.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const dx = (event.clientX - state.fromX) / bounds.width;
    const dy = (event.clientY - state.fromY) / bounds.height;

    if (state.mode === 'move') {
      onChange(clampCrop({ ...state.start, x: state.start.x + dx, y: state.start.y + dy }));
      return;
    }

    // Resizing keeps the opposite corner where it was.
    let { x, y, w, h } = state.start;
    if (state.mode.includes('w')) {
      x = state.start.x + dx;
      w = state.start.w - dx;
    }
    if (state.mode.includes('e')) w = state.start.w + dx;
    if (state.mode.includes('n')) {
      y = state.start.y + dy;
      h = state.start.h - dy;
    }
    if (state.mode.includes('s')) h = state.start.h + dy;
    onChange(clampCrop({ x, y, w, h }));
  };

  const end = (event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  };

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="relative w-full touch-none select-none overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)]"
        style={{ aspectRatio: String(aspect ?? 16 / 9) }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {kind === 'video' ? (
          <video
            src={src}
            className="h-full w-full"
            muted
            loop
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
            }}
          />
        ) : (
          <img
            src={src}
            alt=""
            className="h-full w-full"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
            }}
          />
        )}

        {/* Everything outside the selection is dimmed, so what will be kept
            reads at a glance. */}
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
        <div
          className="absolute cursor-move ring-2 ring-white/80"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          }}
          onPointerDown={begin('move')}
        >
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span
              key={corner}
              onPointerDown={begin(corner)}
              className={cn(
                'absolute h-3.5 w-3.5 rounded-sm border border-black/40 bg-white',
                corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                corner === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                corner === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {CROP_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(cropForRatio(preset.ratio, aspect ?? 16 / 9))}
            className="focus-ring rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            {preset.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[var(--faint)]">
          拖动方框移动，拖角改大小 · {Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}%
        </span>
      </div>
    </div>
  );
}
