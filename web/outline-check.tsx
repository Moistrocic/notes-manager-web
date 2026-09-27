/**
 * Checks that the outline's heading list matches what the renderer produces.
 *
 *   npm run check:web
 *
 * This matters because the outline scrolls the preview to the heading at the
 * same position. An extra or missing heading - a fenced block, a trailing hash,
 * a seven-hash line - shifts every entry after it and the click lands on the
 * wrong section.
 */
import { marked } from 'marked';
import { extractHeadings, normaliseHeading, stripInlineMarkdown } from './src/lib/outline';
import { slugifyHeading } from './src/lib/markdown';

let failed = 0;
let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got === want) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}\n          got  ${got}\n          want ${want}`);
  }
}

/** The characters an entity the renderer writes stands for. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * What the page shows for an inline string: the markdown rendered, the tags
 * taken off, the entities the renderer escaped turned back into characters.
 *
 * The outline has to say what the heading says, not how it was written, and
 * this is what "says" means on the page - the preview scrolls to a heading by
 * comparing the two texts (see `normaliseHeading`).
 */
function pageText(inline: string): string {
  return (marked.parseInline(inline) as string)
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .trim();
}

/**
 * What a heading *reads as* on the page, which is not the same as {@link pageText}:
 * an image is a box with no text, so a heading written
 * \`### ![示意图](x.png) 图片标题\` reads as "示意图 图片标题" and not as "图片标题".
 *
 * This is the text the preview matches an outline click against (see the
 * \`readsAs\` walk in Preview.tsx), so the two have to come out the same or the
 * click has nothing to land on.
 */
function readAloud(inline: string): string {
  return (marked.parseInline(inline) as string)
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
    .trim();
}

/** The headings marked actually renders, in order, as the page shows them. */
function renderedHeadings(markdown: string): { level: number; text: string }[] {
  const tokens = marked.lexer(markdown) as { type: string; depth?: number; text?: string }[];
  return tokens
    .filter((token) => token.type === 'heading')
    .map((token) => ({ level: token.depth ?? 1, text: pageText(token.text ?? '') }));
}

function compare(name: string, markdown: string) {
  const mine = extractHeadings(markdown).map((h) => ({ level: h.level, text: h.text }));
  check(name, mine, renderedHeadings(markdown));
}

console.log('outline headings align with the renderer');

compare('plain ATX headings', '# A\n\n## B\n\n### C\n');
compare('headings with body text', 'intro\n\n# A\n\ntext\n\n## B\n');
compare('Chinese headings', '# 中文标题\n\n## 二级标题\n');
compare('closing hashes', '# foo #\n\n## bar ##\n');
compare('hash inside the text is kept', '# foo#\n');
compare('no space after the hashes is not a heading', '#foo\n\n# bar\n');
compare('seven hashes is not a heading', '####### seven\n\n# ok\n');
compare('four space indent is a code block', '    # not a heading\n\n# yes\n');
compare('up to three spaces still count', '   # indented heading\n');
compare('empty heading', '#\n\n# \n\n# A\n');
// The renderer swallows the markers, so the outline shows the words: a heading
// written as a link is a section called by its label, not by its source.
compare('inline formatting is unwrapped', '# **bold** and `code`\n');
compare('link in a heading', '# [title](https://example.com)\n');
compare('an escaped marker shows its character', '# 100 \\* ok\n');
compare('an ampersand the renderer escapes', '# a & b\n');

// Fences are the classic source of drift.
compare('heading inside a fenced block is skipped', '```\n# not a heading\n```\n\n# real\n');
compare(
  'heading inside a language-tagged fence is skipped',
  '```js\n// # nope\nconst a = 1;\n```\n\n## real\n',
);
compare('tilde fence', '~~~\n# nope\n~~~\n\n# real\n');
compare(
  'fence followed by more headings',
  '# one\n\n```\n# hidden\n```\n\n## two\n\n### three\n',
);

/* -------------------------------------------------------------------------- */
/* Inline syntax in a heading                                                  */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('a heading written with inline markdown');

// Reported from a note taken off a problem set: the outline listed the whole
// `[003. …](https://…)` source. A heading written as a link is a section called
// by its label.
{
  const linked = extractHeadings(
    '# [003. 无重复字符的最长子串](https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/)\n',
  );
  check('a linked title shows its label, not the source', linked[0].text, '003. 无重复字符的最长子串');
  check('with its level and line unchanged', [linked.length, linked[0].level, linked[0].line], [1, 1, 1]);
  check('and no destination left in it', linked[0].text.includes('leetcode'), false);

  // The preview scrolls to a heading by matching the text on the page with the
  // outline's (`normaliseHeading`). While the outline said `[x](url)` and the
  // page said `x`, clicking that entry found nothing - this is that match.
  check(
    'the outline text is what the page shows',
    normaliseHeading(linked[0].text),
    normaliseHeading(pageText('[003. 无重复字符的最长子串](https://example.com/a)')),
  );
}

