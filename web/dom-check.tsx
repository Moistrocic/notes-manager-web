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
  const note = (id: string, title: string, folder: string, extra: Record<string, unknown> = {}) => ({
    id,
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

  appStore.setState({
    notes: [
      note('a', '根目录笔记', ''),
      note('b', '项目笔记', 'proj'),
      note('c', '子目录笔记', 'proj/deep'),
      note('d', '收藏笔记', 'proj', { favorite: true }),
      note('e', '置顶笔记', '', { pinned: true }),
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
    view: 'tree',
    expandedFolders: [],
    loadingNotes: false,
    notesError: null,
  });

  const tree = await renderOnce(React.createElement(NotesPanel));

  check('the tree shows its folders', tree.includes('proj'), true);
  check('and the notes at the root', tree.includes('根目录笔记'), true);
  // A collapsed folder hides its contents; that is the point of a tree.
  check('a collapsed folder keeps its notes out of sight', tree.includes('项目笔记'), false);
  check('with a control to make a subfolder', tree.includes('新建子文件夹'), true);
  check('and to rename a folder', tree.includes('重命名文件夹'), true);
  check('and to delete one, saying it can be recovered', tree.includes('移入回收站，可恢复'), true);
  check('notes can be renamed', tree.includes('重命名笔记'), true);
  check('moved', tree.includes('移动到文件夹'), true);
  // Required even here: state is not a property of how the list is arranged.
  check('and pinned or favourited from the tree too', tree.includes('取消置顶') || tree.includes('置顶'), true);

  // Selecting a folder elsewhere has to make it reachable, so the path down to
  // it unfolds on its own.
  appStore.setState({ activeFolder: 'proj' });
  const opened = await renderOnce(React.createElement(NotesPanel));
  check('opening a folder shows its notes', opened.includes('项目笔记'), true);
  check('and its nested folders', opened.includes('deep'), true);
  check('a favourited note offers to unfavourite it', opened.includes('取消收藏'), true);
  appStore.setState({ activeFolder: null });

  // The three actions the design asks for, in order.
  check('the panel offers exactly the three primary actions', ['新建笔记', '上传笔记（.md）', '回收站'].every((label) => tree.includes(label)), true);

  // The expander has to be clickable: the label area around it is
  // pointer-events-none, and without this a folder could only ever open.
  check('the folder expander can actually be clicked', /focus-ring pointer-events-auto[^"]*"[^>]*aria-label="展开"/.test(tree) || (tree.includes('pointer-events-auto') && tree.includes('aria-label="展开"')), true);
  check('a folder can be made at the root', tree.includes('在根目录新建文件夹'), true);

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
  appStore.setState({ activeFolder: null, view: 'list' });
  const cards = await renderOnce(React.createElement(NotesPanel));
  check('the card modes still narrow to the folder', cards.includes('项目笔记'), true);

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
  const panel = await renderTip(React.createElement(Panel));
  check('the search-scope control carries its placement', panel.includes('absolute right-9'), true);
  // Nothing anywhere may hold two position classes: whichever Tailwind emits
  // last wins, and that is not the one the author asked for.
  const doubled = panel.match(/class="[^"]*\b(?:relative|absolute|fixed|sticky)\b[^"]*\b(?:relative|absolute|fixed|sticky)\b[^"]*"/g) ?? [];
  check('and no element carries two position classes at once', doubled, []);
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
    await act(async () => {
      r.unmount();
    });
    host.remove();
    return html;
  };

  // Creating used to invent a name and make the folder in one go, which left a
  // folder called 新文件夹 to be renamed straight afterwards.
  const root = await renderPrompt({ kind: 'newFolder', parent: '', value: '新文件夹' });
  check('making a folder asks for its name', root.includes('新建文件夹'), true);
  check('and says where it will go', root.includes('在根目录下'), true);
  check('with the name in a field', root.includes('<input'), true);

  const nested = await renderPrompt({ kind: 'newFolder', parent: 'proj', value: '新文件夹' });
  check('a nested one names its parent', nested.includes('在 proj 下'), true);

  const move = await renderPrompt({ kind: 'moveNote', id: 'a', value: 'proj' });
  check('moving picks from the folders', move.includes('移动笔记') && move.includes('proj/deep'), true);
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
    status: { version: '1.0.0', basePath: '', publicUrl: '', uptimeSeconds: 5 } as never,
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
  check('with their size', markup.includes('43.5 MB'), true);
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

  await act(async () => {
    root.unmount();
  });
  host.remove();
  globalThis.fetch = realFetch;
  appStore.setState(hold);
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
    check('a deployment without OpenList offers guest browsing', login.includes('以游客身份浏览'), true);
    check('and says it is read-only', login.includes('只读浏览本机的笔记目录'), true);
    check('and marks it in the status row', login.includes('游客可只读浏览'), true);

    appStore.setState({ providers: { ...appStore.getState().providers!, guest: false } });
    const closed = await renderOnce(React.createElement(LoginScreen));
    check('with guest access off there is no way in', closed.includes('以游客身份浏览'), false);

    // The switch that decides it lives in the server settings.
    appStore.setState({ settingsOpen: true });
    const settings = await renderOnce(React.createElement(SettingsDialog));
    check('the settings dialog decides who may browse', settings.includes('允许游客只读浏览'), true);
  } finally {
    appStore.setState(hold);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
