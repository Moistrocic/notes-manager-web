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
  /**
   * Space at the end that is not content, in pixels.
   *
   * The editor keeps a margin below the last line so that typing there does not
   * happen against the edge of the pane. That margin is part of what the pane
   * can scroll through but none of what it contains, so counting it would make
   * the editor's 100% land a screenful past the preview's.
   */
  bottomInset?: number;
}

/** How much a pane can actually scroll through, content only. */
function rangeOf(pane: Scrollable): number {
  const inset = Number.isFinite(pane.bottomInset) ? Math.max(0, pane.bottomInset ?? 0) : 0;
  return pane.scrollHeight - pane.clientHeight - inset;
}

/** How far down a pane is: 0 at the top, 1 at the end of its content. */
export function scrollProgress(pane: Scrollable): number {
  const range = rangeOf(pane);
  // A pane with nothing to scroll (an empty note, a short preview) has no
  // progress to speak of: it is at the top and moving it would move nothing.
  if (!Number.isFinite(range) || range <= 0) return 0;
  const ratio = pane.scrollTop / range;
  if (!Number.isFinite(ratio)) return 0;
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/** Where a pane has to be to sit at the same progress as the other. */
export function scrollTopForProgress(pane: Scrollable, progress: number): number {
  const range = rangeOf(pane);
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

/** A pane's geometry, read at the moment it is asked for. */
export function readScrollable(element: HTMLElement, bottomInset = 0): Scrollable {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    bottomInset,
  };
}

/**
 * The margin at the end of a scroller, in pixels.
 *
 * Read from the element rather than written down here: it is a style, it can be
 * changed in one place, and the arithmetic should follow it. Outside a browser
 * - a server render, a test without layout - there is no computed style and no
 * margin to account for.
 */
export function trailingSpaceOf(element: Element | null | undefined): number {
  if (!element || typeof getComputedStyle !== 'function') return 0;
  let total = 0;
  const own = getComputedStyle(element).paddingBottom;
  const parsed = Number.parseFloat(own);
  if (Number.isFinite(parsed)) total += parsed;
  // CodeMirror keeps its own margin on the content inside the scroller.
  const inner = element.querySelector('.cm-content');
  if (inner) {
    const innerParsed = Number.parseFloat(getComputedStyle(inner).paddingBottom);
    if (Number.isFinite(innerParsed)) total += innerParsed;
  }
  return total;
}
