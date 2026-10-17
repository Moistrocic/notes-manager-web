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
// Type only: erased at compile time, so it cannot run before the globals below.
import type { CropRect } from './src/lib/wallpaper';
import type { BlogPostSummary, NoteSummary } from './src/lib/types';

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
// Without these the store's persistence caught a ReferenceError on every read
// and fell back to its defaults, so anything it remembers between sessions was
// silently untested.
define('localStorage', w.localStorage);
define('sessionStorage', w.sessionStorage);
define('HTMLElement', w.HTMLElement);
define('Element', w.Element);
define('Node', w.Node);
define('getComputedStyle', w.getComputedStyle.bind(w));
define('requestAnimationFrame', (cb: FrameRequestCallback) => w.setTimeout(() => cb(Date.now()), 0));
define('cancelAnimationFrame', (id: number) => w.clearTimeout(id));
const matchMediaStub = () => ({
  matches: true,
  media: '',
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});
define('matchMedia', matchMediaStub);
// Components call window.matchMedia, which jsdom does not implement.
(w as unknown as { matchMedia: unknown }).matchMedia = matchMediaStub;
// jsdom has no ImageData, and the custom wallpaper's particle sprites put one
// together before drawing. A plain holder is enough: only the canvas stub below
// ever reads it, and that just needs the shape.
class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
define('ImageData', FakeImageData);
(w as unknown as { ImageData: unknown }).ImageData = FakeImageData;
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
  kind: 'note' as const,
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

/** Opens every branch of the outline: it starts folded, showing top-level headings. */
const expandOutline = async () => {
  await act(async () => {
    host
      .querySelector('[data-testid="outline-toggle-all"]')
      ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

const outlineButtons = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-panel button')).filter((b) =>
    b.textContent?.includes('1.2'),
  );

// 0. The outline folds, and it starts folded to the top level: a long note is for
// reading, and the outline is for finding a section in it.
const outlineRows = () => Array.from(host.querySelectorAll('.outline-panel li'));
const collapseButtons = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-panel [data-outline-collapse]'));
const collapseToggle = () => host.querySelector<HTMLButtonElement>('.outline-panel [data-outline-collapse]');
const toggleAll = () => host.querySelector<HTMLButtonElement>('[data-testid="outline-toggle-all"]');
const outlineClick = async (element: Element | null | undefined) => {
  await act(async () => {
    element?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

check('the outline starts folded', outlineRows().length, 1);
check('showing only the top-level heading', outlineRows()[0]?.textContent?.trim(), '1.1 分层');
check('with a fold control that says it is folded', collapseToggle()?.getAttribute('aria-expanded'), 'false');
check('named for the section it holds', collapseToggle()?.getAttribute('aria-label'), '展开 1.1 分层');
check('and one control for all of them', toggleAll()?.getAttribute('aria-label'), '全部展开');

await outlineClick(collapseToggle());
check('opening a section shows what is under it', outlineRows().length, 2);
check('which says it is open', collapseToggle()?.getAttribute('aria-expanded'), 'true');
check('and offers to close it again', collapseToggle()?.getAttribute('aria-label'), '收起 1.1 分层');
check(
  'the section under it is drawn but still folded',
  outlineRows().map((row) => row.textContent?.trim()),
  ['1.1 分层', '1.2 权限'],
);
await outlineClick(collapseButtons()[1]);
check('opening the nested section shows the deepest heading', outlineRows().length, 3);
await outlineClick(collapseButtons()[1]);
check('closing it puts it away again', outlineRows().length, 2);
await outlineClick(collapseToggle());
check('closing the parent hides everything under it', outlineRows().length, 1);

// One control for all of them.
await outlineClick(toggleAll());
check('opening everything shows every heading', outlineRows().length, 3);
check('and the control now offers the other way', toggleAll()?.getAttribute('aria-label'), '全部收起');
check(
  'each section says it is open',
  collapseButtons().map((button) => button.getAttribute('aria-expanded')),
  ['true', 'true'],
);
// Navigation is a heading and its place in the flat list, whatever is folded.
w.history.replaceState(null, '', '/public/Notes/nav.md');
const detailsButton = Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-panel button')).find(
  (button) => button.textContent?.trim() === 'Details',
);
check('the deepest heading is there to click', Boolean(detailsButton), true);
await outlineClick(detailsButton);
check('and clicking it navigates there', decodeURIComponent(w.location.hash), '#details');

// A different note starts folded again - the outline is about the note in front
// of you, not about where you were in the last one.
await act(async () => {
  appStore.setState({ activeNote: { ...note, id: 'nav2', content: '# A\n\n## B\n\n## C\n' } } as never);
});
await flush();
check('another note starts folded', outlineRows().length, 1);
check('with its own top-level heading', outlineRows()[0]?.textContent?.trim(), 'A');
await act(async () => {
  appStore.setState({ activeNote: note } as never);
});
await flush();
check('and going back starts folded too', outlineRows().length, 1);

// 1. the outline is rendered with the document's headings. It opens folded, so
// every branch has to be opened before all three are on screen.
await expandOutline();
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
  // Steam is not always where the conventions say: C:\Games\Steam is a real
  // example, and a page cannot read the registry to find that out.
  const gamesRoot = fakeDir('Games', [steam]);
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
    'the picked folder is the root of the search',
    library?.trail.join('/'),
    'Steam',
  );
  // There is no searching for a Steam layout any more: what was picked is the
  // root, and the recursion below it is what finds the wallpapers.
  check('and no longer guesses at the layout', library?.detected, false);

  const byTitle = new Map(library?.entries.map((e) => [e.title, e]) ?? []);
  // Folders without a project.json fall back to a tidied up folder name.
  check(
    'one entry per wallpaper folder, dot folders skipped',
    [...byTitle.keys()].sort(),
    ['Wallpaper.jpg', '极光', '雨夜东京'].sort(),
  );

  // A scene is a packed scene.pkg with compiled shaders: no browser can draw
  // it, so the wallpaper falls back to its own preview still.
  const scene = byTitle.get('极光');
  check('a scene wallpaper falls back to its preview', scene?.file, 'steamapps/workshop/content/431960/aurora/preview.jpg');
  check('and is marked as a still', scene?.still, true);
  check('and explains why', Boolean(scene?.note), true);
  check('the still is drawn as an image', scene?.kind, 'image');
  // The whole point of the fallback: the real background is in the pkg.
  check('and the scene.pkg is offered for compositing', scene?.scene, 'steamapps/workshop/content/431960/aurora/scene.pkg');

  const video = byTitle.get('雨夜东京');
  check('a video wallpaper plays its own file', video?.file, 'steamapps/workshop/content/431960/rain/wallpaper.mp4');
  check('and previews with the still', video?.preview, 'steamapps/workshop/content/431960/rain/preview.gif');
  check('marked as a video', video?.kind, 'video');

  const plain = byTitle.get('Wallpaper.jpg');
  check('a folder without project.json still works', plain?.file, 'steamapps/workshop/content/431960/plain/wallpaper.jpg');
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

  // Handed a folder above Steam rather than Steam itself, the library is
  // searched for instead of being given up on.
  (w as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => gamesRoot;
  const searched = await pickLibrary();
  check('a parent folder still finds the library', searched.status === 'ok' ? searched.library.entries.length : -1, 3);
  check(
    'and reports the path it walked',
    searched.status === 'ok' ? searched.library.trail.join('/') : '',
    'Games',
  );
  check('and is not claimed as a detection either', searched.status === 'ok' ? searched.library.detected : null, false);

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

const { acceptFor, clampCrop, cropForRatio, DEFAULT_WALLPAPER, MIN_CROP, resizeCrop } =
  await import('./src/lib/wallpaper');

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

  const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
  const show = (blur: number, crop: CropRect) =>
    appStore.setState({
      wallpaper: {
        kind: 'image',
        source: 'url',
        url: 'https://cdn.example.com/a.png',
        blur,
        dim: 0.35,
        crop,
        dynamicScene: false,
        useAdminBackground: true,
        auroraA: '',
        auroraB: '',
        autoAccent: true,
        accentColor: '',
        customA: '',
        customB: '',
        customDrift: 0.5,
        customSpeed: 1,
        customDensity: 60,
      },
      wallpaperUrl: 'https://cdn.example.com/a.png',
    });

  // No blur and no crop: the picture fills the frame, nothing is transformed.
  show(0, FULL);
  let markup = await render(React.createElement(Wallpaper));
  check('a sharp, whole wallpaper is neither filtered nor transformed', /filter:|transform:/.test(markup), false);
  check('and it is drawn at the size of the layer', /width:\s*100%/.test(markup), true);

  // Blur: a blur samples past the edge, so without compensation the picture
  // fades away from the frame. The element has to grow to push that off screen.
  show(24, FULL);
  markup = await render(React.createElement(Wallpaper));
  check('a blurred wallpaper is blurred', /filter:\s*blur\(24px\)/.test(markup), true);
  const zoom = Number((markup.match(/scale\(([\d.]+)\)/) ?? [])[1] ?? '1');
  check('and zoomed enough to hide the faded edge', zoom > 1.1 && zoom < 1.3, true);

  // The selection is what fills the screen: a quarter-size box is magnified
  // four times and offset so its corner meets the layer's.
  show(0, { x: 0.25, y: 0.5, w: 0.25, h: 0.25 });
  const cropped = await render(React.createElement(Wallpaper));
  check('the selection is magnified to fill the layer', /width:\s*400%/.test(cropped), true);
  check('and its height likewise', /height:\s*400%/.test(cropped), true);
  check('and shifted so its top-left corner lands on the layer', /left:\s*-100%/.test(cropped), true);
  check('vertically too', /top:\s*-200%/.test(cropped), true);
  check('selecting a region does not itself transform anything', /transform:/.test(cropped), false);

  // The maths that backs the component, checked directly.
  check('a full selection is the whole picture', cropForRatio(null, 16 / 9), FULL);
  const band = cropForRatio(16 / 9, 1);
  check('16:9 out of a square keeps a centred band', [band.x, band.w, band.h], [0, 1, 9 / 16]);
  const pillar = cropForRatio(1, 16 / 9);
  check('1:1 out of a wide picture keeps a centred column', [pillar.y, pillar.w, pillar.h], [0, 9 / 16, 1]);
  const bounded = clampCrop({ x: -1, y: 2, w: 0.5, h: 0.5 });
  check('a selection cannot leave the picture', [bounded.x, bounded.y, bounded.w, bounded.h], [0, 0.5, 0.5, 0.5]);
  check('nor shrink below the minimum', clampCrop({ x: 0, y: 0, w: 0.001, h: 0.001 }).w, MIN_CROP);

  // Resizing: an edge moves one side, a corner scales both. That split is the
  // whole point - corners alone cannot widen a selection without heightening it.
  const box: CropRect = { x: 0.2, y: 0.2, w: 0.4, h: 0.2 };
  const round4 = (n: number) => Number(n.toFixed(4));
  const ratio = (r: CropRect) => round4(r.w / r.h);

  const south = resizeCrop(box, 's', 0, 0.1);
  check('the bottom edge makes it taller', [round4(south.h), round4(south.w), round4(south.y)], [0.3, 0.4, 0.2]);
  const east = resizeCrop(box, 'e', 0.1, 0);
  check('the right edge makes it wider', [round4(east.w), round4(east.h), round4(east.x)], [0.5, 0.2, 0.2]);
  const north = resizeCrop(box, 'n', 0, -0.1);
  check('the top edge moves the top and grows it', [round4(north.y), round4(north.h), round4(north.w)], [0.1, 0.3, 0.4]);
  const west = resizeCrop(box, 'w', 0.1, 0);
  check('the left edge moves the left and shrinks it', [round4(west.x), round4(west.w), round4(west.h)], [0.3, 0.3, 0.2]);

  const corner = resizeCrop(box, 'se', 0.2, 0);
  check('a corner keeps the shape', ratio(corner), ratio(box));
  check('and grows both axes', [corner.w > box.w, corner.h > box.h], [true, true]);
  check('while the opposite corner stays put', [corner.x, corner.y], [box.x, box.y]);

  const nw = resizeCrop(box, 'nw', -0.2, 0);
  check('the opposite corner scales about its own corner', ratio(nw), ratio(box));
  check('and its far edge stays put', [Number((nw.x + nw.w).toFixed(4)), Number((nw.y + nw.h).toFixed(4))], [0.6, 0.4]);

  // A corner scales both axes by one factor, so it has to stop when either
  // one reaches the picture. Capping the width afterwards left the height at
  // whatever the factor asked for, so a corner held against an edge kept
  // growing the other way - which is what a drag feels like when it will not
  // settle.
  const cornerBox: CropRect = { x: 0, y: 0, w: 0.5, h: 0.1 };
  const stopped = resizeCrop(cornerBox, 'se', 5, 0);
  check('a corner at the right edge stops both axes', [round4(stopped.w), round4(stopped.h)], [1, 0.2]);
  const further = resizeCrop(cornerBox, 'se', 50, 0);
  check('and dragging further changes nothing', [round4(further.w), round4(further.h)], [round4(stopped.w), round4(stopped.h)]);

  const tallBox: CropRect = { x: 0, y: 0, w: 0.1, h: 0.5 };
  const stoppedTall = resizeCrop(tallBox, 'se', 0, 5);
  check('a corner at the bottom edge stops both axes too', [round4(stoppedTall.w), round4(stoppedTall.h)], [0.2, 1]);

  // An edge moves one side and holds the other. Without a cap the far side
  // came along for the ride once the near side left the picture.
  const edgeBox: CropRect = { x: 0.3, y: 0.2, w: 0.4, h: 0.2 };
  const pulled = resizeCrop(edgeBox, 'w', -5, 0);
  check('the west edge stops at the picture, not past it', round4(pulled.w), 0.7);
  check('and the east edge does not move', round4(pulled.x + pulled.w), round4(edgeBox.x + edgeBox.w));
  const pushed = resizeCrop(edgeBox, 'e', 5, 0);
  check('the east edge stops at the picture too', round4(pushed.x + pushed.w), 1);
  check('and the west edge does not move', round4(pushed.x), round4(edgeBox.x));

  const squashed = resizeCrop(box, 'w', 5, 0);
  check('an edge dragged past the far side stops at the minimum', squashed.w, MIN_CROP);
  check('and does not turn inside out', squashed.x + squashed.w <= box.x + box.w + 0.0001, true);
  const tiny = resizeCrop(box, 'se', -5, -5);
  check('a corner shrunk past the minimum keeps the shape', ratio(tiny), ratio(box));
  check('and respects the minimum', tiny.w >= MIN_CROP - 0.0001 && tiny.h >= MIN_CROP - 0.0001, true);

  // The window can change shape after a wallpaper is set, so a selection that
  // was right on one screen still has to cover another.
  show(0, { x: 0.1, y: 0.2, w: 0.6, h: 0.6 });
  const stillCovering = await render(React.createElement(Wallpaper));
  check('a kept selection stays on screen', /left:\s*-16.66/.test(stillCovering), true);

  // The four footer buttons sit on an edge the panel clips. Labels used to be
  // absolutely positioned inside their trigger and needed a per-call-site
  // "open upward" flag to survive it; they are rendered into the body now, so
  // there is nothing left to clip and no flag to remember. What still has to
  // hold is that each control carries its own name, since the bubble itself
  // only exists while hovered.
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
  check('no footer label is nested where it could be clipped', /role="tooltip"/.test(footer), false);
  const named = (footer.match(/aria-label="/g) ?? []).length;
  check('every footer control still carries its own name', named >= 4, true);

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
    wallpaper: {
      kind: 'image',
      source: 'library',
      url: '',
      blur: 0,
      dim: 0.35,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      dynamicScene: false,
      useAdminBackground: true,
      auroraA: '',
      auroraB: '',
      autoAccent: true,
      accentColor: '',
      customA: '',
      customB: '',
      customDrift: 0.5,
      customSpeed: 1,
      customDensity: 60,
    },
    wallpaperUrl: null,
  });
  let markup = await renderDialog();
  check('the library source renders', markup.includes('壁纸文件夹'), true);
  check('and offers the dynamic scene toggle', markup.includes('动态场景壁纸'), true);
  // It used to promise that re-picking the wallpaper was what applied it.
  check('and no longer asks for the wallpaper to be picked again', markup.includes('重新点一次'), false);
  // Fonts belong with the theme and the wallpaper, not in the server settings.
  check('fonts are part of the appearance dialog', markup.includes('界面字体'), true);
  check('with both role pickers', markup.includes('代码 / 编辑器字体'), true);
  // The little thumbnail at the bottom repeated what the crop editor shows.
  check('the redundant preview at the bottom is gone', markup.includes('效果已实时应用'), false);
  // The three kinds that were asked for, and a .pkg that can be picked as one
  // of them rather than only arriving through the folder scan.
  check('the background offers three kinds', ['极光', '本地图片', '场景壁纸'].every((k) => markup.includes(k)), true);
  check('and a .pkg is recognised as a scene', wallpaperKindOf('rossi.pkg'), 'scene');
  check('with the picker filtered to .pkg files', acceptFor('scene'), '.pkg');
  check('the administrator background switch is offered', markup.includes('使用管理员设置的默认背景'), true);

  // While the administrator's background is on, the kinds used to be inert:
  // the click landed on the section behind them and nothing changed at all.
  {
    const before = appStore.getState().wallpaper;
    try {
      appStore.setState({
        wallpaper: { ...before, kind: 'scene', useAdminBackground: true },
        adminBackground: {
          configured: true,
          kind: 'scene',
          file: 'rossi.pkg',
          bytes: 1024,
          hash: 'abc123',
          url: '/api/background/file?v=rossi.pkg',
          note: null,
          options: { crop: { x: 0, y: 0, w: 1, h: 1 }, blur: 0, dim: 0.35, dynamic: false, auroraA: '', auroraB: '' },
          available: [],
        },
      });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(React.createElement(AppearanceDialog));
      });
      await flush();
      const aurora = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('极光'));
      await act(async () => {
        aurora?.click();
      });
      await flush();
      await act(async () => {
        root.unmount();
      });
      host.remove();
      const after = appStore.getState().wallpaper;
      check('clicking 极光 while the administrator background shows takes the choice', after.kind, 'none');
      check('and turns that switch off', after.useAdminBackground, false);
    } finally {
      appStore.setState({ wallpaper: before, adminBackground: null });
    }
  }
  // The kind buttons are a choice of background, not a reset: switching to the
  // built-in one used to restore every default, which quietly turned the
  // administrator-background switch back on - and the picture the user had just
  // asked for never appeared. These checks drive the store, so they put it back
  // the way the rest of this block expects to find it.
  {
    const before = appStore.getState().wallpaper;
    const beforeUrl = appStore.getState().wallpaperUrl;
    try {
      appStore.setState({ wallpaper: { ...before, kind: 'scene', useAdminBackground: false } });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(React.createElement(AppearanceDialog));
      });
      await flush();
      const aurora = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith('极光'));
      await act(async () => {
        aurora?.click();
      });
      await flush();
      await act(async () => {
        root.unmount();
      });
      host.remove();
      const after = appStore.getState().wallpaper;
      check('choosing the theme background changes the kind', after.kind, 'none');
      check('and leaves the administrator background switch alone', after.useAdminBackground, false);

      // Resetting the wallpaper is about the wallpaper. Whose background wins
      // is a separate choice, and restoring defaults used to make it for you.
      appStore.setState({ wallpaper: { ...appStore.getState().wallpaper, useAdminBackground: false } });
      await appStore.getState().clearWallpaper();
      check('restoring defaults clears the wallpaper', appStore.getState().wallpaper.kind, 'none');
      check('without re-enabling the administrator background', appStore.getState().wallpaper.useAdminBackground, false);

      // Handing the layer the same URL it already has is not a change: a fresh
      // blob URL for the same file makes it throw the background away and
      // build the whole thing again.
      appStore.setState({
        wallpaper: { ...appStore.getState().wallpaper, kind: 'image', source: 'url', url: 'https://cdn.example.com/a.png' },
      });
      await appStore.getState().refreshWallpaperUrl();
      const first = appStore.getState().wallpaperUrl;
      await appStore.getState().refreshWallpaperUrl();
      check('a URL wallpaper keeps the URL it already has', appStore.getState().wallpaperUrl, first);
      check('and it is the configured one', first, 'https://cdn.example.com/a.png');

      // A load nobody is waiting for any more must never start: two 45 MB
      // scenes being parsed at once is what a hang looks like from outside.
      const { playScene } = await import('./src/lib/scene/play-scene');
      const controller = new AbortController();
      controller.abort();
      const started = await playScene(document.createElement('canvas'), 'blob:scene', {
        signal: controller.signal,
      }).then(
        () => 'started',
        (err: Error) => err.message,
      );
      check('a scene that was given up on is never loaded', started, '场景载入已取消');
    } finally {
      appStore.setState({ wallpaper: before, wallpaperUrl: beforeUrl });
    }
  }
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
  // A folder handed over as file paths still reports which folder it settled
  // on, and the wallpapers inside it are listed. What is gone is the guessing
  // at Steam's layout: the picked folder is the root, and the search is what
  // finds the wallpapers under it.
  check('the chosen folder is announced', markup.includes('431960'), true);
  check('and the wallpapers inside it are listed', markup.includes('Aurora') || markup.includes('Rain'), true);

  // With a wallpaper showing, the crop editor offers its shapes.
  appStore.setState({ wallpaperUrl: 'https://cdn.example.com/a.png' });
  const withPicture = await renderDialog();
  check('the crop editor appears once there is a picture', withPicture.includes('取景区'), true);
  check('with the shape presets', withPicture.includes('16:9') && withPicture.includes('整张'), true);
  check('and says how the handles behave', withPicture.includes('边改单边'), true);
  appStore.setState({ wallpaperUrl: null });

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

/* --- the whole app survives its own boot ----------------------------------- */
const { default: App } = await import('./src/App');

console.log('\napp shell (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({ wallpaper: { ...DEFAULT_WALLPAPER }, wallpaperUrl: null });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const shell = createRoot(host);
  let failure: unknown = null;

  try {
    await act(async () => {
      shell.render(React.createElement(App));
    });

    // Exactly what boot() does when a wallpaper is stored: the wallpaper goes
    // from none to image. Any hook called conditionally changes the hook count
    // here, and React responds by unmounting the entire tree - a blank page
    // with nothing but the body colour, which is a hard failure to trace back.
    await act(async () => {
      appStore.setState({
        wallpaper: { ...DEFAULT_WALLPAPER, kind: 'image', source: 'url', url: 'https://example.com/w.png' },
        wallpaperUrl: 'https://example.com/w.png',
      });
    });
    await flush();
  } catch (err) {
    failure = err;
  }

  if (failure !== null) console.log('        app shell error:', String(failure).slice(0, 400));
  check('the app survives a wallpaper appearing mid-session', failure === null, true);
  check('and is still on screen afterwards', host.innerHTML.length > 200, true);

  await act(async () => {
    shell.unmount();
  });
  host.remove();
  appStore.setState(hold);
}

/* --- the interface colour taken from the wallpaper ------------------------- */
const { applyAccent, extractAccent } = await import('./src/lib/accent');

console.log('\nwallpaper accent (jsdom)');
{
  // No 2D context here for real, which is exactly the cross-origin case: the
  // colour must be given up on rather than guessed.
  check('an unreadable picture yields no colour', extractAccent({} as CanvasImageSource), null);

  // Stand in a context so the selection itself can be checked: a big washed out
  // grey field and a small vivid red block. The red has to win on saturation,
  // not on area.
  const SAMPLE = 48;
  const pixels = new Uint8ClampedArray(SAMPLE * SAMPLE * 4);
  for (let i = 0; i < SAMPLE * SAMPLE; i += 1) {
    const inBlock = i % SAMPLE < 10 && Math.floor(i / SAMPLE) < 10;
    pixels[i * 4] = inBlock ? 220 : 130;
    pixels[i * 4 + 1] = inBlock ? 30 : 130;
    pixels[i * 4 + 2] = inBlock ? 40 : 132;
    pixels[i * 4 + 3] = 255;
  }
  const proto = w.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const original = proto.getContext;
  proto.getContext = () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) });

  const picked = extractAccent({} as CanvasImageSource);
  check('a picture yields a colour', typeof picked, 'string');
  check('and it is the vivid hue, not the grey', /^#[0-9a-f]{6}$/.test(picked ?? ''), true);
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt((picked ?? '#000000').slice(i, i + 2), 16));
  check('which is red, the colour of the block', r > g + 40 && r > b + 40, true);

  proto.getContext = original;

  // Applying is one style element and two variables, and removing it puts the
  // theme back.
  applyAccent('#ff8800');
  const style = document.getElementById('wallpaper-accent');
  check('the accent is written as a style element', Boolean(style), true);
  check('carrying the colour', style?.textContent?.includes('#ff8800'), true);
  check('and a matching soft variant', style?.textContent?.includes('--accent-soft'), true);
  applyAccent(null);
  check('clearing it removes the element', document.getElementById('wallpaper-accent'), null);

  applyAccent(null);
}

/* --- a live scene wallpaper draws into a canvas ---------------------------- */
const { canPlayScenes, playsScenesLive, probeSceneSupport, scenePixelRatio } = await import('./src/lib/scene/play-scene');

console.log('\nlive scene wallpaper (jsdom)');
{
  const renderWallpaper = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(React.createElement(Wallpaper));
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

  // Still by default: a live scene holds a GPU context and draws forever.
  check('dynamic scenes are off by default', DEFAULT_WALLPAPER.dynamicScene, false);
  check('and the browser check is honest here', canPlayScenes(), false);

  // A browser keeps only a handful of live WebGL contexts and drops the oldest
  // to make room. The question above is asked on every render of the dialog -
  // every step of a crop drag - so a probe that allocated a context per call
  // evicted the wallpaper's, and the scene never drew again.
  {
    // HTMLCanvasElement is not one of the globals this file installs, but the
    // element is real, so its prototype is where the method lives.
    const canvasProto = Object.getPrototypeOf(document.createElement('canvas')) as {
      getContext: (kind: string, ...rest: unknown[]) => unknown;
    };
    const original = canvasProto.getContext;
    let asked = 0;
    let released = 0;
    canvasProto.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      if (kind !== 'webgl2') return original.call(this, kind, ...rest);
      asked += 1;
      return {
        getExtension: (name: string) =>
          name === 'WEBGL_lose_context' ? { loseContext: () => { released += 1; } } : null,
      } as unknown as WebGL2RenderingContext;
    };
    try {
      check('the browser is asked for one WebGL2 context', probeSceneSupport(), true);
      check('exactly one, for the question', asked, 1);
      check('and it is handed straight back', released, 1);
      const remembered = canPlayScenes();
      check('asking again uses the remembered answer', [asked, remembered], [1, false]);
    } finally {
      canvasProto.getContext = original;
    }
  }

  // The renderer sizes its drawing buffer from the element, and the crop sizes
  // the element, so the selection decides how many pixels a live scene asks the
  // GPU for - at every frame. Past the screen's own resolution there is nothing
  // to see and a driver to lose.
  {
    const sized = (width: number, height: number) => {
      const canvas = document.createElement('canvas');
      Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
      return canvas;
    };
    const dpr = window.devicePixelRatio || 1;
    check('a scene that fits the screen is rendered at the screen ratio', scenePixelRatio(sized(1600, 900)), dpr);
    const magnified = scenePixelRatio(sized(16000, 9000));
    check('a magnified selection is not rendered at its own size', magnified < dpr, true);
    check('and its buffer fits the pixel budget', 16000 * magnified * 9000 * magnified <= 16_000_001, true);
    check('and the side limit', 16000 * magnified <= 8192, true);
    check('a tiny element is never scaled up', scenePixelRatio(sized(100, 60)) <= dpr, true);
  }

  // The switch is what decides, and the browser has the last word: this is the
  // choice that makes turning the switch reload the background by itself,
  // rather than the wallpaper having to be picked again.
  check('a scene plays live only with the switch on', [playsScenesLive('scene', false), playsScenesLive('scene', true)], [false, canPlayScenes()]);
  check('and only a scene can', playsScenesLive('image', true), false);

  appStore.setState({
    wallpaper: { ...DEFAULT_WALLPAPER, kind: 'scene', source: 'library', dynamicScene: true },
    wallpaperUrl: 'blob:scene',
  });
  const markup = await renderWallpaper();
  // No WebGL2 and no worker here, so a scene is shown as a picture of itself -
  // and in jsdom even that cannot be composited, so nothing is drawn at all.
  check('a scene this browser cannot play is not given a live canvas', markup.includes('<canvas'), false);

  appStore.setState(hold);
}

/* --- the redesigned note list --------------------------------------------- */
const { NotesPanel } = await import('./src/components/NoteList');
const { useHotkeys } = await import('./src/hooks/useHotkeys');
const { EditorView } = await import('@codemirror/view');

/** A note summary as the server would send it, for the panel sections below. */
const summaryNote = (
  id: string,
  title: string,
  folder: string,
  extra: Partial<NoteSummary> = {},
): NoteSummary => ({
  id,
  // Every entry the server lists says what it is; a markdown note unless the
  // fixture asks for a picture or some other file.
  kind: 'note',
  // A fixture is not published to the blog unless it says so.
  blog: false,
  blogAt: null,
  blogTitle: null,
  blogSummary: null,
  hasPublishInfo: false,
  title,
  tags: [],
  pinned: false,
  favorite: false,
  color: null,
  folder,
  path: folder ? `${folder}/${id}.md` : `${id}.md`,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  excerpt: '正文内容',
  wordCount: 4,
  size: 10,
  hasFrontMatter: true,
  ...extra,
});

/** Write permission, which most of the panel's verbs are behind. */
const WRITABLE = {
  driver: 'openlist',
  root: '/public/Notes',
  writable: true,
  permissions: { write: true, rename: true, move: true, remove: true },
};

/**
 * Mounts the panel and keeps it mounted.
 *
 * The tree's menus and its long press need a tree that is still there when the
 * second event arrives. The renderOnce helper below unmounts before it hands
 * back the markup, which is enough for reading but not for clicking.
 */
