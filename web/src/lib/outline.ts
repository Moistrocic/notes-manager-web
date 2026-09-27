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
    const raw = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    out.push({ level: match[1].length, text: stripInlineMarkdown(raw), line: index + 1 });
  });
  return out;
}

/**
 * What a heading's *text* is, as opposed to how it is written.
 *
 * The outline is read by a person looking for a section, and a heading written
 * as a link - `# [003. 无重复字符的最长子串](https://…)`, which is what a note
 * taken from a problem set looks like - is a section called
 * "003. 无重复字符的最长子串", not a section called "[003. 无重复字符的最长子串](https://…)".
 * So the inline syntax the renderer would swallow comes off here: labels keep,
 * destinations go, and emphasis, code spans, images and raw tags are unwrapped
 * the same way the page unwraps them.
 *
 * Order matters: links before emphasis, because a link's label may contain it.
 * Anything that is not recognised is left alone - the outline shows what the
 * heading says rather than guessing at what it meant.
 */
export function stripInlineMarkdown(text: string): string {
  return (text ?? '')
    // Images: what the reader gets is the alt text.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links and reference links: the label is the text.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    // Autolinks keep the address, which is what they display.
    .replace(/<((?:[a-z][a-z0-9+.-]*:)[^>]*)>/gi, '$1')
    // Code spans and emphasis are the text between their markers.
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(\*|_)(?=\S)([^\s*_][\s\S]*?\S)\1/g, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    // Raw tags are not text.
    .replace(/<[^>]*>/g, '')
    // A backslash escape shows the character it escapes.
    .replace(/\\([\\`*_{}[\]()#+\-.!~>])/g, '$1')
    .trim();
}

/** Text comparison that survives the renderer's whitespace and entity handling. */
export function normaliseHeading(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
