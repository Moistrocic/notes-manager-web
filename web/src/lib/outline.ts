export interface Heading {
  level: number;
  text: string;
  /** 1-based line number in the source document. */
  line: number;
}

/**
 * The headings of a markdown document, in document order.
 *
 * The order has to match what the renderer produces, because the outline uses
 * the position to scroll the preview to the same heading. Headings inside code
 * fences are skipped here and are not rendered as headings either.
 */
export function extractHeadings(content: string): Heading[] {
  const out: Heading[] = [];
  const lines = (content ?? '').split('\n');
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (marker === fence) fence = null;
      return;
    }
    if (fence !== null) return;

    // CommonMark: up to three leading spaces, a space after the hashes, and an
    // optional closing sequence that only counts when preceded by a space.
    const match = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!match) return;
    const text = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    out.push({ level: match[1].length, text, line: index + 1 });
  });
  return out;
}

/** Text comparison that survives the renderer's whitespace and entity handling. */
export function normaliseHeading(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
