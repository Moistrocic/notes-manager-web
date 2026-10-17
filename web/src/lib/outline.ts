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

/* -------------------------------------------------------------------------- */
/* The outline as a tree                                                       */
/* -------------------------------------------------------------------------- */

/** One heading and the sections written under it. */
export interface OutlineNode {
  heading: Heading;
  /** Position in the flat heading list - the index navigation scrolls to. */
  index: number;
  children: OutlineNode[];
}

/**
 * The outline as the sections the document describes.
 *
 * A heading belongs under the nearest earlier heading above its own level. A
 * skipped level - `# A` followed straight by `### C` - hangs the deeper heading
 * off the shallower one rather than inventing the missing h2: the outline is a
 * picture of the document, not of a perfectly shaped tree.
 */
export function buildOutlineTree(headings: Heading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  /** The open chain of sections seen so far, deepest last. */
  const stack: OutlineNode[] = [];
  headings.forEach((heading, index) => {
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.level) stack.pop();
    const node: OutlineNode = { heading, index, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  });
  return roots;
}

/** The flat indexes of the headings that have sections under them. */
export function collapsibleHeadingIndexes(tree: OutlineNode[]): number[] {
  const out: number[] = [];
  const walk = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) out.push(node.index);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** A row of the outline as drawn: the depth indents it, the index navigates. */
export interface OutlineRow {
  heading: Heading;
  index: number;
  /** 0 for a top-level heading. */
  depth: number;
  /** Whether the row can be folded at all. */
  hasChildren: boolean;
  /** Whether the sections under it are currently hidden. */
  collapsed: boolean;
}

/**
 * The rows that are actually on screen.
 *
 * `collapsed` holds the flat indexes of the folded headings. A folded row is
 * still drawn itself - it is the way back to what it hides - but nothing below
 * it is, and a row under a folded parent is not drawn however it is folded.
 * That is what makes "all folded" a list of the top level rather than an empty
 * pane.
 */
export function visibleOutlineRows(tree: OutlineNode[], collapsed: ReadonlySet<number>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const folded = hasChildren && collapsed.has(node.index);
      rows.push({ heading: node.heading, index: node.index, depth, hasChildren, collapsed: folded });
      if (hasChildren && !folded) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}
