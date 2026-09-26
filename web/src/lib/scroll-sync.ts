/**
 * Keeping two panes level.
 *
 * The editor and the preview do not line up by proportion: one line of source
 * can be a heading (one line tall) or a picture (half a screen), so "half way
 * down the editor" and "half way down the preview" are different places in the
 * note. Percentage scrolling drifts, and the longer the note the further apart
 * they get.
 *
 * What the two agree on is the source. The preview marks each block with the
 * lines it came from, and the panes are kept level by mapping a source line to a
 * place in the rendered document - the same thing the markdown preview in
 * VS Code does, with the same interpolation between two neighbouring blocks.
 *
 * The arithmetic lives here, away from the DOM, so it can be checked without a
 * browser and so both directions use the same one.
 */

/** A block of the rendered document, and the source lines it came from. */
export interface SourceAnchor {
  /** First source line of the block, 1-based. */
  line: number;
  /** The line after the block's last one. */
  endLine: number;
  /** Distance from the top of the scrolled pane to the top of this block. */
  top: number;
  /** How tall the block is. */
  height: number;
}

/** A place in the source: a line, and how far into it (0 at its start). */
export interface SourcePosition {
  line: number;
  fraction: number;
}

const clamp = (value: number, min: number, max: number): number =>
  !Number.isFinite(value) ? min : value < min ? min : value > max ? max : value;

/** Anchors in source order, ignoring anything the DOM reported out of order. */
function ordered(anchors: SourceAnchor[]): SourceAnchor[] {
  return [...anchors].filter((a) => Number.isFinite(a.line) && Number.isFinite(a.top)).sort((a, b) => a.line - b.line);
}

/**
 * Where the rendered document has to scroll for a source position to sit at the
 * top of the pane.
 *
 * Between two blocks the distance is travelled in proportion to the lines
 * between them, which is what keeps a long paragraph from jumping: the reader
 * sees the same sentences as they scroll either pane. Past the last block the
 * distance is travelled through that block's own height, so the end of the note
 * is the end of both panes.
 */
export function topForSourcePosition(anchors: SourceAnchor[], position: SourcePosition): number | null {
  const blocks = ordered(anchors);
  if (blocks.length === 0) return null;
  const target = position.line + clamp(position.fraction, 0, 1);
  // Above the first block: the top of the document is the only honest answer.
  if (target <= blocks[0].line) return Math.max(0, Math.round(blocks[0].top));

  for (let index = 0; index < blocks.length; index += 1) {
    const current = blocks[index];
    const next = blocks[index + 1];
    if (next && target >= next.line) continue;

    // Inside the block itself: its lines are spread over its own height, which
    // is what carries the reader through a paragraph the preview renders tall
    // (a picture, a long list) at the same pace as the one line it occupies in
    // the editor.
    const ownSpan = Math.max(1, current.endLine - current.line);
    if (target < current.endLine) {
      const progress = clamp((target - current.line) / ownSpan, 0, 1);
      return Math.max(0, Math.round(current.top + progress * Math.max(1, current.height)));
    }
    // Past it: the blank lines before the next block are travelled with it.
    const bottom = current.top + Math.max(1, current.height);
    if (!next) return Math.max(0, Math.round(bottom));
    const gap = Math.max(1, next.line - current.endLine);
    const progress = clamp((target - current.endLine) / gap, 0, 1);
    return Math.max(0, Math.round(bottom + progress * (next.top - bottom)));
  }
  const last = blocks[blocks.length - 1];
  return Math.max(0, Math.round(last.top + last.height));
}

/**
 * The source position at the top of a pane - what the other pane has to follow.
 *
 * The reverse of the above, and deliberately so: scrolling the preview has to
 * put the editor where scrolling the editor would have put the preview, or the
 * two would disagree about where they are the moment you touched either.
 */
export function sourcePositionAt(anchors: SourceAnchor[], top: number): SourcePosition | null {
  const blocks = ordered(anchors);
  if (blocks.length === 0) return null;
  if (!Number.isFinite(top)) return { line: blocks[0].line, fraction: 0 };
  if (top <= blocks[0].top) return { line: blocks[0].line, fraction: 0 };

  let current = blocks[0];
  for (const block of blocks) {
    if (block.top <= top) current = block;
    else break;
  }
  // The exact inverse of the mapping above: a position inside the block lands
  // on the line that is that far through its lines. If the two directions did
  // not invert each other, touching either pane would move the other.
  const span = Math.max(1, current.endLine - current.line);
  const progress = clamp((top - current.top) / Math.max(1, current.height), 0, 1);
  const exact = current.line + progress * span;
  const line = Math.floor(exact);
  return { line, fraction: clamp(exact - line, 0, 1) };
}
