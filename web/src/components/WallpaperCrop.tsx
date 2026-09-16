import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { CROP_PRESETS, cropForRatio, resizeCrop, type CropHandle, type CropRect } from '../lib/wallpaper';

/** Eight handles: four edges change one axis, four corners change both. */
type Handle = Exclude<CropHandle, 'move'>;

const CORNERS: { id: Handle; className: string }[] = [
  { id: 'nw', className: '-left-1.5 -top-1.5 cursor-nwse-resize' },
  { id: 'ne', className: '-right-1.5 -top-1.5 cursor-nesw-resize' },
  { id: 'sw', className: '-bottom-1.5 -left-1.5 cursor-nesw-resize' },
  { id: 'se', className: '-bottom-1.5 -right-1.5 cursor-nwse-resize' },
];

const EDGES: { id: Handle; className: string }[] = [
  { id: 'n', className: 'left-1/2 -top-1 h-2 w-6 -translate-x-1/2 cursor-ns-resize' },
  { id: 's', className: 'left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2 cursor-ns-resize' },
  { id: 'w', className: 'top-1/2 -left-1 h-6 w-2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'e', className: 'top-1/2 -right-1 h-6 w-2 -translate-y-1/2 cursor-ew-resize' },
];

/**
 * Picks the part of a wallpaper that fills the screen.
 *
 * The whole picture is shown with a rectangle over it. The four edges change
 * one axis at a time - pull the bottom down to make it taller without touching
 * the width. The four corners scale both together, so a shape stays the shape
 * you chose while you make it bigger or smaller. That split is what makes the
 * box usable: with corners alone, every adjustment also changed the aspect
 * ratio, and there was no way to widen a selection without also heightening it.
 *
 * The preview box is given the picture's own aspect ratio, so a point in the
 * box is a point in the picture with no letterboxing arithmetic.
 */
export function WallpaperCrop({
  src,
  kind,
  crop,
  onChange,
  unavailable,
}: {
  src: string | null;
  kind: 'image' | 'video' | 'scene';
  crop: CropRect;
  onChange: (crop: CropRect) => void;
  /** Shown instead of the picture when there is nothing displayable. */
  unavailable?: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ handle: Handle | 'move'; fromX: number; fromY: number; start: CropRect } | null>(null);
  const [aspect, setAspect] = useState<number | null>(kind === 'scene' ? 16 / 9 : null);
  const [broken, setBroken] = useState(false);
  /**
   * The screen's shape, which is the shape the selection has to be.
   *
   * The rectangle is what fills the wallpaper layer, so its pixel proportions
   * become the layer's: a square selection on a wide screen is a stretched
   * picture. It is shown next to the selection's own ratio so that the
   * difference is visible rather than something to infer from the result.
   */
  const screenAspect = useMemo(() => {
    if (typeof window === 'undefined') return 16 / 9;
    return window.innerWidth / Math.max(1, window.innerHeight);
  }, []);

  /**
   * Records the picture's shape, and fits the selection to the screen once.
   *
   * Until this runs the selection is the whole picture, which fills the layer
   * by being stretched. A square wallpaper on a wide screen therefore starts
   * out distorted, and dragging afterwards cannot put the proportions back -
   * there is no correct position for the rectangle to be dragged to. The first
   * load replaces that default with the largest centred region of the screen's
   * shape, which is what a wallpaper is expected to do anyway.
   */
  const fit = (pictureAspect: number) => {
    setAspect(pictureAspect);
    if (crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1) {
      onChange(cropForRatio(screenAspect, pictureAspect));
    }
  };

  useEffect(() => {
    setAspect(kind === 'scene' ? 16 / 9 : null);
    setBroken(false);
  }, [src, kind]);

  const begin = (handle: Handle | 'move') => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    drag.current = { handle, fromX: event.clientX, fromY: event.clientY, start: crop };
  };

  const move = (event: React.PointerEvent) => {
    const state = drag.current;
    const box = boxRef.current;
    if (!state || !box) return;
    const bounds = box.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const dx = (event.clientX - state.fromX) / bounds.width;
    const dy = (event.clientY - state.fromY) / bounds.height;

    onChange(resizeCrop(state.start, state.handle, dx, dy));
  };

  const end = (event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  };

  const showPicture = Boolean(src) && !broken;
  // The selection's real shape, in pixels: its width fraction is of the
  // picture's width, so the picture's aspect has to come into it.
  const selectionAspect = (crop.w * (aspect ?? 16 / 9)) / Math.max(0.0001, crop.h);
  const stretched = Math.abs(selectionAspect - screenAspect) / screenAspect > 0.02;

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
        {showPicture ? (
          kind === 'video' ? (
            <video
              src={src as string}
              className="h-full w-full"
              muted
              loop
              autoPlay
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) fit(v.videoWidth / v.videoHeight);
              }}
              onError={() => setBroken(true)}
            />
          ) : (
            <img
              src={src as string}
              alt=""
              className="h-full w-full"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) fit(img.naturalWidth / img.naturalHeight);
              }}
              onError={() => setBroken(true)}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] leading-relaxed text-[var(--faint)]">
            {unavailable ?? '这张壁纸没有可以预览的图片。'}
          </div>
        )}

        {/* Everything outside the selection is dimmed, so what will be kept
            reads at a glance. */}
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
          {[...EDGES, ...CORNERS].map((handle) => (
            <span
              key={handle.id}
              onPointerDown={begin(handle.id)}
              aria-label={`调整 ${handle.id}`}
              className={cn(
                'absolute rounded-sm border border-black/40 bg-white',
                CORNERS.some((c) => c.id === handle.id) ? 'h-3.5 w-3.5' : 'rounded-full',
                handle.className,
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(cropForRatio(screenAspect, aspect ?? 16 / 9))}
          className="focus-ring rounded-full border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] text-[var(--accent)]"
          title="让选区与屏幕同比例，画面才不会被拉伸"
        >
          屏幕比例
        </button>
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
          拖动方框移动 · 边改单边 · 角等比 · 选区{' '}
          <span className={stretched ? 'bad' : 'ok'}>
            {(crop.w * (aspect ?? 16 / 9) * 100).toFixed(0)}:{Math.round(crop.h * 100)}
          </span>
          {' '}／ 屏幕 {screenAspect.toFixed(2)}:1{stretched ? ' ← 比例不符，画面会被拉伸' : ''}
        </span>
      </div>
    </div>
  );
}