async function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(NotesPanel));
  });
  await flush();
  return {
    host,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** A right-click, the way a browser delivers one. */
async function rightClick(target: Element, at = { x: 40, y: 60 }) {
  const event = new w.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await flush();
  return event;
}

/** The ids of the items on the menu that is open, in the order they are drawn. */
const openMenuItems = () =>
  Array.from(document.querySelectorAll('[data-menu-item]')).map((item) => item.getAttribute('data-menu-item'));

/** What those items say, shortcut included. */
const openMenuLabels = () =>
  Array.from(document.querySelectorAll('[data-menu-item]')).map((item) => item.textContent ?? '');

/**
 * Waits for an exit animation to finish.
 *
 * The menus, the dialogs and the app's two front doors are all wrapped in
 * AnimatePresence, and jsdom runs no animation frames of its own: the markup
 * lingers until a few timers have gone by. Asking the DOM straight after a close
 * would only ever see the copy that is on its way out.
 */
async function settled(ms = 500) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Escape is how the app's menus close. */
async function closeMenu() {
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await settled();
}

/**
 * Types into a controlled input the way a browser does.
 *
 * React remembers the value it last wrote to the node, so assigning `.value`
 * directly is noticed - and ignored. The native setter has to be used, then an
 * `input` event sent, which is what a keystroke ends with.
 */
async function typeIntoInput(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(selector);
  if (!element) return;
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await flush();
}

console.log('\nnote list (jsdom)');
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

  appStore.setState({
    notes: [
      summaryNote('a', '根目录笔记', ''),
      summaryNote('b', '项目笔记', 'proj'),
      summaryNote('c', '子目录笔记', 'proj/deep'),
      summaryNote('d', '收藏笔记', 'proj', { favorite: true }),
      summaryNote('e', '置顶笔记', '', { pinned: true }),
    ],
    folders: [
      { path: 'proj', name: 'proj', count: 2, depth: 0 },
      { path: 'proj/deep', name: 'deep', count: 1, depth: 1 },
    ],
    query: '',
    activeFolder: null,
    activeTag: null,
    favoriteOnly: false,
    pinnedOnly: false,
    searchScope: { title: true, content: true, tags: true },
    expandedFolders: [],
    loadingNotes: false,
    notesError: null,
  });

  const tree = await renderOnce(React.createElement(NotesPanel));

  check('the tree shows its folders', tree.includes('proj'), true);
  check('and the notes at the root', tree.includes('根目录笔记'), true);
  // A collapsed folder hides its contents; that is the point of a tree.
  check('a collapsed folder keeps its notes out of sight', tree.includes('项目笔记'), false);
  // Every verb used to live on a toolbar that appeared under the pointer, where
  // it covered the title it belonged to. They are on the right-click menu now,
  // so a row nobody has right-clicked shows none of them. (The menus themselves
  // are asserted further down, on a tree that is still mounted.)
  check(
    'no verb is left lying on a row',
    ['新建子文件夹', '新建顶层文件夹', '重命名文件夹', '移入回收站，可恢复', '重命名笔记', '移动到文件夹', '取消收藏'].filter(
      (label) => tree.includes(label),
    ),
    [],
  );
  // Required even here: state is not a property of how the list is arranged.
  check('and a pinned note is marked in the tree', /lucide-pin/.test(tree), true);

  // Selecting a folder elsewhere has to make it reachable, so the path down to
  // it unfolds on its own.
  appStore.setState({ activeFolder: 'proj' });
  const opened = await renderOnce(React.createElement(NotesPanel));
  check('opening a folder shows its notes', opened.includes('项目笔记'), true);
  check('and its nested folders', opened.includes('deep'), true);
  check('and a favourite is marked in the tree', /lucide-star/.test(opened), true);
  appStore.setState({ activeFolder: null });

  // The three actions the design asks for, in order.
  check('the panel offers exactly the three primary actions', ['新建笔记', '上传文件', '回收站'].every((label) => tree.includes(label)), true);

  // The expander has to be clickable: the label area around it is
  // pointer-events-none, and without this a folder could only ever open.
  check('the folder expander can actually be clicked', /focus-ring pointer-events-auto[^"]*"[^>]*aria-label="展开"/.test(tree) || (tree.includes('pointer-events-auto') && tree.includes('aria-label="展开"')), true);
  // The row that made a folder at the root is gone: that is something a
  // top-level folder's own menu offers, beside the folder it will sit next to.
  check('and no standalone row for making one at the root', tree.includes('在根目录新建文件夹'), false);

  // Clicking a folder opens it rather than filtering to it - asserted through
  // the absence of the filter chip, which selecting a folder used to raise.
  check('a folder row does not select or filter', tree.includes('清除筛选'), false);

  // Narrowing the search must actually narrow, not just look different.
  // Opened, so the note the query matches is actually on screen.
  appStore.setState({ query: '收藏', activeFolder: 'proj' });
  check('a search looks at titles by default', (await renderOnce(React.createElement(NotesPanel))).includes('收藏笔记'), true);
  appStore.setState({ searchScope: { title: false, content: false, tags: true } });
  const tagsOnly = await renderOnce(React.createElement(NotesPanel));
  check('and can be aimed at tags alone', tagsOnly.includes('收藏笔记'), false);
  check('which the panel says it is doing', tagsOnly.includes('已筛选'), true);
  appStore.setState({ query: '', searchScope: { title: true, content: true, tags: true } });

  // Opening a folder has to outlive the component. Hiding the note list
  // unmounts the whole panel, so state kept inside the tree would be lost every
  // time you glanced at a note.
  window.localStorage.removeItem('notes-manager-expanded-folders');
  appStore.setState({ expandedFolders: ['proj'], activeFolder: null });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const treeRoot = createRoot(host);
  await act(async () => {
    treeRoot.render(React.createElement(NotesPanel));
  });
  await flush();
  check('a folder the store says is open is open', host.innerHTML.includes('项目笔记'), true);

  const expander = host.querySelector('[aria-label="收起"]');
  check('and offers to close', Boolean(expander), true);
  await act(async () => {
    expander?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  // Asserted on the store rather than the DOM: the collapsing subtree is
  // wrapped in AnimatePresence, and jsdom has no animation frames to finish
  // the exit with, so the markup lingers a beat behind the state.
  check('clicking it closes the folder', appStore.getState().expandedFolders.includes('proj'), false);

  // Reopen, then take the panel away entirely, as hiding the list does.
  await act(async () => {
    expander?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  await act(async () => {
    treeRoot.unmount();
  });
  host.remove();

  const remounted = await renderOnce(React.createElement(NotesPanel));
  check('the tree remembers across a remount', remounted.includes('项目笔记'), true);
  check('and the choice is written down', window.localStorage.getItem('notes-manager-expanded-folders'), '["proj"]');
  appStore.setState({ expandedFolders: [] });

  // The tree is for navigating, so selecting a folder must not hide its siblings.
  const focused = await renderOnce(React.createElement(NotesPanel));
  check('selecting a folder in the tree keeps the rest of the tree', focused.includes('根目录笔记'), true);
  check('while still marking it', focused.includes('proj'), true);
  appStore.setState(hold);
}

/* --- the tree's own menus, and holding a row to pick it -------------------- */
console.log('\nthe tree\'s own menus (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [
      summaryNote('a', '根目录笔记', ''),
      summaryNote('b', '项目笔记', 'proj'),
      summaryNote('c', '子目录笔记', 'proj/deep'),
      summaryNote('d', '收藏笔记', 'proj', { favorite: true }),
      summaryNote('e', '置顶笔记', '', { pinned: true }),
      // The tree lists every file in the folder, not only the markdown ones.
      summaryNote('p', '风景.png', '', { kind: 'image', size: 2048, excerpt: '' }),
      summaryNote('z', '档案.zip', 'proj', { kind: 'file', size: 512, excerpt: '' }),
    ],
    folders: [
      { path: 'proj', name: 'proj', count: 3, depth: 0 },
      { path: 'proj/deep', name: 'deep', count: 1, depth: 1 },
    ],
    expandedFolders: ['proj'],
    activeFolder: null,
    activeId: null,
    query: '',
    selection: [],
    loadingNotes: false,
    notesError: null,
  } as never);

  // The batch verbs are the store's own calls, recorded rather than performed:
  // what a menu item does is which call it makes, and with what.
  const batchCalls: string[] = [];
  appStore.setState({
    downloadSelection: async () => {
      batchCalls.push('download');
    },
    deleteSelection: async () => {
      batchCalls.push('delete');
    },
    moveSelection: async (folder: string) => {
      batchCalls.push('move → ' + folder);
    },
  } as never);

  const panel = await mountPanel();
  const row = (key: string) => panel.host.querySelector('[data-tree-row="' + key + '"]');
  /** The lucide names on a row's own glyph, which is what says what it holds. */
  const iconNames = (key: string) =>
    (row(key)?.querySelector('svg')?.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((name) => name.startsWith('lucide-'));

  check('the panel renders a tree', Boolean(panel.host.querySelector('[data-note-tree]')), true);
  check('with a row for every folder', Boolean(row('folder:proj')) && Boolean(row('folder:proj/deep')), true);
  check('and one for every note on screen', Boolean(row('note:a')) && Boolean(row('note:b')), true);
  check('nothing is picked to start with', panel.host.querySelectorAll('[data-selected="true"]').length, 0);

  // A picture and any other file are rows too, and the glyph says which is which.
  check('a picture is a row of its own', iconNames('note:p'), ['lucide-image']);
  check('a note keeps the note glyph', iconNames('note:a'), ['lucide-file-text']);
  check('and any other file has its own', iconNames('note:z'), ['lucide-file']);
  // What a file's bytes say about it is how big it is, not when it changed.
  check('a picture carries its size', (row('note:p')?.textContent ?? '').includes('2.0 KB'), true);
  check('and a note carries when it changed', (row('note:a')?.textContent ?? '').includes('刚刚'), true);

  // A note's own verbs. Right-clicking used to open the browser's menu, which
  // offers to reload the page or save an image - neither means anything here.
  const noteEvent = await rightClick(row('note:a') as Element);
  check('right-clicking a note is the app\'s business', noteEvent.defaultPrevented, true);
  check(
    'and the menu names what was clicked',
    (document.querySelector('[data-context-menu]')?.textContent ?? '').includes('根目录笔记'),
    true,
  );
  // Opened over a note, the menu has to stay readable: it is drawn opaque rather
  // than as glass, which let the page underneath show through it.
  const menuClass = document.querySelector('[data-context-menu]')?.className ?? '';
  check('the menu is drawn opaque', menuClass.includes('bg-[var(--menu-bg)]'), true);
  check('against a border that holds it apart from the page', menuClass.includes('border-[var(--line-strong)]'), true);
  check('and is not glass any more', menuClass.includes('glass'), false);
  check('opening is on it', openMenuItems().includes('note-open'), true);
  check('renaming too', openMenuItems().includes('note-rename'), true);
  check('and moving it to another folder', openMenuItems().includes('note-move'), true);
  check('and pinning it', openMenuItems().includes('note-pin'), true);
  check('and favouriting it', openMenuItems().includes('note-favorite'), true);
  check(
    'and deleting it, saying where it goes',
    openMenuItems().includes('note-delete') && openMenuLabels().some((label) => label.includes('移入回收站')),
    true,
  );
  await closeMenu();
  check('Escape puts the menu away', Boolean(document.querySelector('[data-context-menu]')), false);
  check('leaving nothing behind', openMenuItems(), []);

  // A folder's verbs, and the one that is only offered where it makes sense.
  await rightClick(row('folder:proj') as Element);
  check('a folder can gain a subfolder', openMenuItems().includes('folder-new-child'), true);
  check('and, being at the top level, a sibling', openMenuItems().includes('folder-new-root'), true);
  check('it can be renamed', openMenuItems().includes('folder-rename'), true);
  check('moved', openMenuItems().includes('folder-move'), true);
  check(
    'or thrown away, saying it can be recovered',
    openMenuItems().includes('folder-delete') && openMenuLabels().some((label) => label.includes('可恢复')),
    true,
  );

  // A folder can also start a note inside itself, which is where the menu is the
  // shortest way to say "a new note goes here".
  check('a folder can start a note in itself', openMenuItems().includes('folder-new-note'), true);
  check('saying where the note will go', openMenuLabels().some((label) => label.includes('在此新建笔记')), true);
  await act(async () => {
    document.querySelector<HTMLElement>('[data-menu-item="folder-new-note"]')?.click();
  });
  await flush();
  check(
    'which opens the new-note dialog already pointed there',
    [
      document.querySelector('[data-testid="dialog-title"]')?.textContent,
      (document.querySelector('[data-testid="dialog-folder-input"]') as HTMLInputElement | null)?.value,
    ],
    ['新建笔记', 'proj'],
  );
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === '取消')?.click();
  });
  await flush();
  await closeMenu();

  // A read-only account is shown the same menu, with the verbs switched off rather
  // than hidden: the row is still where it is, and it is still worth saying so.
  await act(async () => {
    appStore.setState({
      capabilities: { ...WRITABLE, writable: false, permissions: { write: false, rename: false, move: false, remove: false } },
    } as never);
  });
  await flush();
  await rightClick(row('folder:proj') as Element);
  check(
    'a read-only account cannot start a note there',
    document.querySelector('[data-menu-item="folder-new-note"]')?.hasAttribute('disabled'),
    true,
  );
  await closeMenu();
  await act(async () => {
    appStore.setState({ capabilities: WRITABLE } as never);
  });
  await flush();

  await rightClick(row('folder:proj/deep') as Element);
  check(
    'a folder that is already nested is not offered a top-level sibling',
    openMenuItems().includes('folder-new-root'),
    false,
  );
  check('though it can still gain a child', openMenuItems().includes('folder-new-child'), true);
  await closeMenu();

  await rightClick(row('note:d') as Element);
  check(
    'a note that is already a favourite offers to stop being one',
    openMenuLabels().some((label) => label.includes('取消收藏')),
    true,
  );
  await closeMenu();

  // A picture shares the outer verbs - it lives in a folder and is renamed the
  // same way - but it is downloaded rather than pinned, and the server keeps no
  // such fields for it anyway.
  await rightClick(row('note:p') as Element);
  check('a picture can be downloaded', openMenuItems().includes('note-download'), true);
  check('renamed', openMenuItems().includes('note-rename'), true);
  check('and moved', openMenuItems().includes('note-move'), true);
  check('but not pinned', openMenuItems().includes('note-pin'), false);
  check('nor favourited', openMenuItems().includes('note-favorite'), false);
  await closeMenu();

  // The space around the rows belongs to the tree. Making a folder at the top
  // level is the one verb that needs no row to hang off, so it lives here.
  const blank = await rightClick(panel.host.querySelector('[data-note-tree]') as Element);
  check('a right-click on blank space is the tree\'s own', blank.defaultPrevented, true);
  check('offering a folder at the top level', openMenuItems().includes('tree-new-root-folder'), true);
  check('and nothing else', openMenuItems().length, 1);
  await closeMenu();

  // Holding a row still for 300ms opens the picking: the row is in it and says
  // so. It is the wait that decides - moving before then is the other gesture,
  // the drag.
  const pressed = row('note:a') as Element;
  // The bar that used to sit above the rows is gone: a picking is shown by the
  // rows themselves, and its verbs are on the menu.
  const toolbar = () => panel.host.querySelector('[data-selection-toolbar]');
  await act(async () => {
    pressed.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 12, clientY: 12 }));
  });
  check('a press on its own picks nothing', appStore.getState().selection.length, 0);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 520));
  });
  check('holding it still opens the picking', appStore.getState().selection, [{ kind: 'note', id: 'a' }]);
  check('which the row says it is held for', pressed.getAttribute('data-armed'), 'true');
  check('and the row is marked as picked', pressed.getAttribute('data-selected'), 'true');
  check('with no batch bar anywhere', Boolean(toolbar()), false);

  // Letting go keeps it.
  await act(async () => {
    pressed.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  });
  await flush();
  check('letting go keeps it picked', appStore.getState().selection, [{ kind: 'note', id: 'a' }]);
  check('which the row says', pressed.getAttribute('data-selected'), 'true');
  check('and the holding is over', pressed.getAttribute('data-armed'), null);
  // The browser still sends a click when the finger comes up. That click is not
  // the user asking to open anything, and it must not count as one.
  await act(async () => {
    pressed.querySelector('button')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('the click that ends the hold opens nothing', appStore.getState().activeId, null);
  check('and picks nothing else', appStore.getState().selection.length, 1);

  // A second row is picked by clicking it: while something is picked, a click
  // adds that row instead of opening it.
  await act(async () => {
    row('note:b')?.querySelector('button')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('clicking another row adds it', appStore.getState().selection, [
    { kind: 'note', id: 'a' },
    { kind: 'note', id: 'b' },
  ]);
  check('and that row says so', row('note:b')?.getAttribute('data-selected'), 'true');
  check('and the picking holds both', appStore.getState().selection.length, 2);
  check('without opening it', appStore.getState().activeId, null);

  // The click this press leaves behind is thrown away wherever it lands: the bar
  // has pushed the rows down, so it can end up on the container instead.
  await act(async () => {
    panel.host.querySelector('[data-note-tree]')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('and the click it leaves behind changes nothing', appStore.getState().selection.length, 2);
  check('with still no batch bar', Boolean(toolbar()), false);

  // A picked row carries the batch block as well as its own verbs, so a
  // right-click never hides what that row alone can do. Every entry says how
  // many rows are in hand, since nothing else on screen does.
  await rightClick(pressed);
  check('a picked row offers to download the lot', openMenuItems().includes('selection-download'), true);
  check('and the batch move', openMenuItems().includes('selection-move'), true);
  check('the batch delete', openMenuItems().includes('selection-delete'), true);
  check('and a way out of picking', openMenuItems().includes('selection-clear'), true);
  check('without hiding what that row alone can do', openMenuItems().includes('note-open'), true);
  check(
    'each naming how many are in hand',
    ['下载 2 项', '移动 2 项', '删除 2 项'].every((label) => openMenuLabels().some((text) => text.includes(label))),
    true,
  );
  // Downloading needs no question in front of it: the files are already named.
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="selection-download"]')?.click();
  });
  await flush();
  check('downloading the lot is the store call it means', batchCalls, ['download']);

  await rightClick(pressed);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="selection-delete"]')?.click();
  });
  await flush();
  check('deleting the lot is its own call', batchCalls, ['download', 'delete']);

  // Moving asks where first, and answering is the call.
  await rightClick(pressed);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="selection-move"]')?.click();
  });
  await flush();
  check('moving the lot asks where first', document.querySelector('[data-testid="dialog-title"]')?.textContent, '批量移动');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="dialog-confirm"]')?.click();
  });
  await flush();
  check('and answering is the move call', batchCalls, ['download', 'delete', 'move → ']);

  // 取消选择 is on the menu too.
  await rightClick(pressed);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="selection-clear"]')?.click();
  });
  await flush();
  check('clearing the picking empties it', appStore.getState().selection.length, 0);
  check('and the row stops saying it is picked', pressed.getAttribute('data-selected'), null);

  // Ctrl (or ⌘) is the shortcut that skips the hold: one click, no waiting, and
  // still no opening.
  const ctrlClick = async (key: string) => {
    const button = row(key)?.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    });
    await flush();
  };
  await ctrlClick('note:e');
  check('ctrl-clicking a row picks it', appStore.getState().selection, [{ kind: 'note', id: 'e' }]);
  check('without opening it', appStore.getState().activeId, null);
  check('and the row says so', row('note:e')?.getAttribute('data-selected'), 'true');
  check('and still no batch bar', Boolean(panel.host.querySelector('[data-selection-toolbar]')), false);
  await ctrlClick('note:e');
  check('ctrl-clicking it again puts it back', appStore.getState().selection, []);
  check('and nothing is left over when it goes', Boolean(panel.host.querySelector('[data-selection-toolbar]')), false);

  await panel.unmount();
  appStore.setState(hold);
}