const INLINE: { name: string; level: number; source: string; text: string }[] = [
  { name: 'a link keeps its label', level: 1, source: '[标签](https://example.com/a)', text: '标签' },
  {
    name: 'emphasis and code spans come off',
    level: 2,
    source: '**粗体**与`代码`和*斜体*',
    text: '粗体与代码和斜体',
  },
  { name: 'an image shows its alt text', level: 3, source: '![示意图](/img/x.png) 图片标题', text: '示意图 图片标题' },
  {
    name: 'a reference link keeps its label, an undefined one is left alone',
    level: 4,
    source: '[引用式][ref] 与 [捷径]',
    text: '引用式 与 [捷径]',
  },
  {
    name: 'an autolink shows its address, a raw tag its text',
    level: 5,
    source: '<https://example.com> 自动链接 与 <span>裸标签</span>',
    text: 'https://example.com 自动链接 与 裸标签',
  },
  {
    name: 'an escape shows its character, strikethrough its text',
    level: 6,
    source: '转义 \\* 星号 与 ~~删除线~~',
    text: '转义 * 星号 与 删除线',
  },
];
for (const item of INLINE) {
  const headings = extractHeadings('#'.repeat(item.level) + ' ' + item.source + '\n\n下一段\n');
  check(item.name, headings.map((h) => [h.level, h.text, h.line]), [[item.level, item.text, 1]]);
}

// Nothing recognised is left as written.
check('plain text is left alone', stripInlineMarkdown('就是一句话'), '就是一句话');
check('an unclosed bracket is left alone', stripInlineMarkdown('半截 [没写完'), '半截 [没写完');
check('an empty string stays empty', stripInlineMarkdown(''), '');
check('a fence is still not a heading', extractHeadings('```\n# [x](https://example.com)\n```\n').length, 0);
check(
  'lines do not drift when the headings carry inline syntax',
  extractHeadings('# [a](u)\n\n## **b**\n\n### `c`\n').map((h) => h.line),
  [1, 3, 5],
);

// An image is a box: its alt text is not a text node, so a plain textContent
// comparison cannot see it. The preview counts it anyway (Preview's readsAs
// walk), which is what makes this heading clickable at all.
check('an image heading shows its alt text in the outline', extractHeadings('### ![示意图](/img/x.png) 图片标题')[0].text, '示意图 图片标题');
check('textContent alone would miss the alt', pageText('![示意图](/img/x.png) 图片标题'), '图片标题');
check('but what the heading reads as has it', readAloud('![示意图](/img/x.png) 图片标题'), '示意图 图片标题');
check(
  'so the outline text is exactly what the preview matches',
  normaliseHeading(readAloud('![示意图](/img/x.png) 图片标题')),
  normaliseHeading(extractHeadings('### ![示意图](/img/x.png) 图片标题')[0].text),
);
check('a heading with no image reads the same either way', readAloud('**粗体**与`代码`'), pageText('**粗体**与`代码`'));

/* -------------------------------------------------------------------------- */
/* Heading anchors                                                             */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('heading anchors');

check('numbered Chinese heading', slugifyHeading('1.1 分层'), '11-分层');
check('punctuation is dropped', slugifyHeading('Hello, World!'), 'hello-world');
check('collapsed whitespace', slugifyHeading('  Spaced   Out  '), 'spaced-out');
check('mixed scripts', slugifyHeading('中文 English 123'), '中文-english-123');
check('inline code markers are dropped', slugifyHeading('\`code\` here'), 'code-here');
check('emphasis markers are dropped', slugifyHeading('**bold** title'), 'bold-title');
check('slashes and dots', slugifyHeading('a/b.c'), 'abc');
check('underscores and hyphens survive', slugifyHeading('snake_case-name'), 'snake_case-name');
check('empty result for symbols only', slugifyHeading('!!!'), '');
check('unicode letters survive', slugifyHeading('Café résumé'), 'café-résumé');

// The anchor a user writes in markdown has to match the id the renderer
// generates for the same heading.
{
  const markdown = '# 1.1 分层\n\n## 1.2 权限\n\n### Details\n';
  const fromSource = extractHeadings(markdown).map((h) => slugifyHeading(h.text));
  const fromRendered = renderedHeadings(markdown).map((h) => slugifyHeading(h.text));
  check('source and rendered slugs agree', fromSource, fromRendered);
  check('the anchor from the report resolves', fromSource[0], '11-分层');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
