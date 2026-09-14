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

/* --- bundled fonts and the local wallpaper listing ------------------------ */
const { applyFonts, availableFonts, fontExists } = await import('./src/lib/fonts');
const { libraryFromFiles } = await import('./src/lib/local-wallpapers');
const { wallpaperKindOf } = await import('./src/lib/wallpaper');

console.log('\nfonts and wallpapers (jsdom)');
{
  const html = document.documentElement;
  const styleText = () => document.getElementById('user-fonts')?.textContent ?? '';
  const uploaded = [
    { id: 'abc', name: 'My Font', fileName: 'a.woff2', format: 'woff2' as const, size: 1024, uploadedAt: '2024-01-01T00:00:00.000Z' },
  ];

  // What a fresh installation resolves to.
  applyFonts([], { sans: '', mono: 'builtin:cascadia-code' });
  check(
    'the bundled font gets a @font-face rule',
    /@font-face\{font-family:"Cascadia Code";src:url\("[^"]*\/fonts\/CascadiaCode\.woff2"\) format\("woff2"\)/.test(styleText()),
    true,
  );
  check(
    'choosing it rewrites the code font variable',
    html.style.getPropertyValue('--font-mono'),
    '"Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  );
  check('and leaves the interface font on the system stack', html.style.getPropertyValue('--font-sans'), '');

  // "System default" has to stay reachable.
  applyFonts([], { sans: '', mono: '' });
  check('an empty choice clears the override', html.style.getPropertyValue('--font-mono'), '');
  check('the bundled rule is still declared', styleText().includes('CascadiaCode.woff2'), true);

  applyFonts(uploaded, { sans: 'abc', mono: 'abc' });
  check('an uploaded font is declared', styleText().includes('/api/fonts/abc/file'), true);
  check('the interface stack uses its family', html.style.getPropertyValue('--font-sans'), '"My Font"');
  check(
    'the code stack keeps its fallbacks',
    html.style.getPropertyValue('--font-mono'),
    '"My Font", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  );

  check('a bundled id counts as existing', fontExists(uploaded, 'builtin:cascadia-code'), true);
  check('an uploaded id counts as existing', fontExists(uploaded, 'abc'), true);
  check('an empty id is always fine', fontExists(uploaded, ''), true);
  check('a deleted id does not', fontExists(uploaded, 'gone'), false);
  check('an unknown bundled id does not', fontExists(uploaded, 'builtin:nope'), false);

  const list = availableFonts(uploaded);
  check('bundled fonts are listed first', list[0].id, 'builtin:cascadia-code');
  check('and flagged as bundled', list[0].builtin, true);
  check('a bundled font only fits its own role', list[0].kind, 'mono');
  check('an upload is offered for both roles', list[1].kind, 'both');

  // Which files in a folder are worth showing.
  check('a jpg is an image', wallpaperKindOf('a.JPG'), 'image');
  check('a webp is an image', wallpaperKindOf('b.webp'), 'image');
  check('an mp4 is a video', wallpaperKindOf('loop.mp4'), 'video');
  check('a text file is neither', wallpaperKindOf('notes.txt'), null);
  check('a name without extension is neither', wallpaperKindOf('README'), null);

}

/* --- finding Wallpaper Engine inside a folder the user granted ------------ */
const { pickLibrary, canPickDirectory, readEntry } = await import('./src/lib/local-wallpapers');

console.log('\nSteam wallpaper detection (jsdom)');
{
  interface FakeFile {
    kind: 'file';
    name: string;
    getFile(): Promise<File>;
  }
  interface FakeDir {
    kind: 'directory';
    name: string;
    getDirectoryHandle(name: string): Promise<FakeDir>;
    entries(): AsyncIterableIterator<[string, FakeFile | FakeDir]>;
  }
  /** A file the picker would hand over; project.json is the only one read. */
  const fakeFile = (name: string, body = ''): FakeFile => ({
    kind: 'file',
    name,
    getFile: async () => ({ name, size: body.length, type: '', text: async () => body }) as unknown as File,
  });
  const fakeDir = (name: string, children: (FakeFile | FakeDir)[]): FakeDir => ({
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string) {
      const found = children.find((entry) => entry.kind === 'directory' && entry.name === child);
      if (!found) throw new Error('NotFoundError');
      return found as FakeDir;
    },
    async *entries() {
      for (const child of children) yield [child.name, child] as [string, FakeFile | FakeDir];
    },
  });

  const project = (fields: Record<string, string>) => fakeFile('project.json', JSON.stringify(fields));

  // A realistic library: a scene wallpaper that only Wallpaper Engine can draw,
  // a video one, a plain image one, and a hidden cache folder.
  const engine = fakeDir('431960', [
    fakeDir('aurora', [project({ title: '极光', type: 'scene', file: 'scene.pkg' }), fakeFile('scene.pkg'), fakeFile('preview.jpg')]),
    fakeDir('rain', [project({ title: '雨夜东京', type: 'video', file: 'wallpaper.mp4' }), fakeFile('wallpaper.mp4'), fakeFile('preview.gif')]),
    fakeDir('plain', [fakeFile('wallpaper.jpg')]),
    fakeDir('.cache', [fakeFile('junk.jpg')]),
  ]);
  const steam = fakeDir('Steam', [fakeDir('steamapps', [fakeDir('workshop', [fakeDir('content', [engine])])])]);
  const loose = fakeDir('Pictures', [fakeFile('a.jpg'), fakeFile('b.mp4'), fakeFile('notes.txt')]);
  const barren = fakeDir('431960', [
    fakeDir('hollow', [project({ title: '空场景', type: 'scene', file: 'scene.pkg' }), fakeFile('scene.pkg')]),
  ]);

  check('the picker is reported as available', canPickDirectory(), false);
  (w as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => steam;
  check('and once the browser has it, so do we', canPickDirectory(), true);

  // The whole point: hand over the Steam folder, land on the library.
  const found = await pickLibrary();
  check('picking the Steam folder succeeds', found.status, 'ok');
  const library = found.status === 'ok' ? found.library : null;
  check(
    'the path down to the library is reported',
    library?.trail.join('/'),
    'Steam/steamapps/workshop/content/431960',
  );
  check('and it is marked as auto-detected', library?.detected, true);
  check('the root used is the library itself', library?.label, '431960');

  const byTitle = new Map(library?.entries.map((e) => [e.title, e]) ?? []);
  // Folders without a project.json fall back to a tidied up folder name.
  check(
    'one entry per wallpaper folder, dot folders skipped',
    [...byTitle.keys()].sort(),
    ['Plain', '极光', '雨夜东京'].sort(),
  );

  // A scene is a packed scene.pkg with compiled shaders: no browser can draw
  // it, so the wallpaper falls back to its own preview still.
  const scene = byTitle.get('极光');
  check('a scene wallpaper falls back to its preview', scene?.file, 'aurora/preview.jpg');
  check('and is marked as a still', scene?.still, true);
  check('and explains why', Boolean(scene?.note), true);
  check('the still is drawn as an image', scene?.kind, 'image');

  const video = byTitle.get('雨夜东京');
  check('a video wallpaper plays its own file', video?.file, 'rain/wallpaper.mp4');
  check('and previews with the still', video?.preview, 'rain/preview.gif');
  check('marked as a video', video?.kind, 'video');

  const plain = byTitle.get('Plain');
  check('a folder without project.json still works', plain?.file, 'plain/wallpaper.jpg');
  check('and is an image', plain?.kind, 'image');

  // The point of the fallback: clicking a scene has to hand back a real file.
  check('clicking a scene loads its preview image', (await readEntry(scene!)).name, 'preview.jpg');
  check('clicking a video loads the video itself', (await readEntry(video!)).name, 'wallpaper.mp4');

  // Pointing straight at the library is the same thing without the walk.
  (w as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => engine;
  const direct = await pickLibrary();
  check('picking 431960 directly works too', direct.status === 'ok' ? direct.library.entries.length : -1, 3);
  check('and is not reported as a detection', direct.status === 'ok' ? direct.library.detected : null, false);

  // A scene with no preview has nothing to fall back to.
  (w as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => barren;
  const hollow = await pickLibrary();
  const only = hollow.status === 'ok' ? hollow.library.entries[0] : null;
  check('a scene without a preview has no file', only?.file, undefined);
  check('and is not marked as a still', Boolean(only?.still), false);
  check('and says there is nothing to use', Boolean(only?.note), true);

  // An ordinary folder of pictures keeps the flat listing.
  (w as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => loose;
  const flat = await pickLibrary();
  check('a plain folder lists its media', flat.status === 'ok' ? flat.library.entries.length : -1, 2);
  check(
    'and skips everything else',
    flat.status === 'ok' ? flat.library.entries.map((e) => e.title).sort() : [],
    ['A.jpg', 'B.mp4'],
  );

  delete (w as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;

  // The directory input takes the same Steam rules.
  const fake = (relative: string) =>
    ({ name: relative.split('/').pop() ?? '', webkitRelativePath: relative }) as unknown as File;
  const fromInput = libraryFromFiles(
    [
      fake('431960/rain/wallpaper.mp4'),
      fake('431960/rain/preview.gif'),
      fake('431960/aurora/scene.pkg'),
      fake('431960/aurora/preview.jpg'),
      fake('431960/.cache/hidden.jpg'),
    ],
    '431960',
  );
  check('the folder name is kept for the header', fromInput.label, '431960');
  check('a directory input is marked as such', fromInput.via, 'input');
  check('an input with a library in it is a detection', fromInput.detected, true);
  check(
    'grouped one entry per wallpaper, dot folders skipped',
    fromInput.entries.map((e) => e.title).sort(),
    ['Aurora', 'Rain'].sort(),
  );
  check(
    'the video is playable',
    fromInput.entries.find((e) => e.title === 'Rain')?.file,
    'rain/wallpaper.mp4',
  );
  const sceneFromInput = fromInput.entries.find((e) => e.title === 'Aurora');
  check('the scene falls back to its preview there too', sceneFromInput?.file, 'aurora/preview.jpg');
  check('and is marked as a still', sceneFromInput?.still, true);
}

/* --- wallpaper blur compensation and tooltip placement -------------------- */
const { Wallpaper } = await import('./src/components/Wallpaper');
const { SessionFooter } = await import('./src/components/Sidebar');

console.log('\nwallpaper framing and hover labels (jsdom)');
{
  const hold = appStore.getState();
  const render = async (node: React.ReactElement) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(node);
    });
    const html = host.innerHTML;
    await act(async () => {
      r.unmount();
    });
    host.remove();
    return html;
  };

  const show = (blur: number, scale: number) =>
    appStore.setState({
      wallpaper: { kind: 'image', source: 'url', url: 'https://cdn.example.com/a.png', blur, dim: 0.35, scale },
      wallpaperUrl: 'https://cdn.example.com/a.png',
    });

  // No blur: the picture fills the frame exactly, so no filter and no zoom.
  show(0, 1);
  let markup = await render(React.createElement(Wallpaper));
  check('a sharp wallpaper is neither filtered nor zoomed', /filter:|transform:/.test(markup), false);
  check('and it is drawn with object-fit cover', markup.includes('wallpaper-media'), true);

  // Blur: a blur samples past the edge, so without compensation the picture
  // fades away from the frame. The element has to grow to push that off screen.
  show(24, 1);
  markup = await render(React.createElement(Wallpaper));
  check('a blurred wallpaper is blurred', /filter:\s*blur\(24px\)/.test(markup), true);
  const zoom = Number((markup.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? '1');
  check('and zoomed enough to hide the faded edge', zoom > 1.1 && zoom < 1.3, true);

  // The user's own zoom multiplies on top of it rather than replacing it.
  show(24, 1.5);
  markup = await render(React.createElement(Wallpaper));
  const both = Number((markup.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? '1');
  check('the user zoom stacks on the compensation', both > 1.5, true);

  // The four footer buttons sit on an edge the panel clips, so their labels
  // have to open upward or they are cut in half.
  appStore.setState({
    user: {
      id: 'u1',
      username: 'admin',
      displayName: 'admin',
      role: 'admin',
      provider: 'local',
      permissions: { write: true, rename: true, move: true, remove: true },
    } as never,
  });
  const footer = await render(React.createElement(SessionFooter));
  const upward = (footer.match(/bottom-\[calc\(100%\+6px\)\]/g) ?? []).length;
  const downward = (footer.match(/top-\[calc\(100%\+6px\)\]/g) ?? []).length;
  check('every footer label opens upward', upward, 4);
  check('none of them opens downward into the clipped edge', downward, 0);

  appStore.setState(hold);
}

/* --- the editor and the preview draw code with the same palette ----------- */
const { CODE_COLOURS, CODE_TAG_RULES, HLJS_CLASSES, codeColour, codeHighlight, codeThemeCss, installCodeTheme } =
  await import('./src/lib/code-theme');

console.log('\ncode palette shared by both panes (jsdom)');
{
  const css = codeThemeCss();
  const tokens = Object.keys(CODE_COLOURS) as (keyof typeof CODE_COLOURS)[];

  // HighlightStyle.style() hands back the class names it generated, and the
  // colours live in the stylesheet CodeMirror builds from them, so read that.
  const editorClassColours = (dark: boolean) => {
    const style = codeHighlight(dark);
    const rules = style.module?.getRules() ?? '';
    const byClass = new Map<string, string>();
    for (const rule of rules.matchAll(/\.([^\s{,]+)\s*\{([^}]*)\}/g)) {
      const colour = /color:\s*([^;}]+)/.exec(rule[2])?.[1];
      if (colour) byClass.set(rule[1], colour.trim().toLowerCase());
    }
    return (tags: unknown[]) => {
      const classes = style.style(tags as never) ?? '';
      return byClass.get(classes.split(' ')[0]) ?? `(no rule for ${classes})`;
    };
  };

  const mismatched: string[] = [];
  for (const token of tokens) {
    const rule = CODE_TAG_RULES.find(([, name]) => name === token);
    const tags = rule ? (Array.isArray(rule[0]) ? rule[0] : [rule[0]]) : [];
    for (const dark of [true, false]) {
      const wanted = codeColour(token, dark).toLowerCase();
      const theme = dark ? 'dark' : 'light';
      // preview: the custom property the generated CSS declares for this theme
      const scope = dark ? /\.dark\{([^}]*)\}/.exec(css)?.[1] ?? '' : /:root\{([^}]*)\}/.exec(css)?.[1] ?? '';
      const declared = new RegExp(`--code-${token}:([^;]+)`).exec(scope)?.[1]?.toLowerCase();
      if (declared !== wanted) mismatched.push(`${token}/${theme} preview=${declared} want=${wanted}`);
      // editor: what CodeMirror's own stylesheet resolves for this token's tags
      const fromEditor = editorClassColours(dark)(tags);
      if (fromEditor !== wanted) mismatched.push(`${token}/${theme} editor=${fromEditor} want=${wanted}`);
    }
  }
  check('every token resolves to one colour in both panes', mismatched, []);

  // The two panes must not be able to disagree: the same tag has to come out
  // the same whichever side renders it.
  const keywords = editorClassColours(true)((CODE_TAG_RULES[0][0] as never[]).slice());
  check('the editor really is on the shared palette', keywords, CODE_COLOURS.keyword.dark.toLowerCase());

  // Every highlight.js class has to point at a token that exists, or it would
  // silently fall back to the surrounding text colour.
  const unknown = Object.entries(HLJS_CLASSES)
    .filter(([, token]) => !(token in CODE_COLOURS))
    .map(([cls]) => cls);
  check('every highlight.js class maps onto a real token', unknown, []);
  // A class is usually grouped with its siblings, so find the rule it sits in
  // rather than expecting it to be alone.
  const ruleFor = (selector: string) =>
    css.split('\n').find((line) => line.includes(selector) && line.includes('color:var('));
  check('a highlight.js rule is emitted per class', /^\.hljs-keyword,.+\{color:var\(--code-keyword\)\}$/m.test(css), true);
  check('attributes ride the variable token', ruleFor('.hljs-attr')?.includes('var(--code-variable)'), true);
  check('function titles beat plain titles', css.includes('.hljs-title.function_,.hljs-function .hljs-title'), true);

  // Typography, so a block does not change shape across the splitter.
  check('both panes use the same code size', css.includes('--code-font-size:14.5px'), true);
  check('and the same leading', css.includes('--code-line-height:1.75'), true);
  check('the preview block takes them from the variable', css.includes('font-size:var(--code-font-size)'), true);

  // And the editor really installs those colours: mount it and look at the
  // stylesheet CodeMirror generates for the highlight style.
  document.getElementById('code-theme')?.remove();
  installCodeTheme();
  const installed = document.getElementById('code-theme')?.textContent ?? '';
  check('the palette is installed as a style element', installed.length > 0, true);
  check('the dark scope carries the dark values', installed.includes(`--code-keyword:${CODE_COLOURS.keyword.dark}`), true);
  check('the light scope carries the light values', installed.includes(`--code-keyword:${CODE_COLOURS.keyword.light}`), true);
}

/* --- the appearance dialog actually renders both states -------------------- */
const { AppearanceDialog } = await import('./src/components/AppearanceDialog');
const { closeLibrary } = await import('./src/lib/local-wallpapers');

console.log('\nappearance dialog (jsdom)');
{
  const renderDialog = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(React.createElement(AppearanceDialog));
    });
    await flush();
    const html = host.innerHTML;
    await act(async () => {
      r.unmount();
    });
    host.remove();
    return html;
  };

  const hold = appStore.getState();
  const entry = (title: string, extra: Record<string, unknown> = {}) => ({
    path: `${title}/wallpaper.jpg`,
    title,
    file: `${title}/wallpaper.jpg`,
    kind: 'image' as const,
    ...extra,
  });

  // Nothing granted yet: say why, and where to look.
  closeLibrary();
  appStore.setState({
    appearanceOpen: true,
    wallpaper: { kind: 'image', source: 'library', url: '', blur: 0, dim: 0.35, scale: 1 },
    wallpaperUrl: null,
  });
  let markup = await renderDialog();
  check('the library source renders', markup.includes('检测壁纸文件夹'), true);
  check('and explains that a path cannot be read directly', markup.includes('steamapps'), true);
  check('and offers the standard Steam locations', markup.includes('431960'), true);

  // With a library open: the detection trail, the grid, and the preview-only case.
  libraryFromFiles(
    [
      { name: 'wallpaper.mp4', webkitRelativePath: '431960/rain/wallpaper.mp4' } as unknown as File,
      { name: 'preview.gif', webkitRelativePath: '431960/rain/preview.gif' } as unknown as File,
      { name: 'scene.pkg', webkitRelativePath: '431960/aurora/scene.pkg' } as unknown as File,
      { name: 'preview.jpg', webkitRelativePath: '431960/aurora/preview.jpg' } as unknown as File,
    ],
    '431960',
  );
  markup = await renderDialog();
  check('the detected library is announced', markup.includes('已自动定位壁纸库'), true);
  check('the path that was walked is shown', markup.includes('431960'), true);
  check('both wallpapers are listed', markup.includes('Rain') && markup.includes('Aurora'), true);
  check('the video is settable', markup.includes('2 个可设置'), true);
  check('the scene is offered as a still', markup.includes('1 个为静态预览'), true);
  check('and carries the 静态 badge', markup.includes('静态'), true);
  check('nothing is reported unusable', markup.includes('个不可用'), false);

  appStore.setState(hold);
  closeLibrary();
  void entry;
}

/* --- the running version is visible in the page ---------------------------- */
const { NotesPanel } = await import('./src/components/NoteList');
const { SettingsDialog } = await import('./src/components/SettingsDialog');

console.log('\nversion display (jsdom)');
{
  const renderOnce = async (node: React.ReactElement) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(node);
    });
    await flush();
    const html = host.innerHTML;
    await act(async () => {
      r.unmount();
    });
    host.remove();
    return html;
  };

  const hold = appStore.getState();

  // Nothing reported yet: no version is invented.
  appStore.setState({ status: null });
  check('no version is shown before the server reports one', (await renderOnce(React.createElement(NotesPanel))).includes('v1.0.0'), false);

  appStore.setState({
    status: { version: '1.0.0', basePath: '', publicUrl: '', uptimeSeconds: 5 } as never,
  });
  check('the panel header shows the version', (await renderOnce(React.createElement(NotesPanel))).includes('v1.0.0'), true);

  appStore.setState({ settingsOpen: true });
  const settings = await renderOnce(React.createElement(SettingsDialog));
  check('the settings dialog shows it too', settings.includes('v1.0.0'), true);
  check('labelled as 版本', settings.includes('版本'), true);

  appStore.setState(hold);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