/* --- holding a row, carrying it, and letting it go ------------------------- */
console.log('\nholding a row and moving it by hand (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [
      summaryNote('a', '根目录笔记', ''),
      summaryNote('b', '项目笔记', 'proj'),
      summaryNote('p', '风景.png', '', { kind: 'image', size: 2048, excerpt: '' }),
      summaryNote('z', '档案.zip', 'proj', { kind: 'file', size: 512, excerpt: '' }),
      // A picture inside a folder. Its id is the hash the server sends for a file
      // without front matter, not its path: the folder has to come from the
      // summary, or a drop on this row would think the file lives at the root.
      summaryNote('f0a1b2c3d4e5f607', '示意图.png', 'proj', { kind: 'image', size: 1024, excerpt: '' }),
    ],
    folders: [
      { path: 'proj', name: 'proj', count: 3, depth: 0 },
      { path: 'proj/deep', name: 'deep', count: 0, depth: 1 },
      { path: 'archive', name: 'archive', count: 0, depth: 0 },
    ],
    expandedFolders: ['proj'],
    activeFolder: null,
    activeId: null,
    query: '',
    selection: [],
    loadingNotes: false,
    notesError: null,
  } as never);

  // jsdom has no elementFromPoint of its own, so the drag is told what is under
  // the pointer; whatever this environment had is put back afterwards.
  const realElementFromPoint = typeof document.elementFromPoint === 'function' ? document.elementFromPoint : null;

  // Where a drop goes is a store call, and which call it is is the thing worth
  // asserting - so the three of them are recorded rather than performed.
  const moved: string[] = [];
  appStore.setState({
    moveNote: async (id: string, folder: string) => {
      moved.push('note ' + id + ' → ' + folder);
    },
    moveFolder: async (path: string, folder: string) => {
      moved.push('folder ' + path + ' → ' + folder);
    },
    moveSelection: async (folder: string) => {
      moved.push('selection → ' + folder);
    },
  } as never);

  const panel = await mountPanel();
  const row = (key: string) => panel.host.querySelector('[data-tree-row="' + key + '"]');
  const tree = panel.host.querySelector('[data-note-tree]') as Element;
  // The batch bar was removed: a picking is shown by its rows, and there is
  // nothing above them to find.
  const toolbar = () => panel.host.querySelector('[data-selection-toolbar]');
  // The offer is a badge at the top of the tree rather than part of the bar: it
  // has to be readable while a drag is in the air, which is before anything is
  // picked at all.
  const hint = () => panel.host.querySelector('[data-drop-hint]');
  const hintValue = () => hint()?.getAttribute('data-drop-hint') ?? null;

  const press = async (key: string, at = { x: 20, y: 20 }) => {
    await act(async () => {
      row(key)?.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: at.x, clientY: at.y }));
    });
  };
  const moveTo = async (x: number, y: number) => {
    await act(async () => {
      w.dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
    });
    await flush();
  };
  const release = async () => {
    await act(async () => {
      w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
    });
    await flush();
  };
  /** The click a browser sends as a press ends; the tree throws it away. */
  const closingClick = async () => {
    await act(async () => {
      tree.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };
  const forget = async () => {
    await act(async () => {
      appStore.getState().clearSelection();
    });
    await flush();
  };
  const holdFor = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };
  /** The card that follows the pointer while something is carried. */
  const ghost = () => document.querySelector('[data-drag-ghost]');

  // The empty space below the last row is the tree's too. jsdom has no layout to
  // measure it with, so the class that makes it reachable is what can be seen.
  check('the tree fills the space under its rows', tree.className.includes('min-h-full'), true);

  // A press let go almost where it started is a click, and a click is still a
  // click: nothing is picked, nothing is carried, and the note opens.
  moved.length = 0;
  await press('note:a');
  await moveTo(23, 22);
  await release();
  check('a press let go where it started picks nothing', appStore.getState().selection, []);
  check('and carries no card', Boolean(ghost()), false);
  check('and moves nothing', moved, []);
  await act(async () => {
    row('note:a')?.querySelector('button')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('so the click opens the note', appStore.getState().activeId, 'a');
  await act(async () => {
    appStore.setState({ activeId: null, activeNote: null, loadingNote: false });
  });

  // The same for a folder: a tap opens it.
  await press('folder:archive');
  await release();
  await act(async () => {
    row('folder:archive')?.querySelector('button')?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('and a tap on a folder opens it', appStore.getState().expandedFolders.includes('archive'), true);
  await act(async () => {
    appStore.setState({ expandedFolders: ['proj'] });
  });

  // Held still instead: that is the picking, and it opens on its own.
  moved.length = 0;
  await press('note:a');
  await holdFor(320);
  check('holding a row still opens the picking', appStore.getState().selection, [{ kind: 'note', id: 'a' }]);
  check('with the row saying it is held', row('note:a')?.getAttribute('data-armed'), 'true');
  check('and marked as picked', row('note:a')?.getAttribute('data-selected'), 'true');
  check('with no bar anywhere', Boolean(toolbar()), false);
  await release();
  check('letting go keeps it picked', appStore.getState().selection.length, 1);
  await closingClick();
  check('and the click it leaves behind does not clear it', appStore.getState().selection.length, 1);
  check('nor opens the note', appStore.getState().activeId, null);
  check('and nothing was moved', moved, []);
  await forget();

  // Moving while a row is held is the drag, and it starts at once: no waiting, no
  // picking, and a card under the pointer carrying what travels.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:proj');
  await press('note:a');
  await moveTo(20, 200);
  check('carrying the row raises a card', Boolean(ghost()), true);
  check('saying which row it carries', (ghost()?.textContent ?? '').includes('根目录笔记'), true);
  check('a folder under the pointer says it will take it', row('folder:proj')?.getAttribute('data-drop-target'), 'true');
  check('and the badge names it', hintValue(), 'proj');
  check('in words', (hint()?.textContent ?? '').includes('松开移动到 proj'), true);
  check('from the top of the tree rather than the bar', tree.contains(hint()), true);
  check('taking no height of its own', Boolean(hint()?.parentElement?.className.includes('h-0')), true);
  check('and no row is marked as picked', panel.host.querySelectorAll('[data-selected="true"]').length, 0);
  check('nor anything picked in the store', appStore.getState().selection, []);
  await release();
  check('letting go moves the note there', moved, ['note a → proj']);
  check('once', moved.length, 1);
  check('and the offer goes with the press', hintValue(), null);
  check('leaving nothing picked', appStore.getState().selection, []);
  check('and no bar behind', Boolean(toolbar()), false);
  await settled();
  check('and the card is gone', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // The same for a picture - the tree calls it a note row, and so does the move.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:archive');
  await press('note:p');
  await moveTo(60, 300);
  check('a picture can be carried too', hintValue(), 'archive');
  await release();
  check('and is moved through the note call', moved, ['note p → archive']);
  await settled();
  check('with the card gone', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // A note row is a destination by way of the folder it lives in: dropping on a
  // note means "put it here, beside this one". The row is not the container - the
  // folder it names is.
  moved.length = 0;
  document.elementFromPoint = () => row('note:b');
  await press('note:a');
  await moveTo(40, 20);
  check('a note row stands for the folder it lives in', hintValue(), 'proj');
  check('and the row itself claims no drop', row('note:b')?.getAttribute('data-drop-target'), null);
  check('in words, naming that folder', (hint()?.textContent ?? '').includes('松开移动到 proj'), true);
  check('though the card is up', Boolean(ghost()), true);
  check('and nothing is picked', appStore.getState().selection, []);
  await release();
  check('letting go moves it beside that note', moved, ['note a → proj']);
  check('and picks nothing either', appStore.getState().selection, []);
  check('with no bar', Boolean(toolbar()), false);
  await settled();
  check('and the card goes', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // A picture row is the same kind of destination: it lives in a folder, and that
  // folder is what takes the drop. Which folder it lives in comes from the
  // summary - a file's id is a hash, so there is no path to read it out of.
  moved.length = 0;
  document.elementFromPoint = () => row('note:f0a1b2c3d4e5f607');
  await press('note:a');
  await moveTo(60, 300);
  check('a picture row stands for its folder too', hintValue(), 'proj');
  check('and names the folder, not the file', (hint()?.textContent ?? '').trim(), '松开移动到 proj');
  check('with the file name nowhere in it', (hint()?.textContent ?? '').includes('示意图'), false);
  await release();
  check('and dropping on it takes the note there', moved, ['note a → proj']);
  await settled();
  check('with the card gone', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // A file that lives at the root is a drop on the root, which is the empty
  // folder - the badge spells it out in words rather than leaving it blank.
  moved.length = 0;
  document.elementFromPoint = () => row('note:p');
  await press('note:b');
  await moveTo(60, 300);
  check('a picture at the root is a drop on the root', hintValue(), 'root');
  check('which the badge says in words', (hint()?.textContent ?? '').trim(), '松开移动到 根目录');
  check('and still without the file name', (hint()?.textContent ?? '').includes('风景'), false);
  await release();
  check('so the note moves to the root beside it', moved, ['note b → ']);
  await settled();
  check('and the card goes', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // Nowhere to go: a row in the folder the note already lives in would move
  // nothing, so it is not offered as a destination at all.
  moved.length = 0;
  document.elementFromPoint = () => row('note:p');
  await press('note:a');
  await moveTo(40, 20);
  check('a row in the same folder is not a destination', hintValue(), null);
  check('and no row claims the drop', row('note:p')?.getAttribute('data-drop-target'), null);
  check('though the card is up', Boolean(ghost()), true);
  check('and nothing is picked', appStore.getState().selection, []);
  await release();
  check('so letting go moves nothing', moved, []);
  check('and picks nothing either', appStore.getState().selection, []);
  await settled();
  check('and the card goes', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // Nor is anywhere outside the tree.
  moved.length = 0;
  document.elementFromPoint = () => document.body;
  await press('note:a');
  await moveTo(400, 400);
  check('outside the tree is nowhere to drop', hintValue(), null);
  await release();
  check('and letting go there moves nothing', moved, []);
  await settled();
  await closingClick();
  await forget();

  // Cancelling a drag is not releasing it: a pointer that goes away moves
  // nothing and takes the card with it.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:proj');
  await press('note:a');
  await moveTo(20, 200);
  check('a card is up before the cancel', Boolean(ghost()), true);
  await act(async () => {
    w.dispatchEvent(new w.MouseEvent('pointercancel', { bubbles: true }));
  });
  await flush();
  check('cancelling moves nothing', moved, []);
  check('and picks nothing', appStore.getState().selection, []);
  await settled();
  check('and the card goes with it', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // Holding first and carrying on from there: the picking was already open, so
  // what travels is what it holds - and it is given up once the row has moved.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:archive');
  await press('note:a');
  await holdFor(320);
  check('the hold opened the picking', appStore.getState().selection.length, 1);
  await moveTo(60, 300);
  check('and carrying on from it drags the row', Boolean(ghost()), true);
  await release();
  check('which is moved', moved, ['note a → archive']);
  check('with the picking given up', appStore.getState().selection, []);
  check('and no bar anywhere', Boolean(toolbar()), false);
  await settled();
  await closingClick();
  await forget();

  // Several rows in hand: the drag has already answered which of them it is, so
  // the batch call is the one that moves them.
  moved.length = 0;
  await act(async () => {
    appStore.setState({
      selection: [
        { kind: 'note', id: 'a' },
        { kind: 'note', id: 'b' },
      ],
    });
  });
  document.elementFromPoint = () => row('folder:archive');
  await press('note:a');
  await moveTo(60, 300);
  check('a drag from a picking carries all of it', (ghost()?.textContent ?? '').includes('2 项'), true);
  check('and the badge names the folder for all of them', hintValue(), 'archive');
  await release();
  check('so the batch call is the one that runs', moved, ['selection → archive']);
  check('and the picking is given up with the move', appStore.getState().selection, []);
  check('and no bar is left over', Boolean(toolbar()), false);
  await settled();
  check('and so does the card', Boolean(ghost()), false);
  await closingClick();
  await forget();

  // A folder travels by its path, through the folder call - that is what keeps
  // its contents together.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:archive');
  await press('folder:proj');
  await moveTo(60, 300);
  check('a folder can be carried as well', hintValue(), 'archive');
  await release();
  check('and moves through the folder call', moved, ['folder proj → archive']);
  await closingClick();
  await forget();

  // A folder cannot be dropped on itself, inside itself, or where it already is:
  // those are not places, and the tree offers none of them.
  moved.length = 0;
  document.elementFromPoint = () => row('folder:proj');
  await press('folder:proj');
  await moveTo(60, 300);
  check('a folder cannot be dropped on itself', hintValue(), null);
  document.elementFromPoint = () => row('folder:proj/deep');
  await moveTo(70, 320);
  check('nor inside its own child', hintValue(), null);
  document.elementFromPoint = () => tree;
  await moveTo(80, 340);
  check('nor into the folder it already lives in', hintValue(), null);
  await release();
  check('and nothing moved', moved, []);
  await closingClick();
  await forget();

  // The empty space below the rows is the notes root: a row dropped there is
  // moved out of its folder rather than into another one.
  moved.length = 0;
  document.elementFromPoint = () => tree;
  await press('note:b');
  await moveTo(60, 400);
  check('below the last row is the root', hintValue(), 'root');
  check('which the badge spells out', (hint()?.textContent ?? '').includes('根目录'), true);
  await release();
  check('so it moves to the root', moved, ['note b → ']);
  check('and nothing is left picked', appStore.getState().selection, []);
  await settled();
  await closingClick();

  if (realElementFromPoint) document.elementFromPoint = realElementFromPoint;
  else delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  await panel.unmount();
  appStore.setState(hold);
}

/* --- the menu's surface is declared, not guessed --------------------------- */
console.log('\nthe menu background (styles.css)');
{
  // jsdom never applies the stylesheet, so what the menu is made of is read from
  // the two places that decide it: the class on the element, asserted above while
  // a menu was open, and the variable that class names.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  check('the light theme gives the menu a surface of its own', /--menu-bg:\s*#ffffff/i.test(css), true);
  check(
    'and the dark theme one deeper than the panel it drops over',
    /\.dark\s*\{[^}]*--menu-bg:\s*#070c19/i.test(css),
    true,
  );
  // Nothing see-through: text from the page behind it is unreadable through glass.
  check('neither of them is translucent', /--menu-bg:\s*(?:transparent|color-mix|rgba)/i.test(css), false);
}

/* --- the blog card is as tall as what it says ----------------------------- */
console.log('\nthe blog card summary (styles.css)');
{
  // jsdom never applies the sheet, so the rule itself is what is read - and only
  // that rule, so an `overflow: hidden` somewhere else in the file cannot stand
  // in for it.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = /\.blog-summary\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

  check('the card summary has a rule to read', rule.length > 0, true);
  check('with nothing clipped out of it', /overflow/.test(rule), false);
  check('and no height it has to fit into', /max-height/.test(rule), false);
}

/* --- the order the tree is drawn in --------------------------------------- */
console.log('\nsorting the panel (jsdom)');
{
  const hold = appStore.getState();
  // The saved priority order is per-browser state: put back whatever was there.
  const savedKeys = w.localStorage.getItem('notes-manager-sort-keys');
  const savedPrimary = w.localStorage.getItem('notes-manager-sort');
  // Distinct timestamps and lengths, so a test can tell which key decided.
  const notesFixture = [
    summaryNote('s1', 'Alpha', 'proj', { updated: '2026-01-02T00:00:00.000Z', created: '2026-01-02T00:00:00.000Z', wordCount: 30 }),
    summaryNote('s2', 'Beta', 'proj', { updated: '2026-01-01T00:00:00.000Z', created: '2026-01-03T00:00:00.000Z', wordCount: 10 }),
    summaryNote('s3', 'Gamma', '', { updated: '2026-01-03T00:00:00.000Z', created: '2026-01-01T00:00:00.000Z', wordCount: 20 }),
  ];
  appStore.setState({
    capabilities: WRITABLE,
    notes: notesFixture,
    folders: [{ path: 'proj', name: 'proj', count: 2, depth: 0 }],
    expandedFolders: ['proj'],
    activeFolder: null,
    activeId: null,
    query: '',
    selection: [],
    sort: 'title',
    sortKeys: ['title', 'updated', 'created', 'words'],
    sortOrder: 'asc',
    loadingNotes: false,
    notesError: null,
  } as never);

  const panel = await mountPanel();
  const order = () =>
    Array.from(panel.host.querySelectorAll('[data-tree-row]')).map((item) => item.getAttribute('data-tree-row'));
  const asc = () => panel.host.querySelector<HTMLElement>('[data-testid="sort-order-asc"]');
  const desc = () => panel.host.querySelector<HTMLElement>('[data-testid="sort-order-desc"]');
  const button = () => panel.host.querySelector<HTMLButtonElement>('[data-testid="sort-menu-button"]');
  const menu = () => panel.host.querySelector<HTMLElement>('[data-testid="sort-menu"]');
  const rows = () => Array.from(panel.host.querySelectorAll<HTMLElement>('[data-testid^="sort-menu-item-"]'));
  const row = (key: string) => panel.host.querySelector<HTMLElement>('[data-testid="sort-menu-item-' + key + '"]');
  const rowKeys = () => rows().map((item) => item.getAttribute('data-testid')?.replace('sort-menu-item-', ''));
  const clickOn = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    });
    await flush();
  };
  /** A pointer event the way the tree's gesture block dispatches them. */
  const pointer = async (element: Element | null | undefined, type: string, x: number, y: number) => {
    await act(async () => {
      element?.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    });
    await flush();
  };
  const wait = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };
  const openMenu = async () => {
    if (!menu()) await clickOn(button());
  };

  // The picker is one line: a button saying which key is in charge, and the
  // priority list opens over the panel instead of taking a block of it.
  check('the sort is one compact button', Boolean(button()), true);
  check('that says it opens a list', button()?.getAttribute('aria-haspopup'), 'listbox');
  check('and which key is in charge', button()?.getAttribute('aria-label'), '排序方式：标题');
  check('with nothing open yet', [button()?.getAttribute('aria-expanded'), Boolean(menu())], ['false', false]);
  check('and running upwards by default', asc()?.getAttribute('aria-pressed'), 'true');
  check('with the other direction unpressed', desc()?.getAttribute('aria-pressed'), 'false');
  // Folders first, then the notes inside them - the order the tree is for.
  check('the tree is in title order', order(), ['folder:proj', 'note:s1', 'note:s2', 'note:s3']);

  await openMenu();
  check('clicking the button opens the priority list', Boolean(menu()), true);
  check('as a listbox', menu()?.getAttribute('role'), 'listbox');
  check('with the button saying it is open', button()?.getAttribute('aria-expanded'), 'true');
  check('listing every key in priority order', rowKeys(), ['title', 'updated', 'created', 'words']);
  check('each row an option', rows().map((item) => item.getAttribute('role')), ['option', 'option', 'option', 'option']);
  check(
    'the head marked as the one in charge',
    rows().map((item) => item.getAttribute('aria-selected')),
    ['true', 'false', 'false', 'false'],
  );
  check('each row saying its place', row('words')?.getAttribute('aria-label'), '字数，优先级 4');
  check('and the list saying which way it runs', (menu()?.textContent ?? '').includes('从上到下优先级减弱'), true);

  // A click promotes: the key becomes the head, which is what decides the order.
  await clickOn(row('words'));
  check('clicking a key makes it the head', appStore.getState().sortKeys, ['words', 'title', 'updated', 'created']);
  check('the store sort follows the head', appStore.getState().sort, 'words');
  check('the button says so', button()?.getAttribute('aria-label'), '排序方式：字数');
  check('the click closes the list', Boolean(menu()), false);
  // By word count upwards: Beta (10) then Alpha (30) inside proj, Gamma at the
  // root - folders first, then the notes inside them.
  check('the tree is ordered by the new head', order(), ['folder:proj', 'note:s2', 'note:s1', 'note:s3']);
  check(
    'and both saved keys follow',
    [w.localStorage.getItem('notes-manager-sort-keys'), w.localStorage.getItem('notes-manager-sort')],
    [JSON.stringify(['words', 'title', 'updated', 'created']), 'words'],
  );

  // Holding a row for a moment picks it up; dragging it reorders the whole list.
  await openMenu();
  const startY = 100;
  await pointer(row('words'), 'pointerdown', 20, startY);
  await wait(320); // longer than the 300ms hold
  check('holding a row picks it up to drag', row('words')?.getAttribute('data-sort-dragging'), 'true');
  // jsdom has no row heights, so the drag reads the pointer's travel: two rows
  // down is two row-heights (28px each).
  await pointer(row('words'), 'pointermove', 20, startY + 56);
  check('the rows follow the pointer while dragging', rowKeys(), ['title', 'updated', 'words', 'created']);
  await pointer(row('words'), 'pointerup', 20, startY + 56);
  check('letting go reorders the priority', appStore.getState().sortKeys, ['title', 'updated', 'words', 'created']);
  check(
    'and the order is saved as it was dragged',
    w.localStorage.getItem('notes-manager-sort-keys'),
    JSON.stringify(['title', 'updated', 'words', 'created']),
  );
  check('with the head deciding the tree again', appStore.getState().sort, 'title');

  // The click a drag leaves behind is not a click: it must not promote the row.
  await clickOn(row('updated'));
  check('a drag does not turn into a promoting click', appStore.getState().sortKeys, ['title', 'updated', 'words', 'created']);
  check('and the list is still open', Boolean(menu()), true);

  // The keyboard moves a row as well, from wherever it is.
  await act(async () => {
    row('created')?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  });
  await flush();
  check('ArrowUp moves a key up', appStore.getState().sortKeys, ['title', 'updated', 'created', 'words']);
  await act(async () => {
    row('created')?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  });
  await flush();
  check('ArrowDown moves it back down', appStore.getState().sortKeys, ['title', 'updated', 'words', 'created']);

  // Escape puts it away, and so does a press anywhere else.
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await flush();
  check('Escape closes the priority list', Boolean(menu()), false);
  await openMenu();
  check('it opens again', Boolean(menu()), true);
  await act(async () => {
    document.body.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  });
  await flush();
  check('and a press outside it closes it', Boolean(menu()), false);

  // The direction is still one global switch, and it still turns the tree around.
  await act(async () => {
    desc()?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  check('choosing the other direction reaches the store', appStore.getState().sortOrder, 'desc');
  check('and turns the notes around', order(), ['folder:proj', 'note:s2', 'note:s1', 'note:s3']);
  check('showing which direction is on', desc()?.getAttribute('aria-pressed'), 'true');
  check('and which is not', asc()?.getAttribute('aria-pressed'), 'false');

  if (savedKeys === null) w.localStorage.removeItem('notes-manager-sort-keys');
  else w.localStorage.setItem('notes-manager-sort-keys', savedKeys);
  if (savedPrimary === null) w.localStorage.removeItem('notes-manager-sort');
  else w.localStorage.setItem('notes-manager-sort', savedPrimary);
  await panel.unmount();
  appStore.setState(hold);
}

/* --- the panel's own controls --------------------------------------------- */
console.log('\nthe panel\'s controls (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [summaryNote('a', '根目录笔记', ''), summaryNote('b', '项目笔记', 'proj')],
    folders: [
      { path: 'proj', name: 'proj', count: 1, depth: 0 },
      { path: 'proj/deep', name: 'deep', count: 0, depth: 1 },
    ],
    expandedFolders: [],
    activeFolder: null,
    activeId: null,
    query: '',
    lastFolder: '',
    selection: [],
    loadingNotes: false,
    notesError: null,
  } as never);

  // Where a confirmed dialog sends its answer, recorded rather than performed.
  // The order matters when a new note needs a folder made for it first.
  const calls: string[] = [];
  const created: string[] = [];
  const movedTo: string[] = [];
  /** Cleared to make the folder request fail, like a server that refuses it. */
  let folderCreated = true;
  appStore.setState({
    createFolder: async (path: string) => {
      calls.push('folder:' + path);
      return folderCreated;
    },
    createNote: async (input?: { title?: string; folder?: string }) => {
      const made = (input?.folder ?? '') + '|' + (input?.title ?? '');
      created.push(made);
      calls.push('note:' + made);
    },
    moveNote: async (id: string, folder: string) => {
      movedTo.push(id + '|' + folder);
    },
    moveFolder: async (path: string, target: string) => {
      movedTo.push(path + '|' + target);
    },
  } as never);

  // The app's shortcuts sit above the panel; the "/" that used to jump into the
  // search box lived there, so they are installed here too.
  const WithHotkeys = () => {
    useHotkeys();
    return React.createElement(NotesPanel);
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(WithHotkeys));
  });
  await flush();

  const search = host.querySelector<HTMLInputElement>('input[aria-label="搜索笔记"]');
  check('the search box is there', Boolean(search), true);
  check('with no keyboard hint promising a shortcut', host.querySelector('kbd'), null);
  (document.activeElement as HTMLElement | null)?.blur();
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  });
  check('pressing / does not focus the search box', document.activeElement === search, false);
  check('and leaves the focus where it was', document.activeElement?.tagName ?? 'none', 'BODY');

  const button = (label: string) =>
    Array.from(host.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  const cancel = () =>
    document.querySelector<HTMLButtonElement>('[data-testid="dialog-confirm"]')?.previousElementSibling as
      | HTMLButtonElement
      | null;

  // The scope control is one icon. A word on it would eat the width the search
  // box needs, so what state it is in is said in its name instead.
  const scope = () => host.querySelector<HTMLButtonElement>('button[aria-label^="搜索范围与筛选"]');
  check('the scope control says what it is', scope()?.getAttribute('aria-label'), '搜索范围与筛选');
  check('and says it with an icon rather than a word', scope()?.textContent?.trim() ?? null, '');
  await act(async () => {
    appStore.setState({ favoriteOnly: true } as never);
  });
  await flush();
  check('a filter in force is said in that name', scope()?.getAttribute('aria-label'), '搜索范围与筛选（已筛选）');
  check('still without a word on the button', scope()?.textContent?.trim() ?? null, '');
  await act(async () => {
    appStore.setState({ favoriteOnly: false } as never);
  });
  await flush();

  // Clicking a folder says where the user is working, which is where the next
  // note should go.
  await act(async () => {
    host
      .querySelector<HTMLElement>('[data-tree-row="folder:proj"]')
      ?.querySelector('button')
      ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
  check('clicking a folder remembers it', appStore.getState().lastFolder, 'proj');

  /* --- the folder field ---------------------------------------------------- */
  // The destination is typed by hand: a prefix is matched against the folders
  // that exist, and a new note may name a folder that does not - it is made with
  // the note. Every other prompt still only moves things into a folder that is
  // already there.
  const titleInput = () => document.querySelector<HTMLInputElement>('[data-testid="dialog-input"]');
  const folderField = () => document.querySelector<HTMLInputElement>('[data-testid="dialog-folder-input"]');
  const folderWrapper = () => document.querySelector('[data-testid="dialog-folder-select"]');
  const folderHint = () => document.querySelector('[data-testid="dialog-folder-hint"]')?.textContent ?? null;
  const confirm = () => document.querySelector<HTMLButtonElement>('[data-testid="dialog-confirm"]');
  const suggestionList = () => document.querySelector('[data-testid="folder-suggestions"]');
  const suggestions = () =>
    Array.from(document.querySelectorAll('[data-testid^="folder-suggestion-"]')).map((item) =>
      (item.getAttribute('data-testid') ?? '').replace('folder-suggestion-', ''),
    );
  const typeFolder = (value: string) => typeIntoInput('[data-testid="dialog-folder-input"]', value);
  const closeDialog = async () => {
    await act(async () => {
      cancel()?.click();
    });
    await flush();
  };

  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  check('making a note asks where it goes', document.querySelector('[data-testid="dialog-title"]')?.textContent, '新建笔记');
  check('with a title to give it', Boolean(titleInput()), true);
  check('and a destination field', folderField()?.getAttribute('aria-label'), '目标目录');
  check('which starts in the folder that was just clicked', folderField()?.value, 'proj');
  check('keeping the old test id on its wrapper', Boolean(folderWrapper()), true);
  check(
    'as a combobox with a list behind it',
    [folderField()?.getAttribute('role'), folderField()?.getAttribute('aria-autocomplete')],
    ['combobox', 'list'],
  );
  check('an existing folder needs no comment', folderHint(), null);
  check('and its own prefix is already suggested', suggestions().includes('proj'), true);
  check('and a way to confirm it', Boolean(confirm()), true);

  // A small dialog that appears out of nowhere asking for a name looks like a
  // login form to a password manager. The type is the fix that works: Bitwarden's
  // content script skips search inputs when it collects fields and its login
  // filler ignores them - its data-bwignore opt-out only applies when the user
  // turns that setting on, so attributes alone never fixed this. The browser's
  // search chrome (rounded ends, the clear button) is taken back off with
  // classes, so it still looks and behaves like a text field.
  const fieldFacts = (input: HTMLInputElement | null) => ({
    type: input?.getAttribute('type'),
    appearanceOff: (input?.className ?? '').includes('appearance-none'),
    autocomplete: input?.getAttribute('autocomplete'),
    autocorrect: input?.getAttribute('autocorrect'),
    autocapitalize: input?.getAttribute('autocapitalize'),
    spellcheck: input?.getAttribute('spellcheck'),
    bwignore: input?.getAttribute('data-bwignore'),
    onepassword: input?.getAttribute('data-1p-ignore'),
    lastpass: input?.getAttribute('data-lpignore'),
  });
  const passwordManagerProof = {
    type: 'search',
    appearanceOff: true,
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    bwignore: 'true',
    onepassword: 'true',
    lastpass: 'true',
  };
  check('the title field looks like a search box to a password manager', fieldFacts(titleInput()), passwordManagerProof);
  check('and so does the folder field', fieldFacts(folderField()), passwordManagerProof);
  check(
    'with names of their own, not ones a manager knows',
    [titleInput()?.getAttribute('name'), folderField()?.getAttribute('name')],
    ['dialog-field', 'dialog-folder'],
  );

  // Prefix matching: what is typed is compared with the start of every folder,
  // and the list is a glance rather than a second dialog.
  const popover = () => document.querySelector<HTMLElement>('[data-testid="folder-suggestions"]');
  const hintSlot = () => document.querySelector<HTMLElement>('[data-testid="dialog-folder-hint-slot"]');
  const folderKey = async (name: string) => {
    await act(async () => {
      folderField()?.dispatchEvent(new w.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    });
    await flush();
  };
  await typeFolder('pro');
  check('typing a prefix offers the matching folders', suggestions(), ['proj', 'proj/deep']);
  check(
    'in a listbox the field controls',
    [suggestionList()?.getAttribute('role'), folderField()?.getAttribute('aria-expanded'), folderField()?.getAttribute('aria-controls')],
    ['listbox', 'true', 'prompt-folder-suggestions'],
  );
  // The list is a layer on the page, not a child of the dialog: the dialog body
  // scrolls, and a popover inside it would be clipped at the scroll edge. Being
  // outside the dialog also means it cannot make the dialog taller.
  check('the suggestions are a popover on the page', popover()?.parentElement === document.body, true);
  check('marked as one', popover()?.getAttribute('data-folder-popover'), 'true');
  check('positioned absolutely', w.getComputedStyle(popover() as HTMLElement).position, 'absolute');
  check('outside the scrolling areas', popover()?.closest('.scroll-area') ?? null, null);
  check('and outside the field it belongs to', folderWrapper()?.contains(popover() as Node) ?? true, false);
  check(
    'with a height cap and its own scrolling',
    (popover()?.className ?? '').includes('max-h-[240px]') && (popover()?.className ?? '').includes('overflow-y-auto'),
    true,
  );
  // The hint line is reserved whether or not it has anything to say, so a hint
  // appearing as the user types cannot resize the dialog either.
  check('the hint line is always there', Boolean(hintSlot()), true);
  check('with a floor under it', (hintSlot()?.className ?? '').includes('min-h-4'), true);
  check('and a missing folder is still announced', folderHint(), '不存在，将新建该文件夹');
  await typeFolder('proj/de');
  check('a longer prefix narrows the list', suggestions(), ['proj/deep']);
  // A suggestion is a step on the way to confirm, not the answer: its mousedown
  // is swallowed to keep the keyboard in the field, and the click fills it in.
  await act(async () => {
    popover()
      ?.querySelector<HTMLElement>('[data-testid="folder-suggestion-proj/deep"]')
      ?.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    popover()
      ?.querySelector<HTMLElement>('[data-testid="folder-suggestion-proj/deep"]')
      ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  check('clicking a suggestion fills the field', folderField()?.value, 'proj/deep');
  check('and takes the list away', Boolean(popover()), false);
  check('with the dialog still open', document.querySelector('[data-testid="dialog-title"]')?.textContent, '新建笔记');
  check('an existing folder is accepted as it is', [folderHint(), confirm()?.disabled], [null, false]);

  // The keyboard walks the list: Down opens on the first row, Up from it wraps to
  // the last, and Enter takes the row without confirming the dialog.
  await typeFolder('pro');
  await folderKey('ArrowDown');
  check(
    'the first Down highlights the first match',
    popover()?.querySelector('[data-folder-highlighted="true"]')?.getAttribute('data-testid'),
    'folder-suggestion-proj',
  );
  check(
    'which says it is selected',
    popover()?.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('data-testid'),
    'folder-suggestion-proj',
  );
  check('and the field points at it', folderField()?.getAttribute('aria-activedescendant'), 'folder-suggestion-0');
  await folderKey('ArrowDown');
  check('a second Down moves down', folderField()?.getAttribute('aria-activedescendant'), 'folder-suggestion-1');
  await folderKey('ArrowUp');
  await folderKey('ArrowUp');
  check(
    'Up from the first wraps to the last',
    folderField()?.getAttribute('aria-activedescendant'),
    'folder-suggestion-1',
  );
  await folderKey('Enter');
  check('Enter fills the field with the highlighted folder', folderField()?.value, 'proj/deep');
  check('and closes the list', Boolean(popover()), false);
  check('without confirming the dialog', document.querySelector('[data-testid="dialog-title"]')?.textContent, '新建笔记');

  // Escape belongs to the list first: one press closes it, the next the dialog.
  await typeFolder('pro');
  check('the list is open before Escape', Boolean(popover()), true);
  await folderKey('Escape');
  check('Escape closes the list', Boolean(popover()), false);
  check('with the dialog still open', document.querySelector('[data-testid="dialog-title"]')?.textContent, '新建笔记');
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await flush();
  check('and a second Escape closes the dialog', Boolean(document.querySelector('[data-testid="dialog-title"]')), false);

  // The list lingers for a moment after the field loses focus, so a click on a
  // row can land - and then it goes.
  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  await typeFolder('pro');
  await act(async () => {
    folderField()?.focus();
  });
  await flush();
  check('the list is up while the field has the keyboard', Boolean(popover()), true);
  await act(async () => {
    folderField()?.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
  });
  check('a focusout does not take it away at once', Boolean(popover()), true);
  await settled(200);
  check('and it is gone a moment later', Boolean(popover()), false);

  // Nothing matches, nothing is offered.
  await typeFolder('zzz');
  check('a prefix with no match has no list', Boolean(popover()), false);
  check('nor anything to suggest', suggestions(), []);

  // The path is normalised before it is checked: stray slashes and spaces are not
  // a different folder, and a dot segment is refused rather than dropped.
  await typeFolder('  proj  ');
  check('spaces around a path are trimmed', [folderHint(), confirm()?.disabled], [null, false]);
  await typeFolder('proj//deep/');
  check('a doubled slash is one separator', [folderHint(), confirm()?.disabled], [null, false]);
  await typeFolder('proj/../etc');
  check('a path that climbs out is refused', folderHint(), '路径里不能有 . 或 ..');
  check('with the dialog held shut', confirm()?.disabled, true);
  await typeFolder('.');
  check('and a bare dot is refused too', folderHint(), '路径里不能有 . 或 ..');
  await closeDialog();

  // A hand-typed folder that does not exist yet is made first, and the note only
  // follows if that worked.
  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  await typeFolder('proj/new');
  check('a new folder is announced, not refused', folderHint(), '不存在，将新建该文件夹');
  check('and the dialog will make it', confirm()?.disabled, false);
  await typeIntoInput('[data-testid="dialog-input"]', '会议记录');
  calls.length = 0;
  created.length = 0;
  await act(async () => {
    confirm()?.click();
  });
  await flush();
  check('confirming makes the folder first, then the note in it', calls, [
    'folder:proj/new',
    'note:proj/new|会议记录',
  ]);
  check('and puts the dialog away', Boolean(document.querySelector('[data-testid="dialog-title"]')), false);

  // A folder that could not be made leaves no note behind: it would be homeless.
  folderCreated = false;
  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  await typeFolder('proj/refused');
  await typeIntoInput('[data-testid="dialog-input"]', '不该出现');
  calls.length = 0;
  created.length = 0;
  await act(async () => {
    confirm()?.click();
  });
  await flush();
  check('a folder that could not be made makes no note', calls, ['folder:proj/refused']);
  check('and the note was never asked for', created, []);
  folderCreated = true;

  // A remembered folder that no longer exists falls back to the root rather than
  // to a path that would have to be refused.
  await act(async () => {
    appStore.setState({ lastFolder: 'gone/folder' } as never);
  });
  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  check('a folder that is gone is not offered', folderField()?.value, '');
  await closeDialog();
  check('cancelling puts it away', Boolean(document.querySelector('[data-testid="dialog-title"]')), false);
  check('and sends nothing', created, []);

  // Moving a note only goes to a folder that is already there: unlike a new note,
  // nothing here can invent a destination.
  await rightClick(host.querySelector('[data-tree-row="note:b"]') as Element);
  await act(async () => {
    document.querySelector<HTMLElement>('[data-menu-item="note-move"]')?.click();
  });
  await flush();
  check('moving a note asks where to', document.querySelector('[data-testid="dialog-title"]')?.textContent, '移动笔记');
  check('starting where it already is', folderField()?.value, 'proj');
  await typeFolder('proj/nope');
  check('a folder that is not there is refused, not made', folderHint(), '没有这个文件夹');
  check('with the dialog held shut', confirm()?.disabled, true);
  await typeFolder('proj/deep');
  check('an existing one can be confirmed', [folderHint(), confirm()?.disabled], [null, false]);
  movedTo.length = 0;
  await act(async () => {
    confirm()?.click();
  });
  await flush();
  check('and the typed folder is the one it moves to', movedTo, ['b|proj/deep']);

  // A folder cannot be moved into itself or into its own subtree: those are left
  // out of the suggestions and refused if typed anyway.
  await rightClick(host.querySelector('[data-tree-row="folder:proj"]') as Element);
  await act(async () => {
    document.querySelector<HTMLElement>('[data-menu-item="folder-move"]')?.click();
  });
  await flush();
  check('moving a folder asks where to', document.querySelector('[data-testid="dialog-title"]')?.textContent, '移动文件夹');
  await typeFolder('pro');
  check('and suggests no place inside itself', [Boolean(suggestionList()), suggestions()], [false, []]);
  await typeFolder('proj');
  check('typing itself is refused', folderHint(), '不能移动到这个文件夹');
  await typeFolder('proj/deep');
  check('and so is its own subfolder', folderHint(), '不能移动到这个文件夹');
  check('with the dialog held shut', confirm()?.disabled, true);
  await typeFolder('');
  check('the root is always somewhere to go', [folderHint(), confirm()?.disabled], [null, false]);
  await act(async () => {
    confirm()?.click();
  });
  await flush();
  check('and that is the move it makes', movedTo, ['b|proj/deep', 'proj|']);

  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="上传文件"]')?.click();
  });
  await flush();
  check('uploading asks the same question', document.querySelector('[data-testid="dialog-title"]')?.textContent, '上传文件');
  check('with the same destination field', Boolean(folderField()), true);
  check('starting from the remembered folder, which is gone', folderField()?.value, '');
  check(
    'and no title field, since the files carry their own names',
    Boolean(document.querySelector('[data-testid="dialog-input"]')),
    false,
  );
  // Any file is accepted: a picture is as much a part of the folder as a note.
  check('and the picker does not narrow the choice', host.querySelector('input[type="file"]')?.hasAttribute('accept'), false);
  await closeDialog();

  await act(async () => {
    root.unmount();
  });
  host.remove();
  appStore.setState(hold);
}

/* --- the editor's own menu, and when it writes ---------------------------- */
console.log('\nthe editor\'s own menu (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [note],
    activeId: note.id,
    activeNote: note,
    lastSaved: null,
    dirty: false,
    editorMode: 'split',
    metaOpen: true,
    saving: false,
  } as never);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Editor));
  });
  await flush();

  // The markdown toolbar that used to sit above the note is gone: the verbs it
  // carried are on the right-click menu, which is not in the DOM until asked.
  check('no toolbar is left above the editor', host.querySelectorAll('[data-menu-item]').length, 0);
  check(
    'and none of its buttons either',
    ['加粗', '斜体', '删除线', '引用', '无序列表', '有序列表', '插入链接'].filter((label) =>
      host.innerHTML.includes('aria-label="' + label + '"'),
    ),
    [],
  );

  const content = host.querySelector('.cm-content');
  check('the note body is an editor in the DOM', Boolean(content), true);
  const menuEvent = await rightClick(content as Element);
  check('right-clicking the note replaces the browser menu', menuEvent.defaultPrevented, true);
  check('undoing is on it', openMenuItems().includes('undo'), true);
  check('so is copying', openMenuItems().includes('copy'), true);
  check('and selecting everything', openMenuItems().includes('select-all'), true);
  check(
    'and the formatting the toolbar used to carry',
    openMenuItems().includes('bold') && openMenuItems().includes('link'),
    true,
  );
  check('named in words a reader knows', openMenuLabels().some((label) => label.includes('加粗')), true);

  // Copying is the item that has to survive a browser with no clipboard API.
  const errors: unknown[] = [];
  const onError = (event: Event) => errors.push((event as ErrorEvent).message ?? 'error');
  w.addEventListener('error', onError);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="copy"]')?.click();
  });
  await settled();
  check('copying closes the menu', Boolean(document.querySelector('[data-context-menu]')), false);

  // Selecting everything runs against the live editor, which its own DOM knows
  // how to find.
  const view = EditorView.findFromDOM(host.querySelector('.cm-editor') as HTMLElement);
  check('the editor view can be found from its DOM', Boolean(view), true);
  await rightClick(content as Element);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="select-all"]')?.click();
  });
  await flush();
  w.removeEventListener('error', onError);
  check('selecting everything selects the whole note', view?.state.selection.main.to === view?.state.doc.length, true);
  check('and nothing threw on the way', errors, []);

  // Typing a title is a local edit. The field losing focus is the only writer,
  // which is what stops a reply landing on top of the words being typed.
  const realFetch = globalThis.fetch;
  const writes: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'PUT') throw new Error('no server here');
    writes.push(String(init.body ?? ''));
    const patch = JSON.parse(String(init.body ?? '{}')) as { title?: string };
    const title = patch.title ?? note.title;
    // A title is the file's name, so the server answers with the new path.
    return new Response(
      JSON.stringify({ note: { ...note, title, path: '/' + title + '.md', updated: new Date().toISOString() } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const title = host.querySelector<HTMLInputElement>('input[aria-label="笔记标题"]');
    check('the title is a field of its own', title?.value, note.title);
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(title, '更名后的标题');
      title?.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    await flush();
    check('typing reaches the note', appStore.getState().activeNote?.title, '更名后的标题');
    check('and marks it unsaved', appStore.getState().dirty, true);
    check('but writes nothing yet', writes.length, 0);

    await act(async () => {
      title?.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true }));
    });
    await flush();
    check('leaving the field saves once', writes.length, 1);
    check('with the title that was typed', writes[0]?.includes('更名后的标题'), true);
    check('and the note is clean again', appStore.getState().dirty, false);
    check(
      'the address follows the renamed file',
      decodeURIComponent(w.location.pathname),
      '/manager/public/Notes/更名后的标题.md',
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  await act(async () => {
    root.unmount();
  });
  host.remove();
  appStore.setState(hold);
}

