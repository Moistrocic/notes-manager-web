import yaml from 'js-yaml';

const DELIMITER = /^---\s*$/;

export interface ParsedDocument {
  /** Parsed YAML front matter (empty object when the file has none). */
  attributes: Record<string, unknown>;
  /** Raw front matter block ("" when the file has none). */
  rawFrontMatter: string;
  body: string;
  /** True when the file actually started with a `---` block. */
  hasFrontMatter: boolean;
}

/** Splits a markdown document into YAML front matter and body. */
export function parseDocument(raw: string): ParsedDocument {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (!lines.length || !DELIMITER.test(lines[0] ?? '')) {
    return { attributes: {}, rawFrontMatter: '', body: text, hasFrontMatter: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (DELIMITER.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { attributes: {}, rawFrontMatter: '', body: text, hasFrontMatter: false };
  }
  const block = lines.slice(1, end).join('\n');
  const body = lines.slice(end + 1).join('\n').replace(/^\n/, '');
  let attributes: Record<string, unknown> = {};
  try {
    const loaded = yaml.load(block);
    if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
      attributes = loaded as Record<string, unknown>;
    }
  } catch {
    attributes = {};
  }
  return { attributes, rawFrontMatter: block, body, hasFrontMatter: true };
}

/** Serialises front matter + body back into a markdown document. */
export function serialiseDocument(attributes: Record<string, unknown>, body: string): string {
  const dump = yaml.dump(attributes, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  const trimmedBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${dump}---\n\n${trimmedBody}\n`;
}
