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
import { extractHeadings } from './src/lib/outline';

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

/** The headings marked actually renders, in order. */
function renderedHeadings(markdown: string): { level: number; text: string }[] {
  const tokens = marked.lexer(markdown) as { type: string; depth?: number; text?: string }[];
  return tokens
    .filter((token) => token.type === 'heading')
    .map((token) => ({ level: token.depth ?? 1, text: (token.text ?? '').trim() }));
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
compare('inline formatting is kept verbatim', '# **bold** and `code`\n');
compare('link in a heading', '# [title](https://example.com)\n');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