/* --- what the editor does with the other kinds ---------------------------- */
console.log('\nthe editor and files that are not notes (jsdom)');
{
  const hold = appStore.getState();

  /** Opens one file as the editor's subject and keeps the pane mounted. */
  const openFile = async (file: Record<string, unknown>) => {
    appStore.setState({
      capabilities: WRITABLE,
      notes: [file],
      activeId: file.id,
      activeNote: file,
      lastSaved: null,
      dirty: false,
      editorMode: 'split',
      metaOpen: true,
      saving: false,
    } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Editor));
    });
    await flush();
    return {
      host,
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  };

  // A picture is looked at: no text editor, no three-state switch, no metadata
  // bar and no outline - a control that cannot do anything is worse than none.
  const pictureView = await openFile({
    ...note,
    id: 'pic1',
    kind: 'image',
    title: '风景.png',
    path: '/风景.png',
    content: '',
    size: 2048,
  });
  check('a picture is not opened as text', pictureView.host.querySelector('.cm-content'), null);
  check(
    'and has no three-state switch',
    pictureView.host.querySelectorAll('[aria-label="编辑"], [aria-label="分栏"], [aria-label="预览"]').length,
    0,
  );
  check('nor the metadata bar', pictureView.host.innerHTML.includes('添加标签'), false);
  check('nor an outline', pictureView.host.querySelector('.outline-panel'), null);
  check('and nothing to keep level', Boolean(pictureView.host.querySelector('[data-sync-scroll]')), false);
  const shown = pictureView.host.querySelector('img');
  check(
    'what is shown is the picture itself',
    shown?.getAttribute('src'),
    '/api/notes/file?path=' + encodeURIComponent('/风景.png'),
  );
  check('named as the file is', shown?.getAttribute('alt'), '风景.png');
  // The outer verbs are the same for every kind: it is still a file with a name.
  check('though it can still be renamed', Boolean(pictureView.host.querySelector('input[aria-label="笔记标题"]')), true);
  check('and downloaded', Boolean(pictureView.host.querySelector('button[aria-label="下载文件"]')), true);
  await pictureView.unmount();

  // Anything else is only ever downloaded.
  const fileView = await openFile({
    ...note,
    id: 'zip1',
    kind: 'file',
    title: '档案.zip',
    path: '/档案.zip',
    content: '',
    size: 4096,
  });
  check('another format is not opened as text either', fileView.host.querySelector('.cm-content'), null);
  check('and says so', fileView.host.innerHTML.includes('暂不支持预览这种格式'), true);
  check(
    'offering the file itself instead',
    Array.from(fileView.host.querySelectorAll('button')).some((button) => button.textContent?.trim() === '下载文件'),
    true,
  );
  check(
    'with no modes',
    fileView.host.querySelectorAll('[aria-label="编辑"], [aria-label="分栏"], [aria-label="预览"]').length,
    0,
  );
  await fileView.unmount();

  appStore.setState(hold);
}

/* --- a heading written as a link, in the outline --------------------------- */
console.log('\na linked heading in the outline (jsdom)');
{
  const { extractHeadings, normaliseHeading } = await import('./src/lib/outline');
  const { renderMarkdown } = await import('./src/lib/markdown');

  // Reported from a note taken off a problem set: the outline listed the whole
  // `[003. …](https://…)` source instead of the section's name.
  const source =
    '# [003. 无重复字符的最长子串](https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/)\n\n正文\n';
  const rendered = document.createElement('div');
  rendered.innerHTML = renderMarkdown(source);
  const heading = rendered.querySelector('h1');
  const outlined = extractHeadings(source)[0];
  check('the outline shows the label of a linked heading', outlined.text, '003. 无重复字符的最长子串');
  check('and the page shows the same words', heading?.textContent, outlined.text);
  // The preview scrolls by matching those two texts, so an outline entry only
  // lands while they agree (`Preview.reveal` -> `normaliseHeading`).
  check(
    'which is what the preview matches on when that entry is clicked',
    normaliseHeading(heading?.textContent ?? ''),
    normaliseHeading(outlined.text),
  );
  check(
    'and the heading is still a link on the page',
    rendered.querySelector('a')?.getAttribute('href'),
    'https://leetcode.cn/problems/longest-substring-without-repeating-characters/description/',
  );
}

/* --- keeping two panes level, the arithmetic ------------------------------- */
console.log('\nkeeping two panes level (pure)');
{
  const { sourcePositionAt, topForSourcePosition } = await import('./src/lib/scroll-sync');
  const {
    annotateSourceLines,
    renderMarkdown,
    sourceBlocks,
    SOURCE_LINE_ATTR,
    SOURCE_LINE_END_ATTR,
  } = await import('./src/lib/markdown');

  // A note with everything that can shift a line: a heading, blank lines, a link
  // definition (which renders nothing at all), a list and a fenced block.
  const source = [
    '# 标题',
    '',
    '正文第一段。',
    '',
    '[link]: https://example.com',
    '',
    '- 项目一',
    '- 项目二',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '尾段。',
    '',
  ].join('\n');

  // Blank lines and link definitions are counted even though they render
  // nothing: leave them out and the whole document slips a line at every gap.
  check('each block knows the lines it came from', sourceBlocks(source), [
    { line: 1, endLine: 2 },
    { line: 3, endLine: 4 },
    { line: 7, endLine: 9 },
    { line: 10, endLine: 13 },
    { line: 14, endLine: 15 },
  ]);
  check('an empty note has no blocks', sourceBlocks(''), []);
  check('nor have blank lines on their own', sourceBlocks('\n\n\n'), []);
  check('a link definition is not a block', sourceBlocks('[a]: https://x\n'), []);
  check('a single line is a block of its own', sourceBlocks('就一行'), [{ line: 1, endLine: 2 }]);

  // The rendered document carries the same numbers, one per top-level element.
  const rendered = document.createElement('div');
  rendered.innerHTML = renderMarkdown(source);
  annotateSourceLines(rendered, source);
  const children = Array.from(rendered.children) as HTMLElement[];
  check('the rendered blocks are one for one', children.map((child) => child.tagName), ['H1', 'P', 'UL', 'PRE', 'P']);
  check(
    'and each is marked with the line it came from',
    children.map((child) => child.getAttribute(SOURCE_LINE_ATTR)),
    ['1', '3', '7', '10', '14'],
  );
  check(
    'and with the line after its last one',
    children.map((child) => child.getAttribute(SOURCE_LINE_END_ATTR)),
    ['2', '4', '9', '13', '15'],
  );

  // Two blocks with a gap between them: a note is a different height in each
  // pane, so what the two panes can share is the source line, not a percentage.
  const anchors = [
    { line: 1, endLine: 3, top: 0, height: 100 },
    { line: 6, endLine: 8, top: 200, height: 60 },
  ];

  check('the top of the document is the first line', topForSourcePosition(anchors, { line: 1, fraction: 0 }), 0);
  check('a line inside a block is a place inside it', topForSourcePosition(anchors, { line: 2, fraction: 0 }), 50);
  check(
    'part way into a line is that far into its slice of the block',
    topForSourcePosition(anchors, { line: 2, fraction: 0.5 }),
    75,
  );
  check('the line after a block ends it', topForSourcePosition(anchors, { line: 3, fraction: 0 }), 100);
  check(
    'the blank lines between two blocks are travelled between them',
    topForSourcePosition(anchors, { line: 4, fraction: 0.5 }),
    150,
  );
  check('and the next block starts where it starts', topForSourcePosition(anchors, { line: 6, fraction: 0 }), 200);
  check('the last block ends the document', topForSourcePosition(anchors, { line: 8, fraction: 0 }), 260);
  check('a line past the end is the end', topForSourcePosition(anchors, { line: 99, fraction: 0 }), 260);
  check('and a line before the start is the start', topForSourcePosition(anchors, { line: -5, fraction: 0 }), 0);
  check('with no blocks there is nowhere to go', topForSourcePosition([], { line: 1, fraction: 0 }), null);

  check('the reader at the top is at the first line', sourcePositionAt(anchors, 0), { line: 1, fraction: 0 });
  check('half way down a block is half way through its lines', sourcePositionAt(anchors, 50), { line: 2, fraction: 0 });
  check('the bottom of a block is the line after it', sourcePositionAt(anchors, 100), { line: 3, fraction: 0 });
  check('a place in the gap belongs to the block above', sourcePositionAt(anchors, 150), { line: 3, fraction: 0 });
  check('the last block ends at its own end', sourcePositionAt(anchors, 260), { line: 8, fraction: 0 });
  check('and past the end is still the end', sourcePositionAt(anchors, 9999), { line: 8, fraction: 0 });
  check('with no blocks there is no position', sourcePositionAt([], 0), null);
  check(
    'anchors that arrive out of order are put in order',
    sourcePositionAt([...anchors].reverse(), 50),
    { line: 2, fraction: 0 },
  );

  // The two have to invert each other: if they did not, touching either pane
  // would move the other one somewhere else.
  const roundTrip = (line: number, fraction: number) => {
    const top = topForSourcePosition(anchors, { line, fraction });
    const back = top === null ? null : sourcePositionAt(anchors, top);
    return back ? back.line + back.fraction : null;
  };
  check('a place inside a block comes back where it started', Math.abs((roundTrip(1, 0.5) ?? 0) - 1.5) < 0.05, true);
  check('and so does one further down', Math.abs((roundTrip(7, 0.25) ?? 0) - 7.25) < 0.05, true);
  check('the very end comes back as the end', roundTrip(8, 0), 8);
}

/* --- keeping two panes level, in the split view ---------------------------- */
console.log('\nkeeping two panes level (jsdom)');
{
  const { topForSourcePosition } = await import('./src/lib/scroll-sync');
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => reply({})) as typeof fetch;
  appStore.setState({
    capabilities: WRITABLE,
    notes: [note],
    activeId: note.id,
    activeNote: note,
    lastSaved: null,
    dirty: false,
    editorMode: 'split',
    metaOpen: true,
    saving: false,
    syncScroll: false,
  } as never);
  w.localStorage.removeItem('notes-manager-sync-scroll');

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Editor));
  });
  await flush();

  const button = () => host.querySelector<HTMLButtonElement>('[data-sync-scroll]');
  check('the split view offers one switch for both panes', Boolean(button()), true);
  check('off until it is asked for', button()?.getAttribute('aria-pressed'), 'false');
  check('and named for what it does', button()?.getAttribute('aria-label'), '同步滚动');

  await act(async () => {
    button()?.click();
  });
  await flush();
  check('clicking it turns the sync on', appStore.getState().syncScroll, true);
  check('which the button says', button()?.getAttribute('aria-pressed'), 'true');
  check('and offers the way back', button()?.getAttribute('aria-label'), '取消同步滚动');
  check('with the choice written down', w.localStorage.getItem('notes-manager-sync-scroll'), 'on');

  // jsdom has no layout, so the document is placed by hand: the preview's blocks
  // are given the geometry they would have, and every value written to a pane's
  // scrollTop is recorded - that is what "the other pane moved" means.
  const trackScrollTop = (element: HTMLElement) => {
    const writes: number[] = [];
    let value = element.scrollTop;
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        writes.push(next);
        value = next;
      },
    });
    return writes;
  };

  const editorEl = host.querySelector<HTMLElement>('.cm-scroller') as HTMLElement;
  const previewEl = host.querySelector<HTMLElement>('.markdown-body') as HTMLElement;
  check('both panes are on screen to be kept level', Boolean(editorEl && previewEl), true);
  const editorWrites = trackScrollTop(editorEl);
  const previewWrites = trackScrollTop(previewEl);

  // The preview marks every rendered block with the source lines it came from,
  // and takes its geometry from the DOM. jsdom gives none, so each block is
  // placed down a document of its own: the first at 40, then every 200.
  const blocks = Array.from(previewEl.querySelectorAll<HTMLElement>('[data-line]'));
  check('the preview marks its blocks with source lines', blocks.length > 1, true);
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
  previewEl.getBoundingClientRect = () => rect(0, 0);
  const placed = blocks.map((block, index) => ({
    line: Number(block.getAttribute('data-line')),
    endLine: Number(block.getAttribute('data-line-end')),
    top: 40 + index * 200,
    height: 100,
  }));
  blocks.forEach((block, index) => {
    const spot = placed[index];
    // The rect is where the block sits in the document; what the pane has
    // scrolled is added back on the way in, so the anchor stays put.
    block.getBoundingClientRect = () => rect(spot.top - previewEl.scrollTop, spot.height);
  });
  const lastBlock = placed[placed.length - 1];
  const clearWrites = () => {
    editorWrites.length = 0;
    previewWrites.length = 0;
  };
  /** Where a pane is, then the event a browser would send for that move. */
  const scrollPane = async (pane: HTMLElement, top: number) => {
    pane.scrollTop = top;
    clearWrites();
    await act(async () => {
      pane.dispatchEvent(new w.Event('scroll'));
    });
    await flush();
  };

  // The editor at its top is the first source line, so the preview goes to where
  // that line is rendered - the first block's own place in the document. A
  // percentage would have put it at 0% of a range that has nothing to do with
  // this document's blocks, which is exactly the drift the change removes.
  await scrollPane(editorEl, 0);
  check('the editor at the top puts the preview on the first block', previewWrites, [placed[0].top]);

  // And back: where the preview is, read as a source line, is where the editor
  // is put. Two different places in the preview are two different places in the
  // editor, which is what says the line travelled rather than a number.
  await scrollPane(previewEl, placed[1].top);
  check('scrolling the preview moves the editor to that line', editorWrites.length, 1);
  const firstStop = editorWrites[0];
  await scrollPane(previewEl, placed[2].top);
  check('and a different place in the preview is a different place in the editor', editorWrites[0] !== firstStop, true);

  // The end of the note is the bottom of the last block, whatever room the
  // editor keeps below its last line to type in - that room is not something to
  // read, and counting it is what left the preview a screen short of the end.
  check(
    'the end of the note is the bottom of the last block',
    topForSourcePosition(placed, { line: lastBlock.endLine, fraction: 0 }),
    lastBlock.top + lastBlock.height,
  );

  // The pane that was just put somewhere reports its own move. That report is not
  // an instruction: answering it is what makes two panes fight. Both events go in
  // in the same frame, because a frame later the report is a scroll of its own.
  // Where the test puts the pane is its own bookkeeping, not the app's: it is
  // cleared away after the move and before the events.
  editorEl.scrollTop = 0;
  clearWrites();
  await act(async () => {
    editorEl.dispatchEvent(new w.Event('scroll'));
    previewEl.dispatchEvent(new w.Event('scroll'));
  });
  check('the editor moved the preview', previewWrites.length, 1);
  check('and the preview repeating that move in the same frame moves nothing back', editorWrites, []);
  // A frame later it is a scroll of its own again.
  await flush();
  await scrollPane(previewEl, placed[2].top);
  check('after that frame the preview moves the editor again', editorWrites.length, 1);

  // A jump the preview makes on its own - an outline entry, an anchor - is not
  // followed either: mirroring those positions drags the editor along with the
  // animation and the two panes end up jittering against each other. The outline
  // starts folded, so its branch has to be opened first.
  await act(async () => {
    host
      .querySelector('[data-testid="outline-toggle-all"]')
      ?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  const outlineEntry = Array.from(host.querySelectorAll<HTMLButtonElement>('.outline-panel button')).find((item) =>
    (item.textContent ?? '').includes('1.2'),
  );
  check('there is an outline entry to jump with', Boolean(outlineEntry), true);
  clearWrites();
  await act(async () => {
    outlineEntry?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  await act(async () => {
    previewEl.dispatchEvent(new w.Event('scroll'));
  });
  await flush();
  check('a jump to a heading does not move the editor', editorWrites, []);
  // The jump reports nothing in jsdom, so its own guard lapses on the fallback
  // timer; after that the next real scroll moves the editor again.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 340));
  });
  editorEl.scrollTop = 600;
  await scrollPane(previewEl, placed[2].top);
  check('and once it has landed, scrolling moves the editor again', editorWrites.length, 1);

  // Off: the listeners go with it.
  await act(async () => {
    button()?.click();
  });
  await flush();
  check('turning it off is written down too', w.localStorage.getItem('notes-manager-sync-scroll'), 'off');
  await scrollPane(previewEl, 800);
  check('and then no scroll moves the other pane', [editorWrites.length, previewWrites.length], [0, 0]);

  // Only the split view has two panes to keep level.
  await act(async () => {
    appStore.getState().setEditorMode('edit');
  });
  await flush();
  check('a single pane has no switch', Boolean(button()), false);
  await act(async () => {
    appStore.getState().setEditorMode('preview');
  });
  await flush();
  check('nor has the preview on its own', Boolean(button()), false);

  await act(async () => {
    root.unmount();
  });
  host.remove();
  w.localStorage.removeItem('notes-manager-sync-scroll');
  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- the preview does not bounce back from the end ------------------------- */
console.log('\nthe end of the note does not bounce (jsdom)');
{
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => reply({})) as typeof fetch;
  appStore.setState({
    capabilities: WRITABLE,
    notes: [note],
    activeId: note.id,
    activeNote: note,
    lastSaved: null,
    dirty: false,
    editorMode: 'split',
    metaOpen: false,
    saving: false,
    // The switch is part of this fix: without sync there is no mirror at all.
    syncScroll: true,
  } as never);
  w.localStorage.removeItem('notes-manager-sync-scroll');

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Editor));
  });
  await flush();

  // jsdom has no layout: each pane is told how tall it is, and every write to
  // scrollTop obeys the browser's rule that a pane cannot scroll past its own
  // end. That clamp is the whole bug - at the end of a note the editor runs out
  // of room before the preview does.
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  /** Every write to scrollTop: what was asked for, and where the pane ended up. */
  const track = (element: HTMLElement, max: number) => {
    const asked: number[] = [];
    const landed: number[] = [];
    let value = clamp(element.scrollTop, max);
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        asked.push(next);
        value = clamp(next, max);
        landed.push(value);
      },
    });
    return { asked, landed };
  };
  const size = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
  };

  const editorEl = host.querySelector<HTMLElement>('.cm-scroller') as HTMLElement;
  const previewEl = host.querySelector<HTMLElement>('.markdown-body') as HTMLElement;
  check('both panes are there', Boolean(editorEl && previewEl), true);
  // The editor runs out of room almost at once, the preview has plenty: that is
  // the shape of the bug - the last line of the note cannot be put at the top of
  // the editor, so the position it reports is an earlier one.
  size(editorEl, 300, 200);
  size(previewEl, 1800, 200);
  const editorLog = track(editorEl, 100);
  const previewLog = track(previewEl, 1600);
  const editorWrites = editorLog.landed;
  const previewWrites = previewLog.landed;

  // The rendered blocks are given a document of their own, as in the sync block.
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
  previewEl.getBoundingClientRect = () => rect(0, 0);
  Array.from(previewEl.querySelectorAll<HTMLElement>('[data-line]')).forEach((block, index) => {
    block.getBoundingClientRect = () => rect(40 + index * 200 - previewEl.scrollTop, 100);
  });

  const clearWrites = () => {
    editorWrites.length = 0;
    previewWrites.length = 0;
  };
  const dispatchScroll = async (pane: HTMLElement) => {
    await act(async () => {
      pane.dispatchEvent(new w.Event('scroll'));
    });
    await flush();
  };

  // The reader scrolls the preview to its very end. The editor is put at the line
  // of the last block - as far as it can go, which is short of what was asked.
  previewEl.scrollTop = previewEl.scrollHeight - previewEl.clientHeight;
  check('the preview can reach its own end', previewEl.scrollTop, 1600);
  clearWrites();
  await dispatchScroll(previewEl);
  check('the editor is moved to the line that was asked for', editorWrites.length, 1);
  check('asking for more room than the editor has', editorLog.asked[0] > editorLog.landed[0], true);
  check('so it lands at its own end', editorEl.scrollTop, 100);

  // Its report of that write arrives a moment later, describing the clamped
  // place. It is the echo of our own write, not the reader moving the pane: the
  // old handling had already let the frame go by then, so it dragged the preview
  // back up from the end - a bounce the reader could never get past.
  editorEl.scrollTop = 600;
  clearWrites();
  await dispatchScroll(editorEl);
  check('the report of the clamped write moves nothing back', previewWrites, []);
  check('so the preview stays at the end', previewEl.scrollTop, 1600);
  check('and the editor stays where it was clamped', editorEl.scrollTop, 100);

  // A real move in the editor is still followed: the guard is about echoes, not
  // about the reader.
  await flush();
  editorEl.scrollTop = 40;
  clearWrites();
  await dispatchScroll(editorEl);
  check('the reader moving the editor still moves the preview', previewWrites.length, 1);
  check('and the preview does not jump past its end', previewEl.scrollTop < 1600, true);

  await act(async () => {
    root.unmount();
  });
  host.remove();
  w.localStorage.removeItem('notes-manager-sync-scroll');
  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- the preview waits for typing to settle -------------------------------- */
console.log('\nthe preview keeps up without holding typing back (jsdom)');
{
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => reply({})) as typeof fetch;
  const noteWith = (id: string, marker: string) => {
    const body = '# 延迟测试\n\n' + marker + ' 这一段。\n';
    return { ...note, id, content: body, size: body.length };
  };
  const opened = noteWith('lag1', 'OLD_MARKER');
  appStore.setState({
    capabilities: WRITABLE,
    notes: [opened],
    activeId: opened.id,
    activeNote: opened,
    lastSaved: null,
    dirty: false,
    editorMode: 'split',
    metaOpen: false,
    saving: false,
  } as never);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Editor));
  });
  await flush();

  const previewText = () => host.querySelector('.markdown-body')?.textContent ?? '';
  const editorText = () => host.querySelector('.cm-content')?.textContent ?? '';
  check('the preview opens on the note it was given', previewText().includes('OLD_MARKER'), true);

  // The editor echoes at once - it renders from the store. The preview is the
  // expensive one (parse, sanitise, annotate, resolve pictures, swap the DOM),
  // so it is given the note the typing settled on a beat later.
  await act(async () => {
    appStore.getState().patchActive({ content: noteWith('lag1', 'NEW_MARKER').content });
  });
  await flush();
  check('the editor echoes the typing at once', editorText().includes('NEW_MARKER'), true);
  check('while the preview still shows the last thing it rendered', previewText().includes('NEW_MARKER'), false);
  check('and shows the old content instead', previewText().includes('OLD_MARKER'), true);
  await settled(200);
  check('a beat later the preview has caught up', previewText().includes('NEW_MARKER'), true);

  // Another note is not a lagging edit: showing the old one would be a lie.
  const other = noteWith('lag2', 'SWITCH_MARKER');
  await act(async () => {
    appStore.setState({ notes: [opened, other], activeId: other.id, activeNote: other } as never);
  });
  check('another note is shown at once, not a beat later', previewText().includes('SWITCH_MARKER'), true);

  await act(async () => {
    root.unmount();
  });
  host.remove();
  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- formulas (KaTeX) ----------------------------------------------------- */
console.log('\nformulas (jsdom)');
{
  const { renderMarkdown, sourceBlocks, annotateSourceLines } = await import('./src/lib/markdown');

  const render = (source: string) => {
    const container = document.createElement('div');
    container.innerHTML = renderMarkdown(source);
    return container;
  };
  const text = (container: HTMLElement) => (container.textContent ?? '').trim();

  // The five delimiters people write a formula with. Each one has to typeset, and
  // the markup it was written with has to be gone from the text the page shows.
  {
    const block = render('前文\n\n$$\na^2 + b^2 = c^2\n$$\n\n后文');
    check('a block between double dollars is typeset', Boolean(block.querySelector('.katex')), true);
    check('and its delimiters are gone', text(block).includes('$$'), false);
    const single = render('前文 $$E = mc^2$$ 后文');
    check('a display formula written on one line is typeset', Boolean(single.querySelector('.katex')), true);
    check('with its delimiters gone', text(single).includes('$$'), false);
    const inline = render('当$x=1$时，解是 1。');
    check('a formula between single dollars is typeset', Boolean(inline.querySelector('.katex')), true);
    check('and the dollar signs are gone', text(inline).includes('$'), false);
    const bracket = render('\\[x^2 + y^2\\]');
    check('a display formula in brackets is typeset', Boolean(bracket.querySelector('.katex')), true);
    const paren = render('行内 \\(a+b\\) 公式');
    check('an inline formula in parens is typeset', Boolean(paren.querySelector('.katex')), true);
  }

  // The single dollar is deliberately conservative: a note has more prices than
  // formulas, so the rule has to tell them apart.
  {
    const prices = render('价格 $5 和 $6 元');
    check('two prices are not a formula', Boolean(prices.querySelector('.katex')), false);
    check('and the dollars are kept', text(prices), '价格 $5 和 $6 元');
    const chinese = render('当$x=1$时');
    check('a formula against Chinese characters is still typeset', Boolean(chinese.querySelector('.katex')), true);
    const spaced = render('$ x $');
    check('a dollar followed by a space is not a formula', Boolean(spaced.querySelector('.katex')), false);
    check('and is left as written', text(spaced), '$ x $');
    const escaped = render('\\$5 美元');
    check('an escaped dollar is not a formula', Boolean(escaped.querySelector('.katex')), false);
    check('and shows the character it escapes', text(escaped), '$5 美元');
  }

  // Code is code, and a formula still being written must not take the note down.
  {
    const fenced = render('```\n$not math$ and $$also not$$\n```');
    check('a fenced block is not typeset', Boolean(fenced.querySelector('.katex')), false);
    check('and keeps its dollars', (fenced.textContent ?? '').includes('$not math$'), true);
    const inlineCode = render('用 `$x$` 表示内联代码');
    check('inline code is not typeset', Boolean(inlineCode.querySelector('.katex')), false);
    check('and keeps its dollars', inlineCode.querySelector('code')?.textContent, '$x$');
    const unclosed = render('未闭合 $$ 不吞掉\n\n后文还在');
    check('an unclosed display delimiter does not swallow what follows', text(unclosed).includes('后文还在'), true);
    const broken = render('坏公式 $\\frac{1}{$ 之后');
    check('a formula that will not typeset does not throw', Boolean(broken), true);
    check('and its source is still readable', text(broken).includes('\\frac'), true);
  }

  // Formulas are the one place inline styles are allowed, and only there.
  {
    const styled = render('<span style="color:red">x</span>\n\n$y=1$');
    const plain = Array.from(styled.querySelectorAll('span')).find((element) => !element.closest('.katex'));
    check('a note cannot style the page', plain?.hasAttribute('style'), false);
    check('but a formula keeps the inline styles it needs', Boolean(styled.querySelector('.katex [style]')), true);
    const hostile = render('<img src="x" onerror="window.__pwned=1"><script>window.__pwned=1</script>');
    check('an event handler attribute is stripped', hostile.innerHTML.includes('onerror'), false);
    check('and a script tag is stripped', hostile.querySelector('script'), null);
  }

  // A formula is a block like any other: the scroll sync still needs its line.
  {
    const source = '# 一\n\n$$\na=1\n$$\n\n## 二\n\n正文\n';
    const container = render(source);
    annotateSourceLines(container, source);
    const marks = Array.from(container.querySelectorAll('[data-line]')).map((element) => element.getAttribute('data-line'));
    check('every rendered block still carries its source line', marks.length, sourceBlocks(source).length);
    check('including the formula block', marks, ['1', '3', '7', '9']);
  }
}

