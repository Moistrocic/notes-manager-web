/**
 * One palette for every piece of code the application shows.
 *
 * The editor tokenises with CodeMirror (lezer tags) and the preview with
 * highlight.js (CSS classes), so their colours used to live in two separate
 * lists and drifted apart: the preview was on a GitHub-ish dark palette with no
 * light variant at all, which meant the same fenced block changed colour
 * depending on which pane you read it in, and was close to unreadable in light
 * mode. Both sides now derive from the table below.
 *
 * The values are VS Code's Dark+ and Light+ themes, which is what the editor
 * has always used.
 *
 * To add a colour: add a token here, give it tag rules in CODE_TAG_RULES for the
 * editor and class names in HLJS_CLASSES for the preview. The generated CSS and
 * the editor's HighlightStyle are both built from those, so they cannot drift
 * again.
 */

import { HighlightStyle, type TagStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** Code metrics, shared so a fenced block reads the same in both panes. */
export const CODE_FONT_SIZE = '14.5px';
export const CODE_LINE_HEIGHT = '1.75';

export type CodeToken =
  | 'keyword'
  | 'definition'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'variable'
  | 'constant'
  | 'punctuation'
  | 'tag'
  | 'regexp'
  | 'escape'
  | 'invalid'
  | 'inserted'
  | 'deleted';

interface TokenColours {
  dark: string;
  light: string;
  italic?: boolean;
}

export const CODE_COLOURS: Record<CodeToken, TokenColours> = {
  keyword: { dark: '#c586c0', light: '#af00db' },
  definition: { dark: '#569cd6', light: '#0000ff' },
  string: { dark: '#ce9178', light: '#a31515' },
  number: { dark: '#b5cea8', light: '#098658' },
  comment: { dark: '#6a9955', light: '#008000', italic: true },
  function: { dark: '#dcdcaa', light: '#795e26' },
  type: { dark: '#4ec9b0', light: '#267f99' },
  variable: { dark: '#9cdcfe', light: '#001080' },
  constant: { dark: '#4fc1ff', light: '#0070c1' },
  punctuation: { dark: '#d4d4d4', light: '#3b3b3b' },
  tag: { dark: '#569cd6', light: '#800000' },
  regexp: { dark: '#d16969', light: '#811f3f' },
  escape: { dark: '#d7ba7d', light: '#ee0000' },
  invalid: { dark: '#f44747', light: '#cd3131' },
  inserted: { dark: '#b5cea8', light: '#098658' },
  deleted: { dark: '#f44747', light: '#cd3131' },
};

/** The colour a token takes in one of the two themes. */
export function codeColour(token: CodeToken, dark: boolean): string {
  return dark ? CODE_COLOURS[token].dark : CODE_COLOURS[token].light;
}

/**
 * Editor side: which lezer tags belong to which token. CodeMirror picks the
 * first matching rule, so the order here is the priority order.
 */
export const CODE_TAG_RULES: [TagStyle['tag'], CodeToken][] = [
  [[t.keyword, t.moduleKeyword, t.controlKeyword, t.operatorKeyword], 'keyword'],
  [[t.definitionKeyword, t.modifier, t.self], 'definition'],
  [[t.string, t.special(t.string), t.character], 'string'],
  [[t.number, t.bool, t.null, t.atom], 'number'],
  [[t.comment, t.lineComment, t.blockComment, t.docComment], 'comment'],
  [[t.function(t.variableName), t.function(t.propertyName), t.labelName], 'function'],
  [[t.className, t.typeName, t.namespace], 'type'],
  [[t.definition(t.variableName), t.definition(t.propertyName)], 'variable'],
  [[t.variableName, t.propertyName, t.attributeName], 'variable'],
  [[t.operator, t.punctuation, t.separator, t.bracket], 'punctuation'],
  [[t.tagName], 'tag'],
  [[t.attributeValue], 'string'],
  [[t.regexp], 'regexp'],
  [[t.escape], 'escape'],
  [[t.meta], 'keyword'],
  [[t.invalid], 'invalid'],
  [[t.constant(t.variableName), t.standard(t.variableName)], 'constant'],
  [[t.inserted], 'inserted'],
  [[t.deleted], 'deleted'],
];

/**
 * Preview side: the highlight.js classes, mapped onto the same tokens.
 * highlight.js only ever adds one of these per span.
 */
export const HLJS_CLASSES: Record<string, CodeToken> = {
  comment: 'comment',
  quote: 'comment',
  doctag: 'comment',
  keyword: 'keyword',
  'selector-tag': 'keyword',
  meta: 'keyword',
  'meta-keyword': 'keyword',
  formula: 'keyword',
  built_in: 'definition',
  name: 'tag',
  tag: 'tag',
  'selector-class': 'tag',
  'selector-id': 'tag',
  'selector-attr': 'tag',
  'selector-pseudo': 'tag',
  string: 'string',
  char: 'string',
  number: 'number',
  literal: 'number',
  symbol: 'number',
  bullet: 'number',
  link: 'number',
  title: 'type',
  section: 'type',
  type: 'type',
  class: 'type',
  variable: 'variable',
  'template-variable': 'variable',
  attr: 'variable',
  attribute: 'variable',
  property: 'variable',
  params: 'variable',
  punctuation: 'punctuation',
  operator: 'punctuation',
  regexp: 'regexp',
  subst: 'escape',
  addition: 'inserted',
  deletion: 'deleted',
};

/**
 * The editor's half of the palette, on its own.
 *
 * CodeEditor merges codeTagStyles() with its markdown prose rules; this
 * HighlightStyle exists so the tests can ask the editor's own machinery what
 * colour a tag ends up with, and compare it against the preview's CSS.
 */
export function codeHighlight(dark: boolean): HighlightStyle {
  return HighlightStyle.define(codeTagStyles(dark));
}

/** The editor's code rules, ready to merge into a HighlightStyle. */
export function codeTagStyles(dark: boolean): TagStyle[] {
  return CODE_TAG_RULES.map(([tag, token]) => {
    const style: TagStyle = { tag, color: codeColour(token, dark) };
    if (CODE_COLOURS[token].italic) style.fontStyle = 'italic';
    return style;
  });
}

/**
 * The preview's half of the palette, plus the code metrics both panes share.
 * Written into one <style> element at start-up.
 */
export function codeThemeCss(): string {
  const variables = (dark: boolean) =>
    (Object.keys(CODE_COLOURS) as CodeToken[])
      .map((token) => `--code-${token}:${codeColour(token, dark)}`)
      .join(';');

  const grouped = new Map<CodeToken, string[]>();
  for (const [className, token] of Object.entries(HLJS_CLASSES)) {
    const list = grouped.get(token) ?? [];
    list.push(`.hljs-${className}`);
    grouped.set(token, list);
  }

  const rules = [`:root{${variables(false)};--code-font-size:${CODE_FONT_SIZE};--code-line-height:${CODE_LINE_HEIGHT}}`];
  rules.push(`.dark{${variables(true)}}`);

  for (const [token, selectors] of grouped) {
    const body = [`color:var(--code-${token})`];
    if (CODE_COLOURS[token].italic) body.push('font-style:italic');
    rules.push(`${selectors.join(',')}{${body.join(';')}}`);
  }

  // highlight.js marks a function name either as "title function_" or by
  // nesting it in "function"; a plain "title" is a class name, which is a type.
  rules.push('.hljs-title.function_,.hljs-function .hljs-title{color:var(--code-function)}');
  rules.push('.hljs-emphasis{font-style:italic}');
  rules.push('.hljs-strong{font-weight:700}');

  // Both panes read code with the same font at the same size and leading, so a
  // block does not change shape when you drag the splitter.
  rules.push(
    '.markdown-body pre code{font-family:var(--font-mono);font-size:var(--code-font-size);line-height:var(--code-line-height);background:none;padding:0}',
  );
  rules.push(`.cm-scroller{font-family:var(--font-mono)!important;line-height:var(--code-line-height)}`);

  return rules.join('\n');
}

const STYLE_ID = 'code-theme';

/** Installs the palette. Idempotent, and safe to call before React renders. */
export function installCodeTheme(): void {
  if (typeof document === 'undefined') return;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = codeThemeCss();
}
