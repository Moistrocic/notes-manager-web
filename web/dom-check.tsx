/**
 * DOM level checks for in-note navigation.
 *
 *   npm run check:web
 *
 * Unit tests around the outline and the deep links all passed while the outline
 * still failed to update the address bar: each piece was correct, the wiring
 * between them was not. These tests render the real component tree in jsdom,
 * click, and assert on what the user would see.
 *
 * Both entry points - the outline and a `[text](#anchor)` link - must leave the
 * address bar, the editor and the preview agreeing with each other.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://notes.example.com/',
  pretendToBeVisual: true,
});

/* --- globals the component tree expects ----------------------------------- */
const w = dom.window as unknown as Window & typeof globalThis;
/** `navigator` is read only on newer Node versions, so define rather than assign. */
function define(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
define('window', w);
define('document', w.document);
define('navigator', w.navigator);
define('HTMLElement', w.HTMLElement);
define('Element', w.Element);
define('Node', w.Node);
define('getComputedStyle', w.getComputedStyle.bind(w));
define('requestAnimationFrame', (cb: FrameRequestCallback) => w.setTimeout(() => cb(Date.now()), 0));
define('cancelAnimationFrame', (id: number) => w.clearTimeout(id));
define('matchMedia', () => ({
  matches: true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
}));
define('MutationObserver', w.MutationObserver);
define('ResizeObserver', w.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} });
define('IntersectionObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
});
define('CSS', w.CSS);
define('Window', w.Window);
define('Document', w.Document);
define('Range', w.Range);
define('DOMRect', w.DOMRect ?? class {});
define('IS_REACT_ACT_ENVIRONMENT', true);
// jsdom has no layout: give CodeMirror the measurement APIs it expects and
// record scroll positions instead of moving them.
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
w.Range.prototype.getClientRects = emptyRects as typeof w.Range.prototype.getClientRects;
w.Range.prototype.getBoundingClientRect = (() => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })) as typeof w.Range.prototype.getBoundingClientRect;
w.Element.prototype.getClientRects = emptyRects as typeof w.Element.prototype.getClientRects;

const scrollCalls: { target: Element; top: number }[] = [];
w.HTMLElement.prototype.scrollTo = function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
  const top = typeof options === 'number' ? options : (options?.top ?? 0);
  scrollCalls.push({ target: this, top });
  this.scrollTop = top;
} as typeof w.HTMLElement.prototype.scrollTo;
if (!w.CSS?.escape) {
  (w as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  };
  (globalThis as Record<string, unknown>).CSS = w.CSS;
}

/* --- modules, imported after the globals exist ---------------------------- */
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { Editor } = await import('./src/components/Editor');
const { appStore } = await import('./src/store/useAppStore');

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
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

const CONTENT = [
  '# 1.1 分层',
  '',
  'intro [jump](#12-权限)',
  '',
  '## 1.2 权限',
  '',
  'middle',
  '',
  '### Details',
  '',
  'end',
  '',
].join('\n');

const note = {
  id: 'nav1',
  title: '导航测试',
  tags: [],
  pinned: false,
  favorite: false,
  color: null,
  folder: '',
  path: '/nav.md',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
  excerpt: '',
  wordCount: 10,
  size: CONTENT.length,
  hasFrontMatter: true,
  content: CONTENT,
};

appStore.setState({
  booted: true,
  user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
  notes: [note],
  activeId: note.id,
  activeNote: note,
  lastSaved: null,
  dirty: false,
  editorMode: 'split',
  metaOpen: true,
  capabilities: { driver: 'openlist', root: '/public/Notes', writable: true, permissions: { write: true, rename: true, move: true, remove: true } },
} as never);

const host = w.document.getElementById('root') as HTMLElement;
const root = createRoot(host);
await act(async () => {
  root.render(React.createElement(Editor));
});
await flush();

console.log('in-note navigation (jsdom)');

const outlineButtons = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-panel button')).filter((b) =>
    b.textContent?.includes('1.2'),
  );
const findButton = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);

// 1. the outline is rendered with the document's headings
check('outline lists the headings', host.querySelectorAll('.outline-panel li').length, 3);

// 2. clicking an outline entry updates the address bar *and* scrolls the preview
{
  scrollCalls.length = 0;
  w.history.replaceState(null, '', '/public/Notes/nav.md');
  const button = outlineButtons()[0];
  check('an outline entry for the target heading exists', Boolean(button), true);
  await act(async () => {
    button?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });

  // the browser percent-encodes non-ASCII fragments, so decode before comparing
  check('the address bar gains the anchor', decodeURIComponent(w.location.hash), '#12-权限');
  const previewScrolls = scrollCalls.filter((call) => call.target.classList.contains('markdown-body'));
  check('the preview pane is scrolled', previewScrolls.length > 0, true);
}

// 3. an in-note anchor link behaves the same way
{
  scrollCalls.length = 0;
  w.history.replaceState(null, '', '/public/Notes/nav.md');
  const anchors = Array.from(host.querySelectorAll<HTMLAnchorElement>('.markdown-body a'));
  const link = anchors.find((a) => (a.getAttribute('href') ?? '').includes('12'));
  check('the anchor link is rendered', Boolean(link), true);
  if (!link) {
    console.log('        anchors found:', anchors.map((a) => JSON.stringify(a.getAttribute('href'))).join(', ') || '(none)');
  }
  check('the anchor link got an internal marker', link?.dataset.internalLink, 'true');
  const clickEvent = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    link?.dispatchEvent(clickEvent);
  });
  check('the click reached the app handler', clickEvent.defaultPrevented, true);
  check('the address bar gains the anchor from the link', decodeURIComponent(w.location.hash), '#12-权限');
  check('the preview pane is scrolled for the link too', scrollCalls.filter((c) => c.target.classList.contains('markdown-body')).length > 0, true);
}

// 4. headings carry the ids that anchors point at
{
  const ids = Array.from(host.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3')).map((h) => h.id);
  check('headings have anchor ids', ids, ['11-分层', '12-权限', 'details']);
}

await act(async () => {
  root.unmount();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