/* --- the pictures a note refers to ---------------------------------------- */
console.log('\nimages inside a note (jsdom)');
{
  const { resolveImages, resolveImagePath, normaliseStoragePath, isImageUrl, trimUrlTail, renderMarkdown } =
    await import('./src/lib/markdown');
  const { Preview } = await import('./src/components/Preview');

  // A reference that names its own store is left alone: those are other servers
  // and inline pictures, not files in this one.
  check('an https picture is left as it is', resolveImagePath('https://cdn.example.com/a.png', '/docs/note.md'), null);
  check('so is a protocol-relative one', resolveImagePath('//cdn.example.com/a.png', '/docs/note.md'), null);
  check('and a data: one', resolveImagePath('data:image/png;base64,AAAA', '/docs/note.md'), null);
  check('and a blob: one', resolveImagePath('blob:https://x/y', '/docs/note.md'), null);
  check('and an empty reference means nothing', resolveImagePath('  ', '/docs/note.md'), null);

  // A leading slash is already a path from the notes root.
  check('a rooted path is a storage path', resolveImagePath('/img/a.png', '/docs/note.md'), '/img/a.png');
  // Everything else is read against the folder the note itself lives in.
  check('a sibling folder is read from the note', resolveImagePath('img/a.png', '/docs/note.md'), '/docs/img/a.png');
  check('a ./ is the same thing', resolveImagePath('./img/a.png', '/docs/note.md'), '/docs/img/a.png');
  check('a ../ climbs out of it', resolveImagePath('../img/a.png', '/docs/note.md'), '/img/a.png');
  check('and one too many has nowhere to go', resolveImagePath('../../img/a.png', '/docs/note.md'), '/img/a.png');
  check(
    'a query and a hash are not part of the name',
    resolveImagePath('img/a.png?v=2#top', '/docs/note.md'),
    '/docs/img/a.png',
  );
  check('a note at the root reads from the root', resolveImagePath('img/a.png', '/note.md'), '/img/a.png');
  // marked hands the src over percent-encoded, and the server decodes the path
  // once - so it has to be decoded here, or a Chinese name is looked for under
  // its own escapes and comes back 404.
  check(
    'a reference the renderer encoded is decoded again',
    resolveImagePath('./img/%E9%A3%8E%E6%99%AF.png', '/docs/note.md'),
    '/docs/img/风景.png',
  );
  check(
    'and a space in a name survives the round trip',
    resolveImagePath('img/my%20photo.png', '/docs/note.md'),
    '/docs/img/my photo.png',
  );
  // A lone percent is a character in a file name, not a broken escape.
  check(
    'a percent that is not an escape is kept as written',
    resolveImagePath('img/a%ZZb.png', '/docs/note.md'),
    '/docs/img/a%ZZb.png',
  );

  check('folding is text handling', normaliseStoragePath('/a//b/./c/../d'), '/a/b/d');
  check('backslashes are separators too', normaliseStoragePath('\\a\\b'), '/a/b');
  check('and above the root there is nothing to climb', normaliseStoragePath('..'), '/');

  // The rewrite itself, on elements rather than on strings.
  const container = document.createElement('div');
  container.innerHTML = '<img src="img/a.png"><img src="https://cdn.example.com/b.png">';
  resolveImages(container, '/docs/note.md');
  const [local, remote] = Array.from(container.querySelectorAll('img'));
  check(
    'a picture beside the note is asked of the server',
    local.getAttribute('src'),
    '/api/notes/file?path=' + encodeURIComponent('/docs/img/a.png'),
  );
  check('and the reference it was written with is kept', local.dataset.originalSrc, 'img/a.png');
  check('it loads when it is reached', local.getAttribute('loading'), 'lazy');
  check('and never overflows the pane', local.classList.contains('max-w-full'), true);
  check('while a remote one is untouched', remote.getAttribute('src'), 'https://cdn.example.com/b.png');
  // The same element shown for another note resolves from that note, not from
  // what the first pass produced - which is why the original is remembered.
  resolveImages(container, '/other/note.md');
  check(
    'and resolves again from the note it is shown in',
    local.getAttribute('src'),
    '/api/notes/file?path=' + encodeURIComponent('/other/img/a.png'),
  );

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(Preview, {
        // The name in the markdown is Chinese and the note is not at the root:
        // `marked` writes the src percent-encoded, so the resolver has to decode
        // it once before the server (which decodes the query parameter once)
        // can find the file.
        content: '![风景](./img/风景.png)\n\n![远程](https://cdn.example.com/b.png)\n',
        notePath: '/docs/note.md',
      }),
    );
  });
  await flush();
  const images = Array.from(host.querySelectorAll<HTMLImageElement>('.markdown-body img'));
  check(
    'a rendered note asks the server for the picture beside it',
    images[0]?.getAttribute('src'),
    '/api/notes/file?path=' + encodeURIComponent('/docs/img/风景.png'),
  );
  check('and leaves an outside link alone', images[1]?.getAttribute('src'), 'https://cdn.example.com/b.png');
  await act(async () => {
    root.unmount();
  });
  host.remove();

  // Whether an address ends in a picture, whatever is stuck on the end of it.
  check('a png is a picture', isImageUrl('https://cdn.example.com/a.png'), true);
  check('in any case', isImageUrl('https://cdn.example.com/A.JPEG'), true);
  check('with a query on it', isImageUrl('https://cdn.example.com/a.webp?w=800'), true);
  check('and with a fragment', isImageUrl('https://cdn.example.com/a.svg#icon'), true);
  check('a text file is not', isImageUrl('https://cdn.example.com/a.txt'), false);
  check('nor is a page', isImageUrl('https://cdn.example.com/a'), false);

  // The punctuation that followed the address in the text is not part of it.
  check(
    'a pasted payload loses its quote and brace',
    trimUrlTail('https://cdn.example.com/a.png%22%7D'),
    'https://cdn.example.com/a.png',
  );
  check('and a sentence-ending comma', trimUrlTail('https://cdn.example.com/a.png,'), 'https://cdn.example.com/a.png');
  check('and a closing bracket', trimUrlTail('https://cdn.example.com/a.jpg)'), 'https://cdn.example.com/a.jpg');
  check('while a percent that is not an escape stays', trimUrlTail('https://cdn.example.com/a%ZZ.png'), 'https://cdn.example.com/a%ZZ.png');

  // A note that only names a picture still shows it: the address arrives pasted
  // out of a payload, marked turns it into a link and swallows the closing quote
  // and brace into the href.
  const pasted = document.createElement('div');
  pasted.innerHTML = renderMarkdown('{"url":"https://cdn.example.com/a.png"}');
  const link = pasted.querySelector('a[href]');
  check('the renderer made a link of the address', Boolean(link), true);
  check('with the tail of the payload stuck to it', (link?.getAttribute('href') ?? '').includes('%22%7D'), true);
  resolveImages(pasted, '/docs/note.md');
  check('the link is corrected to the address', link?.getAttribute('href'), 'https://cdn.example.com/a.png');
  const shownUnder = link?.nextElementSibling as HTMLImageElement | null;
  check('and the picture is drawn under it', shownUnder?.tagName, 'IMG');
  check('pointing at the address', shownUnder?.getAttribute('src'), 'https://cdn.example.com/a.png');
  check('named after the file', shownUnder?.getAttribute('alt'), 'a.png');

  // Every picture the panel draws carries the same three things.
  const drawn = Array.from(pasted.querySelectorAll('img'));
  check('every picture loads only when it is reached', drawn.every((image) => image.getAttribute('loading') === 'lazy'), true);
  check(
    'and asks for no referrer, which some hosts require',
    drawn.every((image) => image.getAttribute('referrerpolicy') === 'no-referrer'),
    true,
  );
  check(
    'and never overflows the pane',
    drawn.every((image) => image.classList.contains('max-w-full') && image.classList.contains('h-auto')),
    true,
  );

  // An address written as plain text - a payload the renderer did not link - is
  // shown beside the text, which stays where it is.
  const bare = document.createElement('div');
  bare.appendChild(document.createTextNode('看图 https://cdn.example.com/c.png 就是它'));
  resolveImages(bare, '');
  check('an address that is only text is shown beside it', bare.querySelectorAll('img').length, 1);
  check('pointing where the text says', bare.querySelector('img')?.getAttribute('src'), 'https://cdn.example.com/c.png');
  check('and the text is still there', (bare.textContent ?? '').includes('看图 https://cdn.example.com/c.png 就是它'), true);
  resolveImages(bare, '');
  check('and running it again does not draw it twice', bare.querySelectorAll('img').length, 1);

  // Two addresses in one line: one picture each, in the order they were written,
  // with the words between them still there.
  const pair = document.createElement('div');
  pair.appendChild(
    document.createTextNode('先 https://cdn.example.com/one.png 后 https://cdn.example.com/two.jpg 完'),
  );
  resolveImages(pair, '');
  check(
    'two addresses in one line are both shown, in order',
    Array.from(pair.querySelectorAll('img')).map((image) => image.getAttribute('src')),
    ['https://cdn.example.com/one.png', 'https://cdn.example.com/two.jpg'],
  );
  check(
    'and the words around them are still there',
    (pair.textContent ?? '').includes('先 https://cdn.example.com/one.png 后 https://cdn.example.com/two.jpg 完'),
    true,
  );
  // A second pass - even for another note - leaves a page that already has its
  // pictures exactly as it was.
  const once = pair.innerHTML;
  resolveImages(pair, '');
  check('running it again changes nothing at all', pair.innerHTML, once);
  resolveImages(pair, '/other/note.md');
  check('nor does running it for another note', pair.innerHTML, once);

  // The same for the addresses inside a code sample: the sample is left exactly
  // as written, and what it names is drawn under the block.
  const sample = document.createElement('div');
  sample.innerHTML = renderMarkdown(
    '\u0060\u0060\u0060\nhttps://cdn.example.com/a.png\nhttps://cdn.example.com/a.png\nhttps://cdn.example.com/b.jpg\n\u0060\u0060\u0060\n',
  );
  resolveImages(sample, '/docs/note.md');
  const block = sample.querySelector('pre');
  check('a code sample keeps its text', (block?.textContent ?? '').includes('https://cdn.example.com/a.png'), true);
  check('and says it has been looked at', block?.getAttribute('data-image-preview'), 'true');
  const holder = sample.querySelector('.code-image-preview');
  check('with the pictures under the block, one per address', holder?.querySelectorAll('img').length, 2);
  check('right after it', block?.nextElementSibling === holder, true);
  check(
    'each pointing at the address the code names',
    Array.from(holder?.querySelectorAll('img') ?? []).map((image) => image.getAttribute('src')),
    ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.jpg'],
  );
  const sampleImages = sample.querySelectorAll('img').length;
  resolveImages(sample, '/docs/note.md');
  check('and running that again adds nothing', sample.querySelectorAll('img').length, sampleImages);

  // A sample full of addresses draws a wall of them, but not an endless one.
  const many = document.createElement('div');
  const addresses = Array.from({ length: 14 }, (_value, index) => 'https://cdn.example.com/' + index + '.png');
  many.innerHTML = renderMarkdown('\u0060\u0060\u0060\n' + addresses.join('\n') + '\n\u0060\u0060\u0060\n');
  resolveImages(many, '');
  check('a block full of addresses draws twelve at most', many.querySelectorAll('.code-image-preview img').length, 12);
}

/* --- deep links under /manager -------------------------------------------- */
console.log('\ndeep links (jsdom)');
{
  const { homeUrl, isManagerPath, noteUrl, readLocation, replaceLocation } = await import('./src/lib/url');

  check('the panel root is /manager/', noteUrl(null), '/manager/');
  check('a note is addressed by its storage path', noteUrl('/public/Notes/a.md'), '/manager/public/Notes/a.md');
  check('and an anchor rides along', noteUrl('/public/Notes/a.md', 'x'), '/manager/public/Notes/a.md#x');
  check('the front page is not the panel', homeUrl(), '/');
  check('so it is not a panel address', isManagerPath('/'), false);
  check('nor is an address outside the panel', isManagerPath('/public/Notes/a.md'), false);
  check('while the panel root is', isManagerPath('/manager'), true);
  check('and a note inside it', isManagerPath('/manager/public/Notes/a.md'), true);

  // What is written and what is read back have to agree, or a shared link opens
  // the wrong note - or nothing at all.
  w.history.replaceState(null, '', '/manager/public/Notes/a.md#h');
  check('an address reads back as the note it names', readLocation(), { path: '/public/Notes/a.md', anchor: 'h' });
  w.history.replaceState(null, '', '/');
  check('the front page names no note', readLocation(), { path: '', anchor: '' });
  w.history.replaceState(null, '', '/manager/');
  check('and neither does the panel root', readLocation(), { path: '', anchor: '' });
  replaceLocation('/public/Notes/a.md', 'h');
  check('writing an address round-trips', w.location.pathname + w.location.hash, '/manager/public/Notes/a.md#h');
}

/* --- the blog's front page ------------------------------------------------ */
/** A published note, as the public API hands it over. */
const blogSummary = (path: string, title: string, extra: Partial<BlogPostSummary> = {}): BlogPostSummary => ({
  id: path.replace(/^\//, ''),
  path,
  title,
  summary: '**开头**的摘要',
  publishedAt: '2026-01-02T03:04:00.000Z',
  updatedAt: '2026-02-03T04:05:00.000Z',
  wordCount: 12,
  tags: [],
  ...extra,
});

/** A JSON answer, for the stubs the blog and the settings dialog ask for. */
const reply = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

console.log('\nthe blog\'s front page (jsdom)');
{
  const { BlogIndexPage } = await import('./src/components/blog/BlogIndexPage');
  const realFetch = globalThis.fetch;
  const opened: string[] = [];

  const mountIndex = async (answer: () => Response | Promise<Response>) => {
    globalThis.fetch = (async () => answer()) as typeof fetch;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(BlogIndexPage, { onOpenPost: (path: string) => opened.push(path) }));
    });
    await flush();
    return {
      host,
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  };

  // Two published notes: one card each.
  const posts = [
    blogSummary('/posts/hello.md', '第一篇文章'),
    blogSummary('/posts/second.md', '第二篇文章', { summary: '带 *斜体* 的摘要' }),
  ];
  // A visitor is the reader this page is for.
  appStore.setState({ user: null });
  const page = await mountIndex(() => reply({ enabled: true, title: '测试博客', posts }));
  const cards = Array.from(page.host.querySelectorAll<HTMLAnchorElement>('[data-blog-card]'));
  check('two published notes make two cards', cards.length, 2);
  check('the header is the blog\'s own title', page.host.querySelector('h1')?.textContent, '测试博客');
  check('and it counts what is published', page.host.innerHTML.includes('共 2 篇已发布'), true);
  check(
    'each card is a link to the post it stands for',
    cards.map((card) => card.getAttribute('href')),
    ['/notes/posts/hello.md', '/notes/posts/second.md'],
  );
  check('named by its title', cards[0]?.querySelector('h2')?.textContent, '第一篇文章');
  check('the summary is rendered as markdown', Boolean(cards[0]?.querySelector('.blog-summary strong')), true);
  check('with its emphasis too', Boolean(cards[1]?.querySelector('.blog-summary em')), true);
  check('the card says when it went up', (cards[0]?.textContent ?? '').includes('发布'), true);
  check('and when it last changed', (cards[0]?.textContent ?? '').includes('修改'), true);
  const click = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    cards[1]?.dispatchEvent(click);
  });
  check('clicking a card is the app\'s business', click.defaultPrevented, true);
  check('and asks for that post', opened, ['/posts/second.md']);
  // The way into the panel is always on the page: the reader who is not signed
  // in is exactly the one who needs it.
  const visitor = page.host.querySelector<HTMLButtonElement>('[data-blog-manager]');
  check('a visitor is offered a way in', Boolean(visitor), true);
  check('called what it does for them', visitor?.getAttribute('aria-label'), '登录');
  check('and saying so on the button', visitor?.textContent?.trim(), '登录');
  await page.unmount();

  // Signed in, the same door is the panel itself.
  appStore.setState({
    user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
  } as never);
  const signedIn = await mountIndex(() => reply({ enabled: true, title: '测试博客', posts }));
  const owner = signedIn.host.querySelector<HTMLButtonElement>('[data-blog-manager]');
  check('and to somebody signed in it is the panel', owner?.getAttribute('aria-label'), '管理面板');
  check('which it says too', owner?.textContent?.trim(), '管理面板');
  await signedIn.unmount();
  appStore.setState({ user: null });

  // Nothing published yet.
  const empty = await mountIndex(() => reply({ enabled: true, title: '测试博客', posts: [] }));
  check('an empty blog says so', empty.host.innerHTML.includes('还没有内容'), true);
  await empty.unmount();

  // The administrator has not turned it on.
  const off = await mountIndex(() => reply({ enabled: false, title: '测试博客', posts: [] }));
  check('a blog that is off says so', off.host.innerHTML.includes('博客还没有开放'), true);
  await off.unmount();

  // The server refused.
  const refused = await mountIndex(() => reply({ error: { message: '服务器出错了' } }, 500));
  check('a refusal is reported as its own thing', refused.host.innerHTML.includes('打不开博客'), true);
  check('in the server\'s words', refused.host.innerHTML.includes('服务器出错了'), true);
  await refused.unmount();

  // And nothing answered at all.
  const offline = await mountIndex(() => {
    throw new Error('no server here');
  });
  check('a server that cannot be reached says so too', offline.host.innerHTML.includes('打不开博客'), true);
  check('and says the server could not be reached', offline.host.innerHTML.includes('无法连接服务器'), true);
  await offline.unmount();

  // The old front-page entry is gone: the blog is the front page now.
  check('and the old front-page icon is nowhere', document.querySelector('[data-panel-entry]'), null);

  globalThis.fetch = realFetch;
}

/* --- one post on the blog -------------------------------------------------- */
console.log('\none post on the blog (jsdom)');
{
  const { BlogPostPage } = await import('./src/components/blog/BlogPostPage');
  const realFetch = globalThis.fetch;
  const content = ['# 1.1 分层', '', 'intro ![图](./img/a.png)', '', '## 1.2 权限', '', 'middle', ''].join('\n');
  const post = { ...blogSummary('/posts/hello.md', '第一篇文章'), wordCount: 42, content };
  const opened: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/blog/post')) return reply({ enabled: true, post });
    if (url.includes('/api/blog')) return reply({ enabled: true, title: '测试博客', posts: [post] });
    throw new Error('no server here');
  }) as typeof fetch;

  const mountPost = async (anchor: string) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(BlogPostPage, {
          path: '/posts/hello.md',
          anchor,
          onOpenPost: (path: string) => opened.push(path),
          onOpenIndex: () => undefined,
        }),
      );
    });
    await flush();
    return {
      host,
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  };

  appStore.setState({ user: null });
  w.history.replaceState(null, '', '/notes/posts/hello.md');
  const page = await mountPost('');
  check('the post is headed by its title', page.host.querySelector('h1')?.textContent, '第一篇文章');
  // The reading card is the screen: no width limit of its own, and no page
  // padding around it. The text takes the width it is given - a capped column
  // left empty glass either side on a wide window - so the spacing comes from
  // the gutter rather than from a maximum width.
  const surface = page.host.querySelector('[data-blog-surface]');
  const surfaceClass = surface?.className ?? '';
  check('the reading card is there', Boolean(surface), true);
  check('taking the whole width', surfaceClass.includes('w-full'), true);
  check('and the whole height', surfaceClass.includes('h-full'), true);
  check('with no width limit of its own', /(^|\s)max-w-/.test(surfaceClass), false);
  check('and the text is not held back by one either', Boolean(page.host.querySelector('.max-w-4xl')), false);
  check('with the gutter doing the spacing instead', page.host.innerHTML.includes('px-7'), true);
  check('and the way into the panel is here too', Boolean(page.host.querySelector('[data-blog-manager]')), true);
  check('with when it went up', page.host.innerHTML.includes('发布'), true);
  check('when it last changed', page.host.innerHTML.includes('修改'), true);
  check('and how long it is', page.host.innerHTML.includes('42 字'), true);
  // An id that starts with a digit cannot be written as a CSS selector.
  check('the body is the published note, rendered', Boolean(page.host.querySelector('.markdown-body [id="11-分层"]')), true);
  // A picture inside a post goes through the public door, which asks nobody.
  check(
    'a picture in the post is fetched publicly',
    page.host.querySelector('.markdown-body img')?.getAttribute('src'),
    '/api/blog/file?path=' + encodeURIComponent('/posts/img/a.png'),
  );

  // The outline is the post's own headings, in order.
  const outlineItems = Array.from(page.host.querySelectorAll<HTMLButtonElement>('[data-outline-item]'));
  check('the outline lists the headings', outlineItems.length, 2);
  check('by their text', outlineItems.map((item) => item.textContent?.trim()), ['1.1 分层', '1.2 权限']);
  // Exactly one control hides it - a second one would be two answers to one
  // question, which is what the panel's own outline used to be.
  check('there is exactly one outline handle', document.querySelectorAll('[data-outline-handle]').length, 1);

  scrollCalls.length = 0;
  await act(async () => {
    outlineItems[1]?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  check('clicking an entry moves the address there', decodeURIComponent(w.location.hash), '#12-权限');
  check(
    'and scrolls the article to it',
    scrollCalls.some((call) => call.target.classList.contains('markdown-body')),
    true,
  );

  // The handle is the one way in and out of the outline.
  const handle = () => document.querySelector<HTMLButtonElement>('[data-outline-handle]');
  check('the handle says the outline is open', handle()?.getAttribute('aria-pressed'), 'true');
  await act(async () => {
    handle()?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await settled();
  check('clicking it hides the outline', Boolean(page.host.querySelector('.outline-panel')), false);
  check('and it says so', handle()?.getAttribute('aria-pressed'), 'false');
  await act(async () => {
    handle()?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await settled();
  check('clicking it again brings the outline back', Boolean(page.host.querySelector('.outline-panel')), true);
  check('still the only handle', document.querySelectorAll('[data-outline-handle]').length, 1);
  await page.unmount();

  // A deep link lands on its heading.
  w.history.replaceState(null, '', '/notes/posts/hello.md');
  const linked = await mountPost('12-权限');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240));
  });
  await flush();
  check('a deep link moves the address to its heading', decodeURIComponent(w.location.hash), '#12-权限');
  check(
    'and marks the heading it landed on',
    Boolean(linked.host.querySelector('.markdown-body [id="12-权限"]')?.classList.contains('heading-flash')),
    true,
  );
  await linked.unmount();

  globalThis.fetch = realFetch;
}

/* --- what the site's front page is ----------------------------------------- */
console.log('\nthe site\'s front page (jsdom)');
{
  const App = (await import('./src/App')).default;
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;

  const statusFor = (enabled: boolean) => ({
    version: '1.0.0',
    basePath: '',
    publicUrl: '',
    uptimeSeconds: 1,
    blog: { enabled },
    storage: {
      driver: 'local',
      mode: 'auto',
      displayRoot: '/notes',
      degraded: false,
      detail: '',
      openlist: { configured: false, url: '', reachable: false, initialized: false, version: null, checkedAt: 0 },
      localRoot: '/notes',
      perUser: false,
      tokenAttached: false,
    },
    providers: { local: true, openlist: false, openlistConfigured: false, openlistUrl: null, openlistInitialized: false, guest: false },
    user: null,
  });

  const mountApp = async (enabled: boolean, pathname: string) => {
    const status = statusFor(enabled);
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/system/status')) return reply(status);
      if (url.includes('/api/auth/providers') || url.includes('/api/auth/me')) return reply({ user: null });
      if (url.includes('/api/blog/post')) return reply({ enabled, post: { ...blogSummary('/posts/hello.md', '第一篇文章'), content: '# 标题\n' } });
      if (url.includes('/api/blog')) return reply({ enabled, title: '测试博客', posts: [blogSummary('/posts/hello.md', '第一篇文章')] });
      if (url.includes('/api/fonts')) return reply({ fonts: [], selection: { sans: '', mono: '' } });
      return reply({});
    }) as typeof fetch;
    appStore.setState({
      booted: true,
      user: null,
      status,
      notes: [],
      activeNote: null,
      activeId: null,
    } as never);
    w.history.replaceState(null, '', pathname);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(App));
    });
    // boot(), the page's own request, and the address rewrite all settle here.
    await settled();
    return {
      host,
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  };

  // With the blog on, the site's root is the blog.
  const blog = await mountApp(true, '/');
  check('the site root is the blog when it is on', Boolean(blog.host.querySelector('[data-blog-card]')), true);
  check('and the panel is not behind it', Boolean(blog.host.querySelector('[data-note-tree]')), false);
  check('nor a sign-in card', blog.host.innerHTML.includes('登录工作台'), false);
  await blog.unmount();

  // A post has an address of its own.
  const post = await mountApp(true, '/notes/posts/hello.md');
  check('a /notes/ address is one post', post.host.querySelector('h1')?.textContent, '第一篇文章');
  check('with the way back to the index', Boolean(post.host.querySelector('[data-blog-home]')), true);
  await post.unmount();

  // With the blog off, those addresses belong to the panel: the site's root is
  // the way in, not a page nobody asked for.
  const offRoot = await mountApp(false, '/');
  check('with the blog off the root goes to the panel', w.location.pathname, '/manager/');
  check('which is the sign-in card', offRoot.host.innerHTML.includes('登录工作台'), true);
  check('and no card is left over', offRoot.host.innerHTML.includes('data-blog-card'), false);
  await offRoot.unmount();

  const offPost = await mountApp(false, '/notes/posts/hello.md');
  check('and so does a post address', w.location.pathname, '/manager/');
  check('with the sign-in card again', offPost.host.innerHTML.includes('登录工作台'), true);
  await offPost.unmount();

  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- the way back to the blog ---------------------------------------------- */
console.log('\nthe way back to the blog (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [summaryNote('a', '根目录笔记', '')],
    folders: [],
    status: { blog: { enabled: true } },
    user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
  } as never);
  const panel = await mountPanel();
  check('a reader signed in can go and look at the blog', Boolean(panel.host.querySelector('button[aria-label="返回博客"]')), true);
  await panel.unmount();

  appStore.setState({ status: { blog: { enabled: false } } } as never);
  const off = await mountPanel();
  check('and is not offered one that is switched off', Boolean(off.host.querySelector('button[aria-label="返回博客"]')), false);
  await off.unmount();

  appStore.setState(hold);
}

/* --- the blog switch -------------------------------------------------------- */
console.log('\nthe blog switch (jsdom)');
{
  const { SettingsDialog } = await import('./src/components/SettingsDialog');
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;

  const settings = {
    storage: {
      driver: 'local',
      openlist: { url: '', token: '', root: '/notes', perUser: false, timeoutMs: 15000 },
      local: { root: '' },
    },
    background: {
      kind: 'off',
      file: '',
      note: '',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      blur: 0,
      dim: 0,
      dynamic: false,
      auroraA: '',
      auroraB: '',
    },
    guest: { enabled: true },
    blog: { enabled: true },
  };
  let stored: Record<string, unknown> | null = null;
  const savedBody = () => stored;

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.includes('/api/system/settings') && method === 'PUT') {
      stored = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      return reply({ ok: true });
    }
    if (url.includes('/api/system/settings')) {
      return reply({
        settings,
        effective: { ...settings, background: settings.background, sources: {} },
        paths: {
          projectRoot: '/srv/notes-manager',
          dataDir: '/srv/notes-manager/data',
          localNotesRoot: '/srv/notes-manager/data/notes',
          envFile: '/srv/notes-manager/.env',
          envFileLoaded: true,
        },
        env: { storageDriver: null, openlistUrl: null, openlistTokenSet: false, openlistRoot: null, notesRoot: null },
      });
    }
    return reply({});
  }) as typeof fetch;
  appStore.setState({ settingsOpen: true });

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(SettingsDialog));
  });
  await flush();

  const setting = host.querySelector('[data-testid="blog-setting"]');
  const blogSwitch = () => setting?.querySelector<HTMLButtonElement>('[role="switch"]');
  check('the settings offer the blog', Boolean(setting), true);
  check('with the switch where the server left it', blogSwitch()?.getAttribute('aria-checked'), 'true');
  check('and the wording says what the front page is', (setting?.textContent ?? '').includes('站点根 / 是博客首页'), true);
  // Where the switch points is the publish screens, and it says so: the note's
  // front matter is an implementation detail, not something to send a reader to.
  check(
    'pointing at where publishing is decided',
    ['发布管理', '标题与简介', '右键一篇笔记'].every((text) => (setting?.textContent ?? '').includes(text)),
    true,
  );
  check('with nothing about front matter left in it', (setting?.textContent ?? '').includes('front matter'), false);
  check('nor about a switch still to come', (setting?.textContent ?? '').includes('随后再加'), false);
  // Turning the blog on is what gives the public pages something to read with:
  // the OpenList guest identity, and it has to say so - the token is the panel's.
  check(
    'and names the guest identity the blog reads with',
    ['访客身份', '不需要 API 令牌', '访客被禁用'].every((text) => (setting?.textContent ?? '').includes(text)),
    true,
  );

  await act(async () => {
    blogSwitch()?.click();
  });
  await flush();
  check('turning it off flips the switch', blogSwitch()?.getAttribute('aria-checked'), 'false');
  check('and says what that means', (setting?.textContent ?? '').includes('跳到管理面板的登录页'), true);

  const save = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === '保存设置');
  await act(async () => {
    save?.click();
  });
  await flush();
  check(
    'saving sends the switch as it stands',
    (savedBody()?.blog as { enabled?: boolean } | undefined)?.enabled,
    false,
  );
  check('alongside the visitor switch', (savedBody()?.guest as { enabled?: boolean } | undefined)?.enabled, true);

  await act(async () => {
    root.unmount();
  });
  host.remove();
  appStore.setState(hold);
  globalThis.fetch = realFetch;
}

