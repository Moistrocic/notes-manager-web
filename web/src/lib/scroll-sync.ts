/**
 * Keeping two panes level.
 *
 * The editor and the preview scroll different things - a CodeMirror scroller
 * and a rendered document - and their heights have nothing to do with each
 * other, so equal scrollTop means nothing. What they can share is the progress
 * through the document: how far down the reader is, as a fraction.
 *
 * The conversion lives here, away from the DOM, so the arithmetic can be
 * checked without a browser - and so both directions use the same one.
 */

export interface Scrollable {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** How far down a pane is: 0 at the top, 1 at the bottom, clamped. */
export function scrollProgress(pane: Scrollable): number {
  const range = pane.scrollHeight - pane.clientHeight;
  // A pane with nothing to scroll (an empty note, a short preview) has no
  // progress to speak of: it is at the top and moving it would move nothing.
  if (!Number.isFinite(range) || range <= 0) return 0;
  const ratio = pane.scrollTop / range;
  if (!Number.isFinite(ratio)) return 0;
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/** Where a pane has to be to sit at the same progress as the other. */
export function scrollTopForProgress(pane: Scrollable, progress: number): number {
  const range = pane.scrollHeight - pane.clientHeight;
  if (!Number.isFinite(range) || range <= 0) return 0;
  const clamped = !Number.isFinite(progress) ? 0 : Math.max(0, Math.min(1, progress));
  return Math.round(clamped * range);
}

/**
 * Where `to` has to scroll to stay level with `from`, or null when it is
 * already there.
 *
 * Null rather than the same number twice: a scroll event fires for every pixel,
 * and assigning a value that changes nothing would fire the other pane's
 * handler, which would fire this one again. The tolerance leaves a pane that is
 * a rounding step out of level alone.
 */
export function mirrorScroll(from: Scrollable, to: Scrollable, tolerance = 1): number | null {
  const target = scrollTopForProgress(to, scrollProgress(from));
  return Math.abs(target - to.scrollTop) <= tolerance ? null : target;
}