/* --- publishing a note ------------------------------------------------------ */
console.log('\npublishing a note (jsdom)');
{
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;

  const noteA = summaryNote('a', '笔记A的标题', '', {
    blog: true,
    blogAt: '2026-01-02T03:04:00.000Z',
    blogTitle: '卡片上的标题',
    blogSummary: '**卡片**上的简介',
    hasPublishInfo: true,
  });
  const noteB = summaryNote('b', '笔记B的标题', '', { hasPublishInfo: true });
  const picture = summaryNote('p', '风景.png', '', { kind: 'image', size: 2048, excerpt: '' });

  const entries = [
    {
      id: 'a',
      path: '/a.md',
      name: 'a.md',
      published: true,
      publishedAt: '2026-01-02T03:04:00.000Z',
      title: '卡片上的标题',
      summary: '卡片上的简介',
      editedTitle: true,
      editedSummary: true,
      updatedAt: '2026-02-03T04:05:00.000Z',
    },
    {
      id: 'b',
      path: '/b.md',
      name: 'b.md',
      published: false,
      publishedAt: null,
      title: '笔记B的标题',
      summary: '',
      editedTitle: false,
      editedSummary: false,
      updatedAt: '2026-02-04T05:06:00.000Z',
    },
  ];

  // Whatever is sent to the server is recorded, so a button that must send
  // nothing can be told apart from one that sends something.
  const writes: { method: string; url: string; body: string }[] = [];
  // The store call that takes a note off the publish list, recorded rather than
  // performed: the note itself is not what is being tested here.
  const forgotten: string[] = [];

  appStore.setState({
    capabilities: WRITABLE,
    notes: [noteA, noteB, picture],
    folders: [],
    expandedFolders: [],
    activeFolder: null,
    activeId: null,
    query: '',
    selection: [],
    loadingNotes: false,
    notesError: null,
    forgetPublish: async (id: string) => {
      forgotten.push(id);
    },
  } as never);

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET') writes.push({ method, url, body: String(init.body ?? '') });
    if (url.includes('/api/notes/publish')) return reply({ entries });
    if (method === 'PUT' && /\/api\/notes\//.test(url)) {
      const patch = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      return reply({ note: { ...noteA, ...patch } });
    }
    // Saving asks for the list again (refreshMeta), so the list has to answer.
    if (url.includes('/api/notes')) {
      return reply({
        notes: [noteA, noteB, picture],
        stats: { notes: 3, tags: 0, folders: 0, words: 0, updatedAt: null },
        tags: [],
        folders: [],
        capabilities: WRITABLE,
      });
    }
    return reply({});
  }) as typeof fetch;

  const panel = await mountPanel();
  const row = (key: string) => panel.host.querySelector('[data-tree-row="' + key + '"]');

  // The way in, beside the trash: the two list-wide panels sit together.
  const entry = panel.host.querySelector<HTMLButtonElement>('button[data-open-publish-manager]');
  check('the panel offers a publish manager', Boolean(entry), true);
  check('named for what it opens', entry?.getAttribute('aria-label'), '发布管理');
  const trash = panel.host.querySelector('button[aria-label="回收站"]');
  check(
    'sitting right after the trash',
    Boolean(entry && trash?.parentElement && trash.parentElement.nextElementSibling === entry.parentElement),
    true,
  );

  // A note's own menu carries it, and opening it asks about that note.
  await rightClick(row('note:a') as Element);
  check('a note can be published from its own menu', openMenuItems().includes('note-publish'), true);
  check('called what it does', openMenuLabels().some((label) => label.includes('发布管理')), true);
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-menu-item="note-publish"]')?.click();
  });
  await flush();
  check('which opens the publish settings for it', Boolean(document.querySelector('[data-publish-form]')), true);
  check(
    'starting from what that note holds',
    document.querySelector<HTMLInputElement>('input[aria-label="博客标题"]')?.value,
    '卡片上的标题',
  );
  check(
    'and its summary',
    document.querySelector<HTMLTextAreaElement>('[data-publish-summary]')?.value,
    '**卡片**上的简介',
  );
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '取消')?.click();
  });
  await settled();

  // A picture has no blog entry of its own.
  await rightClick(row('note:p') as Element);
  check('a picture is not offered publish settings', openMenuItems().includes('note-publish'), false);
  await closeMenu();

  // Nothing may be published by an account that cannot write.
  await act(async () => {
    appStore.setState({
      capabilities: { ...WRITABLE, writable: false, permissions: { write: false, rename: false, move: false, remove: false } },
    } as never);
  });
  await rightClick(row('note:a') as Element);
  check('and a read-only account is not offered it either', document.querySelector('[data-menu-item="note-publish"]')?.hasAttribute('disabled'), true);
  await closeMenu();
  await act(async () => {
    appStore.setState({ capabilities: WRITABLE } as never);
  });

  // The manager itself.
  await act(async () => {
    entry?.click();
  });
  await flush();
  check('the manager lists what has publish settings', Boolean(document.querySelector('[data-publish-table]')), true);
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('[data-publish-row]'));
  check('a row each', rows.length, 2);
  check(
    'saying which of them is on the blog',
    rows.map((item) => item.getAttribute('data-publish-state')),
    ['published', 'draft'],
  );
  check('a note that is not published has no date', rows[1]?.querySelectorAll('td')[1]?.textContent?.trim(), '-');

  // A row is one line per cell, so double-clicking shows the whole thing.
  await act(async () => {
    rows[0]?.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  });
  await flush();
  const detail = document.querySelector('[data-publish-detail]');
  check('double-clicking a row shows the whole of it', Boolean(detail), true);
  check('with the title in full', (detail?.textContent ?? '').includes('卡片上的标题'), true);
  check('and the summary in full', (detail?.textContent ?? '').includes('卡片上的简介'), true);
  await act(async () => {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  // A modal leaves on a spring, and jsdom has to run every frame of it.
  await settled(1500);
  check('Escape puts the detail away and leaves the table', Boolean(document.querySelector('[data-publish-table]')), true);
  check('with the detail gone', Boolean(document.querySelector('[data-publish-detail]')), false);

  // Editing a row is the same dialog the panel opens.
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="编辑发布信息"]')?.click();
  });
  await flush();
  check('editing a row opens the publish settings', Boolean(document.querySelector('[data-publish-form]')), true);
  check(
    'with that row\'s title',
    document.querySelector<HTMLInputElement>('input[aria-label="博客标题"]')?.value,
    '卡片上的标题',
  );
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '取消')?.click();
  });
  await settled();
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button[aria-label="删除发布信息"]')?.click();
  });
  await flush();
  const confirm = document.querySelector('[data-publish-confirm]');
  check('deleting the information asks first', Boolean(confirm), true);
  check('saying that the note itself stays', (confirm?.textContent ?? '').includes('笔记文件本身不会被删除'), true);
  await act(async () => {
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === '删除发布信息')?.click();
  });
  await flush();
  check('and it is the information that goes', forgotten, ['a']);
  check('with the row off the table', document.querySelectorAll('[data-publish-row]').length, 1);
  await panel.unmount();

  // The dialog on its own: what it starts from, what it sends, and what
  // cancelling sends (nothing).
  const { PublishDialog } = await import('./src/components/publish/PublishDialog');
  const openDialog = async (noteId: string) => {
    let closed = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(PublishDialog, {
          noteId,
          open: true,
          onClose: () => {
            closed += 1;
          },
        }),
      );
    });
    await flush();
    return {
      host,
      closed: () => closed,
      async unmount() {
        await act(async () => {
          root.unmount();
        });
        host.remove();
      },
    };
  };
  const field = (selector: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  const press = (label: string) =>
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === label)?.click();
  const typeInto = async (selector: string, value: string) => {
    const element = field(selector) as HTMLTextAreaElement | HTMLInputElement | null;
    if (!element) return;
    const proto = element.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    await flush();
  };

  writes.length = 0;
  const visitor = await openDialog('a');
  check('the dialog opens with the note\'s own override', field('input[aria-label="博客标题"]')?.value, '卡片上的标题');
  check('and its summary', (field('[data-publish-summary]') as HTMLTextAreaElement | null)?.value, '**卡片**上的简介');
  check('and its state', document.querySelector('[role="switch"]')?.getAttribute('aria-checked'), 'true');
  await act(async () => {
    press('取消');
  });
  await flush();
  check('cancelling sends nothing at all', writes.length, 0);
  check('and closes the dialog', visitor.closed(), 1);
  await visitor.unmount();
  await settled();

  // A title nobody changed is the note's own title: sending it would freeze the
  // card against a later rename, so it goes as an empty string.
  writes.length = 0;
  const draft = await openDialog('b');
  check('a note without an override starts at its own title', field('input[aria-label="博客标题"]')?.value, '笔记B的标题');
  await typeInto('[data-publish-summary]', '**实时**预览');
  check('the summary is previewed as markdown while it is typed', Boolean(document.querySelector('[data-publish-preview] strong')), true);
  await act(async () => {
    press('确定');
  });
  await flush();
  check('saving sends one request', writes.length, 1);
  check('as a PUT to that note', writes[0]?.method + ' ' + (writes[0]?.url.includes('/api/notes/b') ?? false), 'PUT true');
  check(
    'with the switch, the title and the summary',
    JSON.parse(writes[0]?.body ?? '{}'),
    { blog: false, blogTitle: '', blogSummary: '**实时**预览' },
  );
  await draft.unmount();
  await settled();

  // A title of its own is an override, and goes as it stands.
  writes.length = 0;
  const renamed = await openDialog('b');
  await typeInto('input[aria-label="博客标题"]', '全新的标题');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
  });
  await flush();
  await act(async () => {
    press('确定');
  });
  await flush();
  check(
    'a title of its own is sent as it stands',
    JSON.parse(writes[0]?.body ?? '{}'),
    { blog: true, blogTitle: '全新的标题', blogSummary: '' },
  );
  await renamed.unmount();
  await settled();

  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- a tooltip wrapper does not fight the placement it is given ------------ */
const { Tooltip } = await import('./src/components/ui/primitives');

console.log('\ntooltip placement (jsdom)');
{
  const renderTip = async (node: React.ReactElement) => {
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

  const wrapperClass = (html: string) => (html.match(/^<span class="([^"]*)"/) ?? [])[1] ?? '';

  const plain = await renderTip(
    React.createElement(Tooltip, { label: '提示', children: React.createElement('button', null, 'x') }),
  );
  check('a tooltip anchors itself when nothing else does', /\brelative\b/.test(wrapperClass(plain)), true);

  // cn() is clsx, which does not merge: emitting both would let Tailwind's
  // later "relative" win and drop the wrapper back into the flow.
  const placed = await renderTip(
    React.createElement(Tooltip, {
      label: '提示',
      className: 'absolute right-9 top-1/2 -translate-y-1/2',
      children: React.createElement('button', null, 'x'),
    }),
  );
  const cls = wrapperClass(placed);
  check('a placed tooltip keeps the placement it was given', /\babsolute\b/.test(cls), true);
  check('and does not also claim to be relative', /\brelative\b/.test(cls), false);

  // The control the fix was for, and the general rule behind it.
  const { NotesPanel: Panel } = await import('./src/components/NoteList');
  const panelHold = appStore.getState();
  appStore.setState({ query: '' });
  const panel = await renderTip(React.createElement(Panel));
  // The scope control is the rightmost thing in the search box again: the "/"
  // hint it used to make room for is gone.
  check('the search-scope control carries its placement', panel.includes('absolute right-2'), true);
  appStore.setState({ query: '风景' });
  const searching = await renderTip(React.createElement(Panel));
  // The clear button sits just inside it, where a second control belongs.
  check('and the clear button sits inside it', searching.includes('absolute right-9'), true);
  appStore.setState(panelHold);
  // Nothing anywhere may hold two position classes: whichever Tailwind emits
  // last wins, and that is not the one the author asked for.
  const positionClasses = (html: string): string[] =>
    html.match(/class="[^"]*\b(?:relative|absolute|fixed|sticky)\b[^"]*\b(?:relative|absolute|fixed|sticky)\b[^"]*"/g) ?? [];
  check('and no element carries two position classes at once', positionClasses(panel).concat(positionClasses(searching)), []);
}

/* --- asking for a name before making a folder ------------------------------ */
console.log('\nfolder prompts (jsdom)');
{
  const { PromptDialog } = await import('./src/components/NoteList');
  const renderPrompt = async (state: unknown) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    await act(async () => {
      r.render(
        React.createElement(PromptDialog, {
          state: state as never,
          folders: ['proj', 'proj/deep'],
          onClose: () => undefined,
          onConfirm: () => undefined,
        }),
      );
    });
    await flush();
    const html = host.innerHTML;
    // The suggestion list is a portal on the page, not part of the dialog's DOM.
    const popover = document.querySelector('[data-testid="folder-suggestions"]')?.textContent ?? '';
    await act(async () => {
      r.unmount();
    });
    host.remove();
    return { html, popover };
  };

  // Creating used to invent a name and make the folder in one go, which left a
  // folder called 新文件夹 to be renamed straight afterwards.
  const rootPrompt = await renderPrompt({ kind: 'newFolder', parent: '', value: '新文件夹' });
  check('making a folder asks for its name', rootPrompt.html.includes('新建文件夹'), true);
  check('and says where it will go', rootPrompt.html.includes('在根目录下'), true);
  check('with the name in a field', rootPrompt.html.includes('<input'), true);

  const nested = await renderPrompt({ kind: 'newFolder', parent: 'proj', value: '新文件夹' });
  check('a nested one names its parent', nested.html.includes('在 proj 下'), true);

  const move = await renderPrompt({ kind: 'moveNote', id: 'a', value: 'proj' });
  check(
    'moving picks from the folders',
    move.html.includes('移动笔记') && move.popover.includes('proj/deep'),
    true,
  );
}

/* --- the running version is visible in the page ---------------------------- */
const { SettingsDialog } = await import('./src/components/SettingsDialog');
const { LoginScreen } = await import('./src/components/LoginScreen');

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

  check(
    'the login screen stays clean before the server answers',
    (await renderOnce(React.createElement(LoginScreen))).includes('v1.0.0'),
    false,
  );

  appStore.setState({
    // `blog` is part of the status the server sends; a fixture without it
    // would be a server this app no longer speaks to.
    status: { version: '1.0.0', basePath: '', publicUrl: '', uptimeSeconds: 5, blog: { enabled: false } } as never,
  });
  // The login screen is where a deployed version gets checked before signing in.
  const loginMarkup = await renderOnce(React.createElement(LoginScreen));
  check('the login screen shows it', loginMarkup.includes('notes-manager-web v1.0.0'), true);
  check('the panel header shows the version', (await renderOnce(React.createElement(NotesPanel))).includes('v1.0.0'), true);

  appStore.setState({ settingsOpen: true });
  const settings = await renderOnce(React.createElement(SettingsDialog));
  check('the settings dialog shows it too', settings.includes('v1.0.0'), true);
  check('labelled as 版本', settings.includes('版本'), true);

  appStore.setState(hold);
}

/* --- the administrator's default background -------------------------------- */
console.log('\ndefault background (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    settingsOpen: true,
    adminBackground: {
      configured: true,
      kind: 'scene',
      file: 'rossi.pkg',
      bytes: 45_562_692,
      hash: 'abc123',
      url: '/api/background/file?v=rossi.pkg',
      note: '洛茜 Rossi',
      options: { crop: { x: 0, y: 0, w: 1, h: 1 }, blur: 0, dim: 0.35, dynamic: false, auroraA: '', auroraB: '' },
      available: [
        { name: 'rossi.pkg', kind: 'scene', bytes: 45_562_692 },
        { name: 'loop.mp4', kind: 'video', bytes: 2_048_000 },
        { name: 'still.png', kind: 'image', bytes: 1024 },
      ],
    },
  });

  // The section edits the saved settings, which the dialog reads from the
  // server; jsdom has no server, so it is answered here.
  const realFetch = globalThis.fetch;
  const settings = {
    storage: {
      driver: 'local',
      openlist: { url: '', token: '', root: '/notes', perUser: false, timeoutMs: 15000 },
      local: { root: '' },
    },
    background: {
      kind: 'scene',
      file: 'rossi.pkg',
      note: '洛茜 Rossi',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      blur: 0,
      dim: 0.35,
      dynamic: false,
      auroraA: '',
      auroraB: '',
    },
    guest: { enabled: true },
    blog: { enabled: false },
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/system/settings')) {
      return new Response(
        JSON.stringify({
          settings,
          effective: { ...settings, background: settings.background, sources: {} },
          paths: {
            projectRoot: '/srv/notes-manager',
            dataDir: '/srv/notes-manager/data',
            localNotesRoot: '/srv/notes-manager/data/notes',
            envFile: '/srv/notes-manager/.env',
            envFileLoaded: true,
          },
          env: { storageDriver: null, openlistUrl: null, openlistTokenSet: false, openlistRoot: null, notesRoot: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error('no server here');
  }) as typeof fetch;

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(SettingsDialog));
  });
  await flush();
  // The kind is a choice, and the parameters follow it: what is on screen when
  // the dialog opens is whatever was saved, which here is a scene.
  let markup = host.innerHTML;
  check('the settings dialog offers the kinds', ['不设置', '主题极光', '图片', '视频', '场景壁纸'].every((label) => markup.includes(label)), true);
  check('and the files that can be chosen', markup.includes('rossi.pkg'), true);
  // The shared size formatter rounds a file this large to whole megabytes, which
  // is all a file list needs to say.
  check('with their size', markup.includes('43 MB'), true);
  check('and the darkness and framing controls', markup.includes('模糊') && markup.includes('暗度') && markup.includes('取景区'), true);
  check('a scene can be played or composited', markup.includes('在 worker 里实时播放'), true);
  check('the files it cannot use are not offered', markup.includes('still.png'), false);
  check('and it says where to put them', markup.includes('backgrounds'), true);
  check('with a note field', markup.includes('备注'), true);

  // Switching to the theme's own background swaps the file list for colours.
  const aurora = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '主题极光');
  await act(async () => {
    aurora?.click();
  });
  markup = host.innerHTML;
  check('the theme background offers its two colours', markup.includes('极光主色') && markup.includes('极光辅色'), true);
  check('and needs no file', markup.includes('rossi.pkg'), false);
  check('and no crop editor either', markup.includes('拖动方框移动'), false);

  // Video is its own kind, with its own files.
  const video = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '视频');
  await act(async () => {
    video?.click();
  });
  markup = host.innerHTML;
  check('a video kind lists videos', markup.includes('loop.mp4'), true);
  check('and not the scenes', markup.includes('rossi.pkg'), false);
  // A picture the browser can show is its own preview, so the crop editor is
  // there to frame it - a scene has to be composited first, which jsdom cannot do.
  check('and a video can be framed', markup.includes('拖动方框移动'), true);

  // The custom background is a picture the administrator uploads, shrunk in the
  // browser first, plus the same motion and particle controls the personal one
  // has - one list of sliders, drawn by both dialogs.
  check('a custom background is on offer', markup.includes('自定义壁纸'), true);
  const customKind = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '自定义壁纸');
  await act(async () => {
    customKind?.click();
  });
  markup = host.innerHTML;
  check('choosing it offers an upload', markup.includes('导入图片或场景包（缩图后上传）'), true);
  const adminPicker = host.querySelector<HTMLInputElement>('[data-background-import]');
  check('with a file picker behind the button', Boolean(adminPicker), true);
  check('which takes scene packages too', (adminPicker?.getAttribute('accept') ?? '').includes('.pkg'), true);
  // The preview panel was removed: the crop editor is the picture everyone sees,
  // and the wallpaper itself is on the page behind the dialog.
  check('there is no preview panel any more', Boolean(host.querySelector('[data-admin-custom-preview]')), false);
  check('the crop editor is what shows the picture', Boolean(host.querySelector('[data-crop-section]')), true);
  const { CUSTOM_EFFECT_SLIDERS } = await import('./src/lib/wallpaper');
  check(
    'and the shared sliders',
    Array.from(host.querySelectorAll('[data-custom-controls] input[type="range"]')).map((slider) =>
      slider.getAttribute('aria-label'),
    ),
    CUSTOM_EFFECT_SLIDERS.map((control: { label: string }) => control.label),
  );
  check('with the two switches beside them', host.querySelectorAll('[data-custom-controls] [role="switch"]').length, 2);
  check(
    'saying where a hand dropped file goes as well',
    markup.includes('也可以把图片放进 backgrounds/'),
    true,
  );

  await act(async () => {
    root.unmount();
  });
  host.remove();
  globalThis.fetch = realFetch;
  appStore.setState(hold);
}

/* --- deleting a background file ------------------------------------------- */
console.log('\ndeleting a background file (jsdom)');
{
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;
  const jsonResponse = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const admin = {
    configured: true,
    kind: 'image' as const,
    file: 'still.png',
    bytes: 1024,
    hash: 'abc123',
    url: '/api/background/file?name=still.png',
    note: null,
    options: { crop: { x: 0, y: 0, w: 1, h: 1 }, blur: 0, dim: 0.35, dynamic: false, auroraA: '', auroraB: '' },
    available: [
      { name: 'still.png', kind: 'image' as const, bytes: 1024 },
      { name: 'other.png', kind: 'image' as const, bytes: 2048 },
    ],
  };
  let available = admin.available.slice();
  const settings = {
    storage: {
      driver: 'local',
      openlist: { url: '', token: '', root: '/notes', perUser: false, timeoutMs: 15000 },
      local: { root: '' },
    },
    background: {
      kind: 'image',
      file: 'still.png',
      note: '',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      blur: 0,
      dim: 0.35,
      dynamic: false,
      auroraA: '',
      auroraB: '',
    },
    guest: { enabled: true },
    blog: { enabled: false },
  };
  const requests: Array<{ method: string; url: string; body?: string }> = [];
  let pendingDelete = false;
  let releaseDelete: (() => void) | null = null;
  let deleteResponse: unknown = null;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ method, url, body: typeof init.body === 'string' ? init.body : undefined });
    if (url.includes('/api/system/settings') && method === 'GET') {
      return jsonResponse({ settings, effective: { ...settings }, paths: {}, env: {} });
    }
    if (url.includes('/api/system/settings') && method === 'PUT') {
      return jsonResponse({ settings, effective: { ...settings }, status: {} });
    }
    if (url.endsWith('/api/background') && method === 'GET') return jsonResponse({ ...admin, available });
    if (url.includes('/api/background?') && method === 'DELETE') {
      if (pendingDelete) {
        await new Promise<void>((resolve) => {
          releaseDelete = resolve;
        });
      }
      return jsonResponse(deleteResponse);
    }
    return jsonResponse({});
  }) as typeof fetch;
  appStore.setState({ settingsOpen: true, adminBackground: admin, toasts: [] } as never);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const deleteCalls = () => requests.filter((request) => request.method === 'DELETE');
  const toasts = () => (appStore.getState() as unknown as { toasts: Array<{ title: string }> }).toasts.map((toast) => toast.title);
  const button = (selector: string) => host.querySelector<HTMLButtonElement>(selector);
  try {
    await act(async () => {
      root.render(React.createElement(SettingsDialog));
    });
    await flush();
    check('the background files are rows', host.querySelectorAll('[data-testid="background-file-row"]').length, 2);
    check(
      'each row has a delete button of its own',
      button('[data-testid="background-delete-other.png"]')?.getAttribute('aria-label'),
      '删除背景文件 other.png',
    );
    // First click only arms: no request, and it says what the next click does.
    await act(async () => {
      button('[data-testid="background-delete-other.png"]')?.click();
    });
    await flush();
    check('the first click sends nothing', deleteCalls().length, 0);
    check('and turns the bin into a confirmation', Boolean(button('[data-testid="background-delete-confirm-other.png"]')), true);
    check('which says what it will do', button('[data-testid="background-delete-confirm-other.png"]')?.textContent?.includes('确认删除？'), true);
    // Four seconds without a second click puts the bin back.
    await settled(4200);
    check('left alone it goes back to the bin', [Boolean(button('[data-testid="background-delete-confirm-other.png"]')), Boolean(button('[data-testid="background-delete-other.png"]'))], [false, true]);
    check('still without sending anything', deleteCalls().length, 0);

    // The real delete: disabled while it runs, one request, row goes away.
    await act(async () => {
      button('[data-testid="background-delete-other.png"]')?.click();
    });
    await flush();
    pendingDelete = true;
    deleteResponse = { removed: 'other.png', available: [{ name: 'still.png', kind: 'image', bytes: 1024 }], configured: true, kind: 'image', reset: false };
    await act(async () => {
      button('[data-testid="background-delete-confirm-other.png"]')?.click();
    });
    await flush();
    check('the confirmation is disabled while it runs', button('[data-testid="background-delete-confirm-other.png"]')?.disabled, true);
    check('and says it is deleting', button('[data-testid="background-delete-confirm-other.png"]')?.textContent?.includes('删除中…'), true);
    available = [{ name: 'still.png', kind: 'image', bytes: 1024 }];
    pendingDelete = false;
    await act(async () => {
      releaseDelete?.();
    });
    await flush();
    check('one request is sent, for the right file', [deleteCalls().length, deleteCalls()[0]?.url.includes('name=other.png')], [1, true]);
    check('the row is gone', host.querySelectorAll('[data-testid="background-file-row"]').length, 1);
    check('and a toast says it was deleted', toasts().includes('背景文件已删除'), true);

    // Deleting the file in use: the server resets, the form follows to off.
    await act(async () => {
      button('[data-testid="background-delete-still.png"]')?.click();
    });
    await flush();
    deleteResponse = { removed: 'still.png', available: [], configured: false, kind: null, reset: true };
    await act(async () => {
      button('[data-testid="background-delete-confirm-still.png"]')?.click();
    });
    await flush();
    check('a reset is said out loud', toasts().includes('正在使用的背景已切换为关闭'), true);
    // The save must not write the deleted file back.
    const save = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim().includes('保存设置'));
    await act(async () => {
      save?.click();
    });
    await flush();
    const saved = requests.filter((request) => request.method === 'PUT').pop();
    const savedBackground = saved ? (JSON.parse(saved.body ?? '{}') as { background?: { kind?: string; file?: string } }).background : undefined;
    check('the form saves nothing, not the deleted file', [savedBackground?.kind, savedBackground?.file], ['off', '']);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    globalThis.fetch = realFetch;
    appStore.setState(hold);
  }
}

/* --- browsing without an account ------------------------------------------- */
console.log('\nguest browsing (jsdom)');
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
  try {
    // No OpenList: the notes are this server's own, and the visitor is a local
    // one. The sign-in screen has to offer it and say what it can do.
    appStore.setState({
      providers: {
        local: true,
        openlist: false,
        openlistConfigured: false,
        openlistUrl: null,
        openlistInitialized: false,
        guest: true,
      },
    });
    const login = await renderOnce(React.createElement(LoginScreen));
    check('a deployment without OpenList offers guest browsing', login.includes('以游客身份浏览（管理面板）'), true);
    check('and says it is read-only', login.includes('只读浏览本机的笔记目录'), true);
    check('and marks it in the status row', login.includes('游客可只读浏览（管理面板）'), true);

    appStore.setState({ providers: { ...appStore.getState().providers!, guest: false } });
    const closed = await renderOnce(React.createElement(LoginScreen));
    check('with guest access off there is no way in', closed.includes('以游客身份浏览'), false);

    // The switch that decides it lives in the server settings, and it is about
    // the panel alone: the blog reads as an OpenList guest either way.
    appStore.setState({ settingsOpen: true });
    const settings = await renderOnce(React.createElement(SettingsDialog));
    check('the settings dialog decides who may enter the panel', settings.includes('允许游客访问管理面板'), true);
    check(
      'spelling out both halves',
      settings.includes('游客可以只读浏览管理面板，也能看博客') &&
        settings.includes('仍可通过博客访问已发布的笔记与图片'),
      true,
    );
    check('and keeping the token out of the blog picture', settings.includes('令牌只服务管理面板'), true);
  } finally {
    appStore.setState(hold);
  }
}

/* --- the background is downloaded once ------------------------------------- */
console.log('\nbackground caching (jsdom)');
{
  const { backgroundFileUrl } = await import('./src/lib/api');

  // A URL at one version of the file: that is what the browser is allowed to
  // keep for a year, and what the app uses to key its own copies.
  check('a background URL names the file', backgroundFileUrl('rossi.pkg'), '/api/background/file?name=rossi.pkg');
  check('and carries the hash when there is one', backgroundFileUrl('rossi.pkg', 'abc123'), '/api/background/file?name=rossi.pkg&v=abc123');
  check('a name with a space survives', backgroundFileUrl('my scene.pkg'), '/api/background/file?name=my+scene.pkg');
  check('with no name it is whatever is configured', backgroundFileUrl(null), '/api/background/file');

  // The store builds the layer's URL from the payload, hash included.
  {
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          configured: true,
          kind: 'scene',
          file: 'rossi.pkg',
          bytes: 45_562_692,
          hash: 'deadbeef',
          note: null,
          options: { crop: { x: 0, y: 0, w: 1, h: 1 }, blur: 0, dim: 0.35, dynamic: false, auroraA: '', auroraB: '' },
          available: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;
    try {
      await appStore.getState().refreshAdminBackground();
      const admin = appStore.getState().adminBackground;
      check('the layer is given the versioned URL', admin?.url, '/api/background/file?name=rossi.pkg&v=deadbeef');
      check('and the hash to key its own copy on', admin?.hash, 'deadbeef');
    } finally {
      globalThis.fetch = realFetch;
      appStore.setState({ adminBackground: hold.adminBackground });
    }
  }
}
/* --- the wallpaper says what it is doing ----------------------------------- */
console.log('\nwallpaper loading (jsdom)');
{
  const { readWithProgress } = await import('./src/lib/download');
  const { WallpaperLoading } = await import('./src/components/WallpaperLoading');

  // A 45 MB container arrives in chunks, and the length header is what turns
  // that into a percentage; without it the count is all there is.
  const streaming = (parts: number[], length: number | null) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of parts) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    const headers = length === null ? undefined : { 'content-length': String(length) };
    return new Response(body, { status: 200, headers });
  };

  {
    const seen: string[] = [];
    const buffer = await readWithProgress(streaming([10, 20, 30], 60), (loaded: number, total: number | null) => {
      seen.push(`${loaded}/${total}`);
    });
    check('every chunk is reported as it arrives', seen, ['10/60', '30/60', '60/60']);
    check('and the bytes add up', buffer.byteLength, 60);
  }

  {
    const seen: Array<number | null> = [];
    await readWithProgress(streaming([5, 5], null), (_loaded: number, total: number | null) => seen.push(total));
    check('without a length there is no percentage to show', seen, [null, null]);
  }

  {
    const seen: string[] = [];
    await readWithProgress(new Response(new Uint8Array(8)), (loaded: number, total: number | null) => seen.push(`${loaded}/${total}`));
    check('a body with no stream still reports once', seen, ['8/null']);
  }

  // The badge waits a moment before appearing: a wallpaper out of the browser
  // cache would otherwise flash it on every page load.
  {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = async () => {
      await act(async () => {
        root.render(React.createElement(WallpaperLoading));
      });
      await flush();
    };

    await act(async () => {
      appStore.setState({ wallpaperLoading: null });
    });
    await render();
    check('nothing is shown when nothing is loading', host.innerHTML, '');

    await act(async () => {
      appStore.setState({ wallpaperLoading: { label: '正在下载背景…', ratio: 0.45, rate: 1_900_000 } });
    });
    await render();
    check('and nothing the moment a load starts', host.innerHTML, '');

    // Progress arrives many times a second, and each one is a new object: the
    // badge has to appear anyway, which it did not when the delay restarted
    // with every update.
    await act(async () => {
      for (const ratio of [0.05, 0.2, 0.35, 0.45]) {
        appStore.setState({ wallpaperLoading: { label: '正在下载背景…', ratio, rate: 1_900_000 } });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    check('a slow load ends up saying what it is doing', host.innerHTML.includes('正在下载背景…'), true);
    check('with the percentage it has', host.innerHTML.includes('45%'), true);
    check('and a bar that is a bar', host.innerHTML.includes('width: 45%'), true);
    check('with the rate, which is what says whether the line or the parsing is slow', host.innerHTML.includes('1.8 MB/s'), true);
    check('it sits across the top of the screen', host.innerHTML.includes('inset-x-0 top-4'), true);

    // The phases that cannot be measured say so with a moving bar rather than
    // a number nobody has.
    await act(async () => {
      appStore.setState({ wallpaperLoading: { label: '正在合成背景…', ratio: null, rate: null } });
    });
    await render();
    check('a phase without a number shows the walking bar', host.innerHTML.includes('progress-unknown'), true);
    // The class list has percentages of its own (colour-mix stops), so this
    // looks for the number's own class rather than a digit followed by a sign.
    check('and no percentage', host.innerHTML.includes('tabular-nums'), false);

    await act(async () => {
      appStore.setState({ wallpaperLoading: null });
    });
    await render();
    check('and it goes away when the wallpaper arrives', host.innerHTML, '');

    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
}

/* --- the custom wallpaper (jsdom) ----------------------------------------- */
console.log('\nthe custom wallpaper (jsdom)');
{
  const {
    CUSTOM_EFFECT_COLOR,
    CUSTOM_EFFECT_DEFAULTS,
    CUSTOM_EFFECT_SLIDERS,
    CUSTOM_EFFECT_TOGGLES,
    CUSTOM_IMAGE_MAX_EDGE,
    CUSTOM_IMAGE_QUALITY,
    CUSTOM_PARTICLE_DENSITY,
    DEFAULT_WALLPAPER,
    LEGACY_CUSTOM_KEYS,
    customSwayCurve,
    normaliseParticleColor,
    parseParticleColor,
    particleBrightnessJitter,
    particleEmissionForDensity,
    particleVisibilityModel,
    resolveCustomEffect,
    resolveParticleColorValue,
    sceneUnitScale,
    shrinkDimensions,
    shrinkWallpaperImage,
  } = await import('./src/lib/wallpaper');
  // The vendored scene renderer, for the check that the wallpaper's own drift is
  // the library's drift - not a lookalike written from the same description.
  const { ParticleSystem, parseParticleDefinition } = await import(
    './src/lib/wallpaper-scene-layers/packages/we-scene/src/render/particles'
  );
  const { createCustomParticles, advanceCustomParticles, customSwayKeyframes, particleLifeRatio, particleAppearance } =
    await import('./src/components/CustomWallpaper');
  const { shownWallpaper } = await import('./src/lib/admin-background');

  /* --- one picture, one set of numbers ------------------------------------ */
  // An imported picture is resized before it is stored: the long edge fits 2560
  // and the copy is WebP. A phone photo is the case this exists for.
  check('a big picture is scaled down', shrinkDimensions(6000, 4000), { width: 2560, height: 1707 });
  check('a small one is left alone', shrinkDimensions(1600, 1067), { width: 1600, height: 1067 });
  check('the long edge is the constraint', shrinkDimensions(1000, 5000), { width: 512, height: 2560 });
  check('the edge can be asked for', shrinkDimensions(6000, 4000, 1000), { width: 1000, height: 667 });
  check('an empty picture still has a pixel', shrinkDimensions(0, 0), { width: 1, height: 1 });
  check('the limits are the ones the dialog says', [CUSTOM_IMAGE_MAX_EDGE, CUSTOM_IMAGE_QUALITY], [2560, 0.82]);

  // jsdom has no canvas to re-encode with, so the original is passed through: a
  // wallpaper that cannot be shrunk is better than one that vanished. The size
  // numbers still describe what happened honestly.
  {
    // The component reads the name off a File; this harness has only the jsdom
    // one, so it is lent to the module scope for this check.
    const globals = globalThis as unknown as { File?: unknown };
    const previousFile = globals.File;
    globals.File = w.File;
    try {
      const file = new w.File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
      const shrunk = await shrinkWallpaperImage(file);
      check('a picture that cannot be decoded is kept as it is', [shrunk.shrunk, shrunk.blob === file], [false, true]);
      check('with its sizes said as they are', [shrunk.before, shrunk.after], [4, 4]);
      check('and a name for the bytes it kept', shrunk.fileName, 'photo.png');
    } finally {
      globals.File = previousFile;
    }
  }

  // Missing fields, and numbers from a hand-edited settings file, are answered
  // in exactly one place: the seven controls the UI shows.
  {
    check('an empty custom effect gets the defaults', resolveCustomEffect({}), {
      sway: CUSTOM_EFFECT_DEFAULTS.sway,
      amplitude: CUSTOM_EFFECT_DEFAULTS.amplitude,
      frequency: CUSTOM_EFFECT_DEFAULTS.frequency,
      particles: CUSTOM_EFFECT_DEFAULTS.particles,
      rise: CUSTOM_EFFECT_DEFAULTS.rise,
      drift: CUSTOM_EFFECT_DEFAULTS.drift,
      direction: CUSTOM_EFFECT_DEFAULTS.direction,
      density: CUSTOM_EFFECT_DEFAULTS.density,
      color: CUSTOM_EFFECT_DEFAULTS.color,
    });
    const wild = resolveCustomEffect({
      customSwayAmplitude: 99,
      customSwayFrequency: 0,
      customParticleRise: 9999,
      customParticleDrift: -1,
      customParticleDirection: 9,
    });
    check(
      'out-of-range numbers are clamped',
      [wild.amplitude, wild.frequency, wild.rise, wild.drift, wild.direction],
      [8, 0.02, 1000, 0, 1],
    );
    // The two speed sliders now go to 1000 each.
    check(
      'the speed sliders reach 1000',
      CUSTOM_EFFECT_SLIDERS.filter(
        (control: { key: string }) => control.key === 'customParticleRise' || control.key === 'customParticleDrift',
      ).map((control: { max: number }) => control.max),
      [1000, 1000],
    );
    // A switch has one job: false means off, however the number is set.
    const off = resolveCustomEffect({ customSway: false, customShowParticles: false });
    check('the switches are read as switches', [off.sway, off.particles], [false, false]);
    check('and an old settings file switches both on', [resolveCustomEffect({}).sway, resolveCustomEffect({}).particles], [true, true]);
    // Scene units become pixels through the library's 3840x2160 cover fit.
    check('a scene unit is a pixel at the library viewport', sceneUnitScale(3840, 2160), 1);
    check('and scales with the viewport', Number(sceneUnitScale(1920, 1080).toFixed(3)), 0.5);
    check('cover fit takes the larger axis', Number(sceneUnitScale(3840, 4320).toFixed(2)), 2);
  }

  // The sway is the library's oscillateposition curve: sin on x, cos on y, and
  // one period sampled into keyframes the compositor can run.
  {
    check('the sway starts at the bottom of its circle', customSwayCurve(0.1, 0), { x: 0, y: 1 });
    const quarter = customSwayCurve(0.1, 2.5);
    check('a quarter cycle later it is full right', [Number(quarter.x.toFixed(3)), Number(quarter.y.toFixed(3))], [1, 0]);
    const effect = resolveCustomEffect({ customSwayAmplitude: 2.5, customSwayFrequency: 0.1 });
    const frame = customSwayKeyframes(effect, { width: 1000, height: 800 });
    check('one full cycle is sampled', [frame.x.length, frame.x[0], frame.x[frame.x.length - 1]], [25, 0, 0]);
    // 2.5% of the short edge is 20 pixels: that is the peak of each axis.
    check(
      'the amplitude is a share of the short edge',
      [Math.max(...frame.x.map(Math.abs)), Math.max(...frame.y.map(Math.abs))],
      [20, 20],
    );
    check('the picture is scaled up to cover the swing', Number(frame.scale.toFixed(2)), 1.06);
  }

/* --- the two particle controls added in 1.7 ------------------------------ */
  // Density is a slot count; the emitter's rate follows the production lifetime.
  {
    // Density is the number on screen, so the pool is density / visible fraction
    // and the rate refills slots as they die or leave through the top.
    const field300 = particleEmissionForDensity(300);
    check(
      'the default pool is bigger than the density (slots wait off screen)',
      [field300.maxCount > 300, field300.visibleFraction > 0.5 && field300.visibleFraction < 1],
      [true, true],
    );
    check('the pool rounds to the production 404', Math.abs(field300.maxCount - 404) <= 3, true);
    check('with a rate that refills it', Math.abs(field300.rate - 38.617) <= 0.5, true);
    const fast = particleEmissionForDensity(300, 1000);
    // A fast field lives in shorter slots (it leaves through the top), so a
    // larger share of each slot is spent on screen and the pool can be smaller.
    check('a fast field spends a larger share of its slot on screen', fast.visibleFraction > field300.visibleFraction, true);
    check('and it needs a faster refill', fast.rate > field300.rate * 2, true);
    check('the fast pool is the measured 346', Math.abs(fast.maxCount - 346) <= 3, true);
    check('and its rate the measured 96.87', Math.abs(fast.rate - 96.87) <= 1, true);
    check(
      'density 0 is no particles at all',
      [particleEmissionForDensity(0).maxCount, particleEmissionForDensity(0).rate],
      [1, 0],
    );
    check('600 asks for twice the pool of 300', Math.abs(particleEmissionForDensity(600).maxCount - field300.maxCount * 2) <= 3, true);
    check('and a wild number is clamped to the ceiling', particleEmissionForDensity(9999).density, 600);
    const model = particleVisibilityModel(240, 200, 0.7);
    check('the model is deterministic', particleVisibilityModel(240, 200, 0.7), model);
    check('a still field never reaches the screen', particleVisibilityModel(0, 200, 0.7).visibleFraction, 0);
    check('a shorter scene is left sooner', particleVisibilityModel(240, 200, 0.7, 1920, 1080).slotSeconds < model.slotSeconds, true);
    check('emission reports the model it used', [field300.visibleSeconds, field300.visibleFraction], [model.slotSeconds, model.visibleFraction]);
    check('and the rate is the pool over the slot time', Math.abs(field300.rate - field300.maxCount / field300.visibleSeconds) <= 0.01, true);
    const none = particleEmissionForDensity(-5);
    check('negative density is the off state', [none.density, none.maxCount, none.rate], [0, 1, 0]);
    check('the slider range is the one the model uses', [CUSTOM_PARTICLE_DENSITY.min, CUSTOM_PARTICLE_DENSITY.max, CUSTOM_PARTICLE_DENSITY.default], [0, 600, 300]);
  }

  // The base colour: a #rrggbb, or empty for "follow the theme accent".
  {
    check('a hex colour is normalised', [normaliseParticleColor('#FF4040'), normaliseParticleColor('#f00'), normaliseParticleColor(' #0A0B0C ')], ['#ff4040', '#ff0000', '#0a0b0c']);
    check('anything else is "not a colour"', [normaliseParticleColor('red'), normaliseParticleColor(null), normaliseParticleColor(42)], ['', '', '']);
    const orange = parseParticleColor('#ff8000') as number[];
    check('a colour parses to channels', [orange[0], Number(orange[1].toFixed(3)), orange[2]], [1, 0.502, 0]);
    check('and a non-colour does not', parseParticleColor('red'), null);
    check('a picked colour wins over the theme', resolveParticleColorValue('#ff0000', '#00ff00'), [1, 0, 0]);
    check('empty follows the theme accent', resolveParticleColorValue('', '#00ff00'), [0, 1, 0]);
    check('and a broken accent falls back to the theme default', resolveParticleColorValue(null, 'not-a-colour').map((channel) => channel.toFixed(3)), parseParticleColor(CUSTOM_EFFECT_COLOR.fallback)?.map((channel) => channel.toFixed(3)));
    check('the label both dialogs use', CUSTOM_EFFECT_COLOR, { key: 'customParticleColor', label: '粒子基色', followLabel: '跟随主题强调色', fallback: '#6d4cff' });
    // ±18% brightness per particle, a deterministic function of the random draw.
    check('brightness varies by ±18%', [particleBrightnessJitter(0), particleBrightnessJitter(0.5), particleBrightnessJitter(1)], [0.82, 1, 1.18]);
    check('out-of-range draws stay inside it', [particleBrightnessJitter(-1), particleBrightnessJitter(2)], [0.82, 1.18]);
    check('the old keys list no longer drops the colour', LEGACY_CUSTOM_KEYS.includes('customParticleColor' as never), false);
  }

  // resolveCustomEffect fills and clamps the new pair.
  {
    const clamped = resolveCustomEffect({ customParticleDensity: 9999, customParticleColor: '#FF4040' });
    check('a wild density is clamped and rounded', resolveCustomEffect({ customParticleDensity: 9999 }).density, 600);
    check('and a fractional one is rounded', resolveCustomEffect({ customParticleDensity: 12.4 }).density, 12);
    check('the colour is normalised', clamped.color, '#ff4040');
    check('and a non-colour becomes "follow the theme"', resolveCustomEffect({ customParticleColor: 'red' }).color, '');
    check('an older settings object gets the two defaults', resolveCustomEffect({ customSway: true }).density === 300 && resolveCustomEffect({ customSway: true }).color === '', true);
  }
  // One list of sliders and one of switches, drawn by both dialogs.
  check('six sliders shape the effect', CUSTOM_EFFECT_SLIDERS.map((control: { key: string }) => control.key), [
    'customSwayAmplitude',
    'customSwayFrequency',
    'customParticleRise',
    'customParticleDrift',
    'customParticleDirection',
    'customParticleDensity',
  ]);
  check(
    'each named in the user\'s words',
    CUSTOM_EFFECT_SLIDERS.map((control: { label: string }) => control.label),
    ['背景晃动幅度', '背景晃动频率', '粒子上升速度', '粒子漂移速度', '粒子方向比例', '粒子密度'],
  );
  check('and two switches turn the halves on or off', CUSTOM_EFFECT_TOGGLES.map((toggle: { key: string; label: string }) => [toggle.key, toggle.label]), [
    ['customSway', '背景晃动'],
    ['customShowParticles', '显示粒子'],
  ]);
  // How each number reads: drift is a maximum, direction is a rightward share.
  check(
    "the numbers' own words",
    CUSTOM_EFFECT_SLIDERS.map((control: { key: string; format: (value: number) => string }) => {
      if (control.key === 'customParticleDrift') return control.format(200);
      if (control.key === 'customParticleDirection') return control.format(0.7);
      if (control.key === 'customParticleRise') return control.format(240);
      if (control.key === 'customParticleDensity') return control.format(300);
      return null;
    }),
    [null, null, '240 单位/秒', '最大 200 单位/秒', '向右 70%', '300 颗'],
  );

  /* --- the particles, with a seeded random --------------------------------- */
  // LEGACY: the 1.5.x renderer is kept as a compatibility export for old
  // fixtures; the wallpaper itself now draws through the library (next block).
  // The simulation is pure with `random` injected: same seed, same picture.
  {
    const config = {
      count: 3,
      size: 2,
      opacity: 0.5,
      life: 4,
      speed: 200,
      rise: 240,
      direction: 0.7,
      spread: 0.6,
      turbulence: 0.15,
      color: '',
      wind: 0,
    };
    const fixed = () => 0.5;
    const particles = createCustomParticles(3, config, 800, 600, fixed);
    check('the count asked for is the count made', particles.length, 3);
    check('a fixed random puts them at known places', particles.map((particle: { x: number; y: number }) => [particle.x, particle.y]), [
      [400, 300],
      [400, 300],
      [400, 300],
    ]);
    check(
      'their life, size and alpha follow the settings',
      [particles[0].lifeMax, particles[0].size, particles[0].alpha],
      [4, 2 * (0.55 + Math.pow(0.5, 2) * 1.7), 0.5 * 0.75],
    );
    check('and they start part way through a life', particles[0].age, 4 * 0.5 * 0.9);
    // Upward is negative on a canvas: rise lifts every particle, and a forward
    // share adds its own speed on top (mid-random means no angle jitter).
    check('the rise lifts every particle', Number(particles[0].vy.toFixed(3)), -440);
    check('and a mid-random particle keeps to the main direction', Number(particles[0].vx.toFixed(3)), 0);
    const before = particles.map((particle: { x: number; y: number }) => particle.x + ',' + particle.y);
    advanceCustomParticles(particles, 0.1, 0, config, 800, 600, fixed);
    const after = particles.map((particle: { x: number; y: number }) => particle.x + ',' + particle.y);
    check('advancing moves them', after.some((place: string, index: number) => place !== before[index]), true);
    check(
      'and ages them by the step',
      particles.map((particle: { age: number }) => Number(particle.age.toFixed(4))),
      // The step is capped at a twentieth of a second, so a tenth advances by
      // half of it - the same cap that keeps a sleeping tab from jumping.
      particles.map(() => Number((4 * 0.5 * 0.9 + 1 / 20).toFixed(4))),
    );
  }

  /* --- and the drift is the library's drift, not a lookalike --------------- */
  {
    // The same numbers on both sides, in the same units: scene units per second
    // (one unit is one pixel at the library's 3840x2160 viewport). The library
    // runs its own ParticleSystem; ours runs createCustomParticles().
    const RISE = 240;
    const SPEED = 200;
    const DIRECTION = 0.7;
    const SPREAD = 0.6;
    const summarise = (vx: number[], up: number[]) => {
      const count = vx.length;
      const meanUp = up.reduce((sum, value) => sum + value, 0) / count;
      const forward = up.filter((value) => value > RISE).length / count;
      const meanX = vx.reduce((sum, value) => sum + value, 0) / count;
      const stdX = Math.sqrt(vx.reduce((sum, value) => sum + (value - meanX) * (value - meanX), 0) / count);
      return { count, meanUp, forward, stdX };
    };

    // Both sides draw random numbers, and a comparison of two means is only a
    // test if both draws are seeded: unseeded, the difference moves by a few
    // units from run to run, which is a flaky assertion, not a regression.
    // A small deterministic PRNG, then both sides read from their own stream.
    const mulberry32 = (seed: number) => {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    };

    // Ours takes its random source as an argument.
    const ours = createCustomParticles(600, {
      count: 600,
      size: 2,
      opacity: 0.5,
      life: 4,
      speed: SPEED,
      rise: RISE,
      direction: DIRECTION,
      spread: SPREAD,
      turbulence: 0.15,
      color: '',
      wind: 0,
    }, 3840, 2160, mulberry32(1));
    const ourStats = summarise(
      ours.map((particle: { vx: number }) => particle.vx),
      ours.map((particle: { vy: number }) => -particle.vy),
    );

    // The library reads Math.random directly: it gets a stream of its own for
    // the length of its run, and the real one is put back either way.
    const runLibrary = () => {
      const realRandom = Math.random;
      try {
        Math.random = mulberry32(2);
        const system = new ParticleSystem(
          parseParticleDefinition({
            maxcount: 400,
            starttime: 0,
            emitter: [{ name: 'boxrandom', rate: 400, distancemax: '800 600 0' }],
            initializer: [
              { name: 'lifetimerandom', min: 8, max: 9 },
              { name: 'sizerandom', min: 1, max: 2 },
            ],
            operator: [],
            material: {},
          }),
          undefined,
          { drift: { rise: RISE, speed: SPEED, forwardRatio: DIRECTION, spread: SPREAD } },
        );
        // Long enough to fill every slot, short enough that none has died.
        for (let step = 0; step < 40; step += 1) system.update(1 / 30);
        const alive = system.slots.filter((slot: { alive: boolean }) => slot.alive);
        return summarise(
          alive.map((slot: { velocity: number[] }) => slot.velocity[0]),
          alive.map((slot: { velocity: number[] }) => slot.velocity[1]),
        );
      } finally {
        Math.random = realRandom;
      }
    };
    const libraryStats = runLibrary();

    check('the library reference has a full field of particles', libraryStats.count > 100, true);
    // Seeded on both sides, so these are the same numbers on every run. Both
    // sides are pinned to the measured values (a change in either model moves
    // them), and the two are compared with a fixed structural tolerance: the
    // remaining difference is the models' own shape (our vertical velocity is
    // cosine-jittered, the library's is not), not sampling noise.
    check('our mean upward speed is the seeded one', Math.abs(ourStats.meanUp - 323.33) <= 3, true);
    check('and the library\'s is its own', Math.abs(libraryStats.meanUp - 315) <= 3, true);
    check('the two mean upward speeds agree', Math.abs(ourStats.meanUp - libraryStats.meanUp) <= 12, true);
    check('our share drifting the main way is the seeded one', Math.abs(ourStats.forward - 0.725) <= 0.02, true);
    check('and the library\'s is its own', Math.abs(libraryStats.forward - 0.6875) <= 0.02, true);
    check('the two shares agree', Math.abs(ourStats.forward - libraryStats.forward) <= 0.06, true);
    check('our sideways spread is the seeded one', Math.abs(ourStats.stdX - 74.72) <= 3, true);
    check('and the library\'s is its own', Math.abs(libraryStats.stdX - 67.27) <= 3, true);
    check('the two spreads agree', Math.abs(ourStats.stdX - libraryStats.stdX) <= 12, true);
  }
  // The fade in and out are the engine's alphafade and sizechange, combined.
  {
    const life = (age: number) => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 10,
      alpha: 0.5,
      lifeMax: 4,
      age,
      seed: 0,
      turbulence: 0,
      phase: 0,
    });
    check('a newborn particle is not visible yet', particleAppearance(life(0)).alpha, 0);
    check('half way through it is at its brightest', particleAppearance(life(2)).alpha, 0.5);
    check('and at its full size', particleAppearance(life(2)).size, 10);
    check(
      'after the middle it shrinks',
      Number(particleAppearance(life(3.2)).size.toFixed(3)),
      Number((10 * (1 - ((0.8 - 0.5) / 0.5) * 0.8)).toFixed(3)),
    );
    check('and fades out towards the end', particleAppearance(life(3.2)).alpha.toFixed(3), (0.5 * ((1 - 0.8) / 0.3)).toFixed(3));
    check(
      'a dead particle is invisible',
      [particleAppearance(life(4)).alpha, Number(particleAppearance(life(4)).size.toFixed(3))],
      [0, 2],
    );
    check('the life ratio runs from 0 to 1', [particleLifeRatio(life(0)), particleLifeRatio(life(4))], [0, 1]);
  }

  /* --- the layer ----------------------------------------------------------- */
  // jsdom has no 2D canvas: the picture and the CSS backdrop are what it can
  // draw, and the animation must simply not start.
  {
    const { Wallpaper } = await import('./src/components/Wallpaper');
    const hold = appStore.getState();
    const canvasProto = w.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const realGetContext = canvasProto.getContext;
    const realRaf = w.requestAnimationFrame;
    const realCancel = w.cancelAnimationFrame;
    let rafCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    canvasProto.getContext = () => null;
    // The component calls the global function, which this harness defines on
    // both scopes; the spy has to replace both.
    const globals = globalThis as unknown as {
      requestAnimationFrame?: typeof w.requestAnimationFrame;
      cancelAnimationFrame?: typeof w.cancelAnimationFrame;
    };
    const realGlobalRaf = globals.requestAnimationFrame;
    const rafSpy = ((callback: FrameRequestCallback) => {
      rafCalls += 1;
      return realRaf.call(w, callback);
    }) as typeof w.requestAnimationFrame;
    w.requestAnimationFrame = rafSpy;
    globals.requestAnimationFrame = rafSpy;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      appStore.setState({
        appearanceOpen: false,
        wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom', customDensity: 20 },
        wallpaperUrl: 'https://cdn.example.com/custom.webp',
      } as never);
      await act(async () => {
        root.render(React.createElement(Wallpaper));
      });
      await flush();
      check('the custom wallpaper is a layer of its own', Boolean(host.querySelector('[data-custom-wallpaper]')), true);
      check(
        'with the picture it was given',
        host.querySelector('[data-custom-image]')?.getAttribute('src'),
        'https://cdn.example.com/custom.webp',
      );
      check('and a canvas for the particles', Boolean(host.querySelector('[data-custom-particles]')), true);
      // The sway is written from the same loop as the particles and needs no 2D
      // context: without one the picture still moves.
      check('the sway starts without a canvas context', rafCalls > 0, true);
      const frame = () => host.querySelector<HTMLElement>('[data-custom-image-frame]');
      const firstFrame = frame()?.style.transform ?? '';
      await settled(60);
      check('and the frame is a transform away from where it started', (frame()?.style.transform ?? '') !== firstFrame, true);
      check('written on the frame, not on the picture', (frame()?.style.transform ?? '').includes('translate3d'), true);
      check(
        'so the picture is free to be cropped',
        (host.querySelector<HTMLElement>('[data-custom-image]')?.style.transform ?? ''),
        '',
      );

      // No picture: the placeholder is the wallpaper, and the sway keeps running
      // on the frame - an explicit effect switch is what turns it off.
      await act(async () => {
        appStore.setState({ wallpaperUrl: null } as never);
      });
      await flush();
      check('without a picture there is no image', Boolean(host.querySelector('[data-custom-image]')), false);
      check('and a placeholder says a picture is needed', Boolean(host.querySelector('[data-custom-placeholder]')), true);
      check(
        'drawn from the theme gradient',
        (host.querySelector('[data-custom-placeholder]')?.getAttribute('style') ?? '').includes('gradient'),
        true,
      );
      const beforeStall = rafCalls;
      await settled(60);
      check('the sway still runs over the placeholder', rafCalls > beforeStall, true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      canvasProto.getContext = realGetContext;
      w.requestAnimationFrame = realRaf;
      w.cancelAnimationFrame = realCancel;
      globals.requestAnimationFrame = realGlobalRaf;
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

  // With a canvas the loop runs; reduced motion keeps it still; unmounting stops
  // it. The frame callbacks are counted rather than run.
  {
    const { Wallpaper } = await import('./src/components/Wallpaper');
    const hold = appStore.getState();
    const canvasProto = w.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
    const realGetContext = canvasProto.getContext;
    const realRaf = w.requestAnimationFrame;
    const realCancel = w.cancelAnimationFrame;
    // The component calls the global functions, which this harness defines on
    // both scopes; a spy has to replace both.
    const globals = globalThis as unknown as {
      requestAnimationFrame?: typeof w.requestAnimationFrame;
      cancelAnimationFrame?: typeof w.cancelAnimationFrame;
    };
    const realGlobalRaf = globals.requestAnimationFrame;
    const realGlobalCancel = globals.cancelAnimationFrame;
    const realMatchMedia = w.matchMedia;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    canvasProto.getContext = () => ({
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      setTransform() {},
      fillRect() {},
      clearRect() {},
      createRadialGradient: () => ({ addColorStop() {} }),
      putImageData() {},
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      // The library's vertex writer draws each quad with save/translate/rotate.
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      beginPath() {},
      arc() {},
      fill() {},
    });
    let scheduled = 0;
    let cancelled = 0;
    const rafSpy = (() => {
      scheduled += 1;
      return scheduled;
    }) as unknown as typeof w.requestAnimationFrame;
    const cancelSpy = (() => {
      cancelled += 1;
    }) as unknown as typeof w.cancelAnimationFrame;
    w.requestAnimationFrame = rafSpy;
    w.cancelAnimationFrame = cancelSpy;
    globals.requestAnimationFrame = rafSpy;
    globals.cancelAnimationFrame = cancelSpy;
    const renderLayer = async (reducedMotion: boolean) => {
      w.matchMedia = ((query: string) => ({
        matches: reducedMotion && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      })) as unknown as typeof w.matchMedia;
      appStore.setState({
        appearanceOpen: false,
        wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom' },
        // A picture is what the sway and the particles move; without one there is
        // no canvas to animate.
        wallpaperUrl: 'https://cdn.example.com/custom.webp',
      } as never);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      await act(async () => {
        root.render(React.createElement(Wallpaper));
      });
      await flush();
      return { host, root };
    };
    try {
      // Reduced motion is a preference, not an order: the scene library keeps
      // animating too, and the two switches are the explicit control. So the
      // loop is still scheduled and both halves still move.
      const reduced = await renderLayer(true);
      check('reduced motion still animates the wallpaper', scheduled > 0, true);
      check(
        'and the picture is transformed as it goes',
        (reduced.host.querySelector<HTMLElement>('[data-custom-image-frame]')?.style.transform ?? '').includes('translate3d'),
        true,
      );
      // The density says "on screen", and the canvas says how many there are now.
      const particleCanvas = reduced.host.querySelector<HTMLElement>('[data-custom-particles-canvas]');
      const visibleNow = Number(particleCanvas?.getAttribute('data-visible-particles') ?? '-1');
      check('the canvas reports the visible particle count', [Boolean(particleCanvas), Number.isFinite(visibleNow), visibleNow > 0], [true, true, true]);
      await act(async () => {
        reduced.root.unmount();
      });
      reduced.host.remove();

      const beforeMoving = scheduled;
      const moving = await renderLayer(false);
      check('and so does it without the preference', scheduled > beforeMoving, true);
      const stopsBefore = cancelled;
      await act(async () => {
        moving.root.unmount();
      });
      moving.host.remove();
      check('and going away stops the loop', cancelled > stopsBefore, true);
    } finally {
      canvasProto.getContext = realGetContext;
      w.requestAnimationFrame = realRaf;
      w.cancelAnimationFrame = realCancel;
      globals.requestAnimationFrame = realGlobalRaf;
      globals.cancelAnimationFrame = realGlobalCancel;
      w.matchMedia = realMatchMedia;
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

/* --- the crop rectangle is a window on the picture ------------------------ */
  {
    const { Wallpaper } = await import('./src/components/Wallpaper');
    const { cropMediaStyle } = await import('./src/lib/wallpaper');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      // A cropped picture is placed by its rectangle: width / height / offset,
      // which is the same helper the picture and video kinds use.
      const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.5 };
      appStore.setState({
        appearanceOpen: false,
        wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom', crop },
        wallpaperUrl: 'https://cdn.example.com/custom.webp',
      } as never);
      await act(async () => {
        root.render(React.createElement(Wallpaper));
      });
      await flush();
      const image = () => host.querySelector<HTMLElement>('[data-custom-image]');
      const expected = cropMediaStyle(crop) as unknown as Record<string, string>;
      check(
        'a cropped custom picture is placed by the crop rectangle',
        [image()?.style.width, image()?.style.height, image()?.style.left, image()?.style.top],
        [expected.width, expected.height, expected.left, expected.top],
      );
      check('and not object-cover, which would crop it again', (image()?.className ?? '').includes('object-cover'), false);

      // The full rectangle is the default: the picture covers the frame itself.
      appStore.setState({
        wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom', crop: { x: 0, y: 0, w: 1, h: 1 } },
      } as never);
      await flush();
      check('a full rectangle is object-cover', (image()?.className ?? '').includes('object-cover'), true);
      check('with no inline placement', image()?.style.width, '');
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

  /* --- density and colour on the layer itself ------------------------------ */
  {
    const { Wallpaper } = await import('./src/components/Wallpaper');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = async (wallpaper: Record<string, unknown>) => {
      appStore.setState({ appearanceOpen: false, wallpaperUrl: null, adminBackground: null, wallpaper } as never);
      await act(async () => {
        root.render(React.createElement(Wallpaper));
      });
      await flush();
    };
    const layer = () => host.querySelector<HTMLElement>('[data-custom-wallpaper]');
    try {
      await render({ ...DEFAULT_WALLPAPER, kind: 'custom' });
      check('the layer reports its density', layer()?.getAttribute('data-custom-particle-density'), '300');
      check('with no picked colour yet', layer()?.hasAttribute('data-custom-particle-color'), false);
      check('and particles on', layer()?.getAttribute('data-custom-particles'), 'true');
      await render({ ...DEFAULT_WALLPAPER, kind: 'custom', customParticleColor: '#FF4040' });
      check('a picked colour is reported normalised', layer()?.getAttribute('data-custom-particle-color'), '#ff4040');
      await render({ ...DEFAULT_WALLPAPER, kind: 'custom', customParticleDensity: 0 });
      check('density 0 is particles off', layer()?.getAttribute('data-custom-particles'), 'false');
      check('and no canvas is built', Boolean(host.querySelector('[data-custom-particles-canvas]')), false);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

/* --- and it is framed in the dialogs too --------------------------------- */
  {
    const { AppearanceDialog } = await import('./src/components/AppearanceDialog');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    appStore.setState({
      appearanceOpen: true,
      adminBackground: null,
      wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom' },
      wallpaperUrl: null,
    } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(React.createElement(AppearanceDialog));
      });
      await flush();
      const section = () => host.querySelector('[data-crop-section]');
      check('the custom wallpaper has a crop section', Boolean(section()), true);
      check('which asks for a picture first', section()?.querySelectorAll('[aria-label^="调整 "]').length ?? 0, 0);
      // With the picture it has the same eight handles as every other kind.
      await act(async () => {
        appStore.setState({ wallpaperUrl: 'https://cdn.example.com/custom.webp' } as never);
      });
      await flush();
      check('with a picture it has the eight handles', section()?.querySelectorAll('[aria-label^="调整 "]').length ?? 0, 8);
      check('and says how to use them', (section()?.textContent ?? '').includes('拖动方框'), true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

  /* --- the administrator's version of the same wallpaper ------------------- */
  {
    const admin = (kind: string, options: Record<string, unknown>) => ({
      configured: true,
      kind,
      file: 'bg.webp',
      bytes: 1000,
      hash: 'abc',
      url: 'https://cdn.example.com/bg.webp',
      note: null,
      options: {
        crop: { x: 0, y: 0, w: 1, h: 1 },
        blur: 12,
        dim: 0.4,
        dynamic: false,
        auroraA: '',
        auroraB: '',
        ...options,
      },
      available: [],
    });
    const mine = { ...DEFAULT_WALLPAPER, kind: 'image' as const, url: 'https://cdn.example.com/mine.png', blur: 3, dim: 0.2 };
    const custom = shownWallpaper(
      mine,
      admin('custom', {
        customSway: false,
        customSwayAmplitude: 6,
        customSwayFrequency: 0.3,
        customShowParticles: true,
        customParticleRise: 120,
        customParticleDrift: 310,
        customParticleDirection: 0.4,
        crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.6 },
      }) as never,
    );
    check(
      'a custom default background carries its picture and its seven controls',
      [
        custom.kind,
        custom.url,
        custom.customSway,
        custom.customSwayAmplitude,
        custom.customSwayFrequency,
        custom.customShowParticles,
        custom.customParticleRise,
        custom.customParticleDrift,
        custom.customParticleDirection,
      ],
      ['custom', 'https://cdn.example.com/bg.webp', false, 6, 0.3, true, 120, 310, 0.4],
    );
    check('and takes the darkness from the administrator', [custom.dim, custom.blur], [0.4, 3]);
    check('and the crop the administrator framed', custom.crop, { x: 0.1, y: 0.2, w: 0.6, h: 0.6 });
    const legacy = shownWallpaper(DEFAULT_WALLPAPER, admin('custom', {}) as never);
    check(
      'a settings file from before the seven controls gets the defaults',
      [legacy.customSway, legacy.customSwayAmplitude, legacy.customSwayFrequency, legacy.customParticleRise, legacy.customParticleDirection],
      [CUSTOM_EFFECT_DEFAULTS.sway, CUSTOM_EFFECT_DEFAULTS.amplitude, CUSTOM_EFFECT_DEFAULTS.frequency, CUSTOM_EFFECT_DEFAULTS.rise, CUSTOM_EFFECT_DEFAULTS.direction],
    );
    // The kinds that were there before are unchanged.
    const picture = shownWallpaper(mine, admin('image', { blur: 9, dim: 0.5 }) as never);
    check(
      'a picture default background still frames the picture',
      [picture.kind, picture.url, picture.blur, picture.dim],
      ['image', 'https://cdn.example.com/bg.webp', 9, 0.5],
    );
    const aurora = shownWallpaper(mine, admin('aurora', { auroraA: '#111111' }) as never);
    check('and the theme background is still the theme', [aurora.kind, aurora.auroraA], ['none', '#111111']);
    check('with no administrator background the user keeps theirs', shownWallpaper(mine, null), mine);
  }

  /* --- the appearance dialog's controls ------------------------------------ */
  {
    const { AppearanceDialog } = await import('./src/components/AppearanceDialog');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    appStore.setState({
      appearanceOpen: true,
      adminBackground: null,
      wallpaper: { ...DEFAULT_WALLPAPER, kind: 'custom', customA: '#123456', customB: '#654321' },
    } as never);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(AppearanceDialog));
    });
    await flush();
    const sliders = Array.from(host.querySelectorAll<HTMLInputElement>('[data-custom-controls] input[type="range"]'));
    check('the fourth wallpaper shows its controls', Boolean(host.querySelector('[data-custom-controls]')), true);
    check(
      'with the five sliders, named like the shared list',
      sliders.map((slider) => slider.getAttribute('aria-label')),
      CUSTOM_EFFECT_SLIDERS.map((slider: { label: string }) => slider.label),
    );
    // Two on/off switches: whether the picture sways, and whether particles exist.
    const switches = Array.from(host.querySelectorAll<HTMLElement>('[data-custom-controls] [role="switch"]'));
    check(
      'and two switches for the effects',
      switches.map((item) => item.getAttribute('aria-checked')),
      ['true', 'true'],
    );
    check(
      'named in the user\'s words',
      CUSTOM_EFFECT_TOGGLES.map((toggle: { label: string }) => toggle.label).map((label: string) =>
        (host.textContent ?? '').includes(label),
      ),
      [true, true],
    );
    check('a picture can be imported', Boolean(host.querySelector('[data-custom-import]')), true);
    const picker = host.querySelector<HTMLInputElement>('[data-custom-import]');
    check('which takes scene packages too', (picker?.getAttribute('accept') ?? '').includes('.pkg'), true);
    // The preview panel was removed on request; the crop editor is the only
    // picture of the wallpaper in the dialog now.
    check('there is no preview panel any more', Boolean(host.querySelector('[data-custom-preview]')), false);
    check('the crop editor is what shows the picture', Boolean(host.querySelector('[data-crop-section]')), true);
    // Moving a slider writes the setting it belongs to.
    const rise = host.querySelector<HTMLInputElement>('input[aria-label="粒子上升速度"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(rise, '180');
      rise.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    await flush();
    check('a slider writes its setting', appStore.getState().wallpaper.customParticleRise, 180);
    check('and the wallpaper stays the custom one', appStore.getState().wallpaper.kind, 'custom');
    // The density slider is the sixth control.
    const density = host.querySelector<HTMLInputElement>('input[aria-label="粒子密度"]') as HTMLInputElement;
    check('the density slider is a slider of the same family', [density?.type, density?.min, density?.max, density?.step], ['range', '0', '600', '10']);
    check('showing the default as a count', (host.textContent ?? '').includes('300 颗'), true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(density, '60');
      density.dispatchEvent(new w.Event('input', { bubbles: true }));
    });
    await flush();
    check('and it writes the density', appStore.getState().wallpaper.customParticleDensity, 60);
    // The base colour: the theme accent until picked, then a hex, then back.
    const colorInput = host.querySelector<HTMLInputElement>('[data-custom-particle-color-input]') as HTMLInputElement;
    check('the base colour is a colour field', [colorInput?.type, colorInput?.getAttribute('aria-label')], ['color', '粒子基色']);
    check('which shows the theme accent while following it', colorInput?.value, '#6d4cff');
    check('and says it is following the theme', (host.textContent ?? '').includes('跟随主题强调色'), true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(colorInput, '#ff4040');
      colorInput.dispatchEvent(new w.Event('input', { bubbles: true }));
      colorInput.dispatchEvent(new w.Event('change', { bubbles: true }));
    });
    await flush();
    check('picking a colour writes it', appStore.getState().wallpaper.customParticleColor, '#ff4040');
    const follow = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '跟随主题强调色');
    await act(async () => {
      follow?.click();
    });
    await flush();
    check('and the reset button goes back to the theme', appStore.getState().wallpaper.customParticleColor, '');
    await act(async () => {
      root.unmount();
    });
    host.remove();
    globalThis.fetch = realFetch;
    appStore.setState(hold);
  }
}


/* --- the particle look, as the library runs it (compatibility path) ------ */
// The wallpaper itself now runs the emitter below (batch P); this block keeps
// the library-only warm-up honest for the older exports.
{
  const { advanceLibraryParticles, createLibraryParticles, drawLibraryParticles, warmUpLibraryParticles } = await import(
    './src/components/CustomWallpaper'
  );
  const { resolveCustomEffect } = await import('./src/lib/wallpaper');

  // The library draws its random numbers from Math.random; seed it for the run
  // so the counts and sizes below are the same on every test run (and restore
  // the real one afterwards - later blocks must not inherit a fixed stream).
  const realRandom = Math.random;
  const makeRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };
  Math.random = makeRandom(7);
  const systems = createLibraryParticles(resolveCustomEffect({}));
  check('nothing is alive before the warm-up (the preset starts at 3s)', systems.root.aliveCount, 0);
  warmUpLibraryParticles(systems);
  check('the warm-up fills the ember field', systems.root.aliveCount > 80, true);
  check('and its glow child comes with it', systems.glow.aliveCount > 0, true);

  // Drift, read from the library's own particles: upward, mostly one way.
  const alive = systems.root.slots.filter((slot: { alive: boolean }) => slot.alive);
  // driftVelocity is the library's own base drift (before turbulence): its y is
  // rise + speed * forward, so its sign says which way that particle was sent.
  const drift = alive.map((slot: { driftVelocity: number[] }) => slot.driftVelocity[1]);
  const meanUp = drift.reduce((sum: number, value: number) => sum + value, 0) / drift.length;
  const forward = drift.filter((value: number) => value > 240).length / drift.length;
  check('the embers drift upward', meanUp > 280 && meanUp < 360, true);
  // The configured 0.7 forward ratio, with the sample's own spread.
  check('and mostly the main way', Math.abs(forward - 0.7) <= 0.05, true);

  // The quads come from the library's buildVertices: the size ramp, the alpha
  // fade and the glow pairing are its numbers, not ours.
  const scratch = new Float32Array(9 * 6 * 512);
  const quads = (system: { buildVertices: (out: Float32Array, stride: number, scale: number) => number }) => {
    const count = system.buildVertices(scratch, 9, 1);
    const sizes: number[] = [];
    const alphas: number[] = [];
    for (let vertex = 0; vertex + 6 <= count; vertex += 6) {
      const base = vertex * 9;
      const cX = [scratch[base], scratch[base + 9], scratch[base + 18], scratch[base + 45]];
      const cY = [scratch[base + 1], scratch[base + 10], scratch[base + 19], scratch[base + 46]];
      sizes.push(Math.hypot(cX[1] - cX[0], cY[1] - cY[0]));
      alphas.push(scratch[base + 8]);
    }
    return { count, sizes, alphas };
  };
  const embers = quads(systems.root);
  check('every live ember is a quad', embers.sizes.length, systems.root.aliveCount);
  check('with a size ramp', Math.min(...embers.sizes) < 30 && Math.max(...embers.sizes) > 300, true);
  check('and an alpha fade', Math.min(...embers.alphas) > 0 && Math.max(...embers.alphas) <= 1, true);
  const glow = quads(systems.glow);
  check('the glow child is larger than the embers', Math.min(...glow.sizes) > Math.max(...embers.sizes), true);
  check('and faint, so it reads as light', Math.max(...glow.alphas) <= 0.06, true);

  // Drawing: every sprite is additive, and a later frame draws a different set.
  const canvasProto = w.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const realCtx = canvasProto.getContext;
  // The sprites are rasterised once per document, on a canvas of their own.
  canvasProto.getContext = () => ({ putImageData() {}, fillRect() {}, drawImage() {} });
  const draws: Array<{ op: string; alpha: number }> = [];
  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    putImageData() {},
    fillRect() {},
    drawImage() {
      draws.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha });
    },
  };
  try {
    drawLibraryParticles(ctx as unknown as CanvasRenderingContext2D, systems, 1920, 1080, 1);
    check('the particles are drawn', draws.length > 0, true);
    check('all of them additively', draws.every((draw) => draw.op === 'lighter'), true);
    check('and the context is put back afterwards', ctx.globalCompositeOperation, 'source-over');
    check('the glow is part of the same pass', draws.some((draw) => draw.alpha <= 0.06), true);
    const first = draws.map((draw) => draw.alpha).join(',');
    draws.length = 0;
    for (let step = 0; step < 6; step += 1) advanceLibraryParticles(systems, 1 / 60);
    drawLibraryParticles(ctx as unknown as CanvasRenderingContext2D, systems, 1920, 1080, 1);
    check('a later frame draws a different set', draws.map((draw) => draw.alpha).join(',') !== first, true);
  } finally {
    canvasProto.getContext = realCtx;
    Math.random = realRandom;
  }
}

/* --- a scene package can be imported as the picture ----------------------- */
{
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const { PkgWallpaperError, isScenePkg, pictureFromScenePkg } = await import('./src/lib/scene/pkg-wallpaper');
  // The repository keeps the standard Wallpaper Engine fixture package; it is
  // read from disk (data/ is gitignored, so check:repo does not see it).
  const candidates = [
    pathMod.join(process.cwd(), '..', 'data', 'backgrounds', 'rossi.pkg'),
    pathMod.join(process.cwd(), 'data', 'backgrounds', 'rossi.pkg'),
  ];
  const pkgPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
  check('the scene package fixture is there', pkgPath !== '', true);
  if (pkgPath) {
    const bytes = fs.readFileSync(pkgPath);
    const notes: string[] = [];
    const picture = await pictureFromScenePkg(new w.File([bytes], 'rossi.pkg'), (note: string) => notes.push(note));
    check('the complete picture is read from the package', [picture.width, picture.height], [3840, 2160]);
    check('as the layer texture, not a rendered frame', picture.source, 'layer');
    check('at the size the texture says', picture.bytes, 7687542);
    check(
      'named after the texture it came from',
      [picture.fileName.endsWith('.png'), picture.note.includes('142584003_p0')],
      [true, true],
    );
    const magic = new Uint8Array(await picture.blob.slice(0, 8).arrayBuffer());
    check('and it is a PNG', Array.from(magic), [137, 80, 78, 71, 13, 10, 26, 10]);
    check(
      'with progress for the dialog',
      notes.some((note) => note.includes('读取场景包')) && notes.some((note) => note.includes('完整的壁纸图')),
      true,
    );

    const refuse = async (file: File) => {
      try {
        await pictureFromScenePkg(file);
        return 'no error';
      } catch (err) {
        return err instanceof PkgWallpaperError ? err.message : 'wrong error type: ' + (err as Error).message;
      }
    };
    check('a file that is not a package is named as such', await refuse(new w.File([bytes], 'picture.png')), '这不是 .pkg 场景包');
    check('an empty package is refused', await refuse(new w.File([], 'empty.pkg')), '这个场景包是空的');
    check(
      'and bytes that are not a package',
      (await refuse(new w.File([new Uint8Array(12)], 'junk.pkg'))).includes('不是 Wallpaper Engine 的场景包'),
      true,
    );
    check('isScenePkg is just the extension test it uses', [isScenePkg(new w.File([], 'a.PKG')), isScenePkg(new w.File([], 'a.png'))], [true, false]);
  }
}
/* --- the boot screen and the error boundaries ----------------------------- */
console.log('\nthe boot screen and the error boundaries (jsdom)');
{
  const fs = await import('node:fs');
  const pathMod = await import('node:path');
  const candidates = [pathMod.join(process.cwd(), 'index.html'), pathMod.join(process.cwd(), 'web', 'index.html')];
  const indexPath = candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
  check('the page shell is on disk', indexPath !== '', true);
  if (indexPath) {
    const html = fs.readFileSync(indexPath, 'utf8');
    check(
      'it carries the placeholder the user sees',
      [
        html.includes('id="boot"'),
        html.includes('data-boot-state="loading"'),
        html.includes('id="boot-line"'),
        html.includes('id="boot-error"'),
        html.includes('id="boot-reload"'),
      ],
      [true, true, true, true, true],
    );
    check(
      'a stale chunk reloads once, with a timestamp to stop a loop',
      [
        html.includes('vite:preloadError'),
        html.includes('notes-manager-boot-reloaded-at'),
        /RELOAD_DEBOUNCE_MS = 10000/.test(html),
      ],
      [true, true, true],
    );
    check('a silent failure becomes visible after the deadline', /MOUNT_TIMEOUT_MS = 12000/.test(html), true);
    check('and the application says hello when it mounts', [
      html.includes('window.__boot'),
      html.includes('markMounted'),
    ], [true, true]);
  }

  // The API boundary: 200 with no usable body is an error, not `{}`.
  {
    const { api } = await import('./src/lib/api');
    const realFetch = globalThis.fetch;
    const codeOf = async (body: string) => {
      globalThis.fetch = (async () =>
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
      try {
        await api.listNotes();
        return 'no error';
      } catch (err) {
        return (err as { code?: string }).code ?? 'no code';
      }
    };
    try {
      check('an empty 200 is a bad_response', await codeOf(''), 'bad_response');
      check('a null 200 body is too', await codeOf('null'), 'bad_response');
      check('and so is something that is not JSON', await codeOf('not json'), 'bad_response');
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // The palette is where the crash surfaced: notes.filter over an undefined
  // list. It must survive the store handing it rubbish.
  {
    const { CommandPalette } = await import('./src/components/CommandPalette');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    const realError = console.error;
    console.error = () => undefined;
    // jsdom has no layout, so it has no scrollIntoView: the palette's
    // "keep the cursor visible" call would throw where a browser would not.
    const elementProto = w.Element.prototype as unknown as { scrollIntoView?: unknown };
    const realScrollIntoView = elementProto.scrollIntoView;
    elementProto.scrollIntoView = () => undefined;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const type = async (value: string) => {
      const input = host.querySelector('input');
      await act(async () => {
        if (!input) return;
        const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new w.Event('input', { bubbles: true }));
      });
      await flush();
    };
    try {
      appStore.setState({ paletteOpen: true, notes: undefined } as never);
      let crash: string | null = null;
      try {
        await act(async () => {
          root.render(React.createElement(CommandPalette));
        });
        await flush();
      } catch (err) {
        crash = (err as Error).message ?? String(err);
      }
      check('the palette survives a store with no notes', crash, null);
      check('and still opens', Boolean(host.querySelector('input')), true);
      let typedCrash: string | null = null;
      try {
        await type('note');
        await flush();
      } catch (err) {
        typedCrash = (err as Error).message ?? String(err);
      }
      check('typing into it does not crash either', typedCrash, null);

      // A note without a title or tags: the other shape that used to throw.
      appStore.setState({ notes: [{ id: 'n1' }] } as never);
      let entryCrash: string | null = null;
      try {
        await type('n1');
        await act(async () => {
          root.render(React.createElement(CommandPalette));
        });
        await flush();
      } catch (err) {
        entryCrash = (err as Error).message ?? String(err);
      }
      check('a note without a title or tags is tolerated', entryCrash, null);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      elementProto.scrollIntoView = realScrollIntoView;
      console.error = realError;
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }

  // The root boundary says what happened and offers the two repairs.
  {
    const { ErrorBoundary } = await import('./src/components/ErrorBoundary');
    const realError = console.error;
    console.error = () => undefined;
    const Boom = () => {
      throw new Error('boom from a child');
    };
    const renderNode = async (node: React.ReactElement) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      let crash: Error | null = null;
      try {
        await act(async () => {
          root.render(node);
        });
        await flush();
      } catch (err) {
        crash = err as Error;
      }
      const html = host.innerHTML;
      await act(async () => {
        root.unmount();
      });
      host.remove();
      return { html, crash };
    };
    try {
      const crashed = await renderNode(React.createElement(ErrorBoundary, null, React.createElement(Boom)));
      check(
        'a render error becomes a panel, not a white page',
        [crashed.html.includes('data-testid="error-boundary"'), crashed.html.includes('role="alert"')],
        [true, true],
      );
      check('the message is the original error', crashed.html.includes('boom from a child'), true);
      check(
        'with both repairs offered',
        [crashed.html.includes('data-testid="error-reload"'), crashed.html.includes('data-testid="error-clear-cache"')],
        [true, true],
      );

      const custom = await renderNode(
        React.createElement(
          ErrorBoundary,
          {
            fallback: React.createElement('div', { 'data-testid': 'custom-fallback' }, '占位'),
            children: React.createElement(Boom),
          },
        ),
      );
      check(
        'a custom fallback is used where one is given',
        [custom.html.includes('data-testid="custom-fallback"'), custom.html.includes('data-testid="error-boundary"')],
        [true, false],
      );

      const healthy = await renderNode(React.createElement(ErrorBoundary, null, React.createElement('div', null, '一切正常')));
      check('a healthy subtree renders straight through', healthy.html.includes('一切正常'), true);
      check('with no panel', healthy.html.includes('data-testid="error-boundary"'), false);
    } finally {
      console.error = realError;
    }
  }

  // The wallpaper is decoration: a crash inside it leaves the panel alone.
  {
    const { Wallpaper } = await import('./src/components/Wallpaper');
    const { DEFAULT_WALLPAPER } = await import('./src/lib/wallpaper');
    const hold = appStore.getState();
    const realFetch = globalThis.fetch;
    const realError = console.error;
    globalThis.fetch = (async () => reply({})) as typeof fetch;
    console.error = () => undefined;
    // Reads only the fields the layer needs before it reaches the custom
    // wallpaper; everything past that throws, standing in for a broken render.
    const allowed = new Set(['useAdminBackground', 'kind', 'url', 'source', 'crop', 'dim', 'autoAccent']);
    const broken = new Proxy(
      { ...DEFAULT_WALLPAPER, kind: 'custom', url: 'https://cdn.example.com/custom.webp' },
      {
        get(target, prop) {
          if (typeof prop !== 'string' || allowed.has(prop)) return (target as Record<string | symbol, unknown>)[prop];
          throw new Error('wallpaper boom');
        },
      },
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      appStore.setState({ appearanceOpen: false, wallpaper: broken, adminBackground: null } as never);
      await act(async () => {
        root.render(
          React.createElement(
            'div',
            null,
            React.createElement(Wallpaper),
            React.createElement('div', { 'data-testid': 'panel-body' }, '面板内容'),
          ),
        );
      });
      await flush();
      check(
        'a broken wallpaper falls back to the colour field',
        [
          Boolean(host.querySelector('[data-testid="wallpaper-fallback"]')),
          host.querySelector('[data-wallpaper-fallback]')?.getAttribute('data-wallpaper-fallback'),
        ],
        [true, 'true'],
      );
      check('and the panel on top of it is untouched', host.querySelector('[data-testid="panel-body"]')?.textContent, '面板内容');
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      console.error = realError;
      globalThis.fetch = realFetch;
      appStore.setState(hold);
    }
  }
}

/* --- the ember field's own emitter (batch P) ------------------------------ */
console.log('\nthe ember emitter (jsdom)');
{
  const {
    countVisibleEmbers,
    createFlowParticles,
    createParticleFlowState,
    placeSpawnedEmbers,
    spawnEmberPosition,
    spawnEmberVelocity,
    warmUpParticleFlow,
  } = await import('./src/components/CustomWallpaper');
  const { resolveCustomEffect } = await import('./src/lib/wallpaper');
  const makeRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  };
  // A 1920x1080 viewport in scene units (unit = 1), so positions read directly.
  const field = { width: 1920, height: 1080, unit: 1 };
  const bottom = -field.height / 2;
  const top = field.height / 2;

  // Birth: below the bottom edge, across the whole width.
  {
    const random = makeRandom(11);
    const places = Array.from({ length: 200 }, () => spawnEmberPosition(field, 40, random));
    check('every ember is born below the screen', places.every((place) => place.y < bottom), true);
    check('with its whole sprite off screen', places.every((place) => place.y + 40 < bottom), true);
    check(
      'and somewhere across the full width',
      [Math.min(...places.map((place) => place.x)) < -600, Math.max(...places.map((place) => place.x)) > 600],
      [true, true],
    );
  }

  // Velocity: |vx| is uniform over [0, drift], its sign is right with
  // probability direction; rise is the upward speed.
  {
    const sample = (flow: { rise: number; drift: number; direction: number }) => {
      const random = makeRandom(7);
      let right = 0;
      let sumAbs = 0;
      let maxAbs = 0;
      let sumVy = 0;
      let minVy = Number.POSITIVE_INFINITY;
      let maxVy = 0;
      const count = 20000;
      for (let index = 0; index < count; index += 1) {
        const { vx, vy } = spawnEmberVelocity(flow, random);
        if (vx > 1e-9) right += 1;
        const abs = Math.abs(vx);
        sumAbs += abs;
        maxAbs = Math.max(maxAbs, abs);
        sumVy += vy;
        minVy = Math.min(minVy, vy);
        maxVy = Math.max(maxVy, vy);
      }
      return { right: right / count, meanAbs: sumAbs / count, maxAbs, meanVy: sumVy / count, minVy, maxVy };
    };
    const flow = { rise: 240, drift: 200, direction: 0.7 };
    const stats = sample(flow);
    check('the rightward share is the direction', Math.abs(stats.right - 0.7) <= 0.05, true);
    check('sideways speed never passes the maximum', stats.maxAbs <= 200, true);
    check('and the maximum is reachable', stats.maxAbs > 190, true);
    check('with a mean of half of it', Math.abs(stats.meanAbs - 100) <= 6, true);
    // Upward: vy = rise * random(0.5, 1), so the slider is the maximum.
    check('the rise is a maximum, not the speed', [stats.minVy >= 120, stats.maxVy <= 240, stats.maxVy > 235], [true, true, true]);
    check('with a mean of three quarters of it', Math.abs(stats.meanVy - 180) <= 6, true);
    const fastRise = sample({ ...flow, rise: 1000 });
    check('rise 1000 is [500, 1000] with a mean of 750', [fastRise.minVy >= 500, fastRise.maxVy <= 1000, Math.abs(fastRise.meanVy - 750) <= 10], [true, true, true]);
    check('0 sends every ember left', sample({ ...flow, direction: 0 }).right, 0);
    check('1 sends every ember right', sample({ ...flow, direction: 1 }).right, 1);
    check('0.5 splits them', Math.abs(sample({ ...flow, direction: 0.5 }).right - 0.5) <= 0.05, true);
    check('drift 0 is no sideways speed', sample({ ...flow, drift: 0 }).maxAbs, 0);
    check('rise 0 is no upward speed', sample({ ...flow, rise: 0 }).meanVy, 0);
  }

  // The field: embers appear from below and are warmed up onto the screen.
  {
    const systems = createFlowParticles(resolveCustomEffect({}));
    const state = createParticleFlowState(systems);
    const flow = { rise: 240, drift: 200, direction: 0.7 };
    const stats = warmUpParticleFlow(systems, state, field, flow, 3.2, makeRandom(3));
    check('the warm-up spawns embers', stats.spawned > 0, true);
    check('and every one of them below the screen', stats.belowViewport, stats.spawned);
    const alive = systems.root.slots.filter((slot: { alive: boolean }) => slot.alive);
    const inside = alive.filter(
      (slot: { position: number[] }) => Math.abs(slot.position[1]) < top && Math.abs(slot.position[0]) < field.width / 2,
    );
    check('after the warm-up there are embers on screen', inside.length > 0, true);
    // The same count the canvas reports through data-visible-particles.
    const visible = countVisibleEmbers(systems, field);
    check('the visible count is what the field holds on screen', [visible > 0, visible <= alive.length], [true, true]);

    // The emitter owns the velocity: the library's drift is only the rise.
    const fresh = createFlowParticles(resolveCustomEffect({}));
    const freshState = createParticleFlowState(fresh);
    fresh.root.update(1 / 20);
    const spawned = placeSpawnedEmbers(fresh, freshState, field, flow, makeRandom(5));
    const born = fresh.root.slots.filter((slot: { alive: boolean }) => slot.alive);
    check('a step spawns into the field', spawned.spawned > 0, true);
    check(
      'the emitter, not the library drift, sets the velocity',
      born.every((slot: { velocity: number[]; driftVelocity: number[] }) => slot.velocity[0] === slot.driftVelocity[0] && slot.velocity[1] === slot.driftVelocity[1]),
      true,
    );
    check('a step spawns them in', spawned.spawned > 0, true);
    // A few steps, so the sideways speeds can be compared as a spread: their
    // base is the emitter's, which the library does not overwrite at birth.
    for (let step = 0; step < 8; step += 1) {
      fresh.root.update(1 / 20);
      placeSpawnedEmbers(fresh, freshState, field, flow, makeRandom(20 + step));
    }
    const sideways = fresh.root.slots
      .filter((slot: { alive: boolean }) => slot.alive)
      .map((slot: { driftVelocity: number[] }) => Math.abs(slot.driftVelocity[0]));
    check(
      'with sideways speeds spread up to the maximum',
      [Math.min(...sideways) < 60, Math.max(...sideways) > 140],
      [true, true],
    );

    // rise 0 is a still field: nothing climbs into view.
    const still = createFlowParticles(resolveCustomEffect({}));
    const stillState = createParticleFlowState(still);
    const stillStats = warmUpParticleFlow(still, stillState, field, { ...flow, rise: 0 }, 3.2, makeRandom(4));
    const stillAlive = still.root.slots.filter((slot: { alive: boolean }) => slot.alive);
    const onScreen = stillAlive.filter((slot: { position: number[] }) => slot.position[1] > bottom);
    check('rise 0 keeps every ember below the screen', stillStats.spawned > 0, true);
    check('so none of them is in view', onScreen.length, 0);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
