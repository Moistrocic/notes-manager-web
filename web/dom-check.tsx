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
import type { NoteSummary } from './src/lib/types';

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
  await closeMenu();

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
    ],
    folders: [
      { path: 'proj', name: 'proj', count: 2, depth: 0 },
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

  // A drag that finds no destination carries nothing anywhere, and picks nothing
  // either: it is a drag that ended nowhere.
  moved.length = 0;
  document.elementFromPoint = () => row('note:b');
  await press('note:a');
  await moveTo(40, 20);
  check('a note is not a destination', hintValue(), null);
  check('and no row claims the drop', row('note:b')?.getAttribute('data-drop-target'), null);
  check('though the card is up', Boolean(ghost()), true);
  check('and nothing is picked', appStore.getState().selection, []);
  await release();
  check('so letting go moves nothing', moved, []);
  check('and picks nothing either', appStore.getState().selection, []);
  check('with no bar', Boolean(toolbar()), false);
  await settled();
  check('and the card goes', Boolean(ghost()), false);
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

/* --- the order the tree is drawn in --------------------------------------- */
console.log('\nsorting the panel (jsdom)');
{
  const hold = appStore.getState();
  appStore.setState({
    capabilities: WRITABLE,
    notes: [summaryNote('s1', 'Alpha', 'proj'), summaryNote('s2', 'Beta', 'proj'), summaryNote('s3', 'Gamma', '')],
    folders: [{ path: 'proj', name: 'proj', count: 2, depth: 0 }],
    expandedFolders: ['proj'],
    activeFolder: null,
    activeId: null,
    query: '',
    selection: [],
    sort: 'title',
    sortOrder: 'asc',
    loadingNotes: false,
    notesError: null,
  } as never);

  const panel = await mountPanel();
  const sortKey = panel.host.querySelector<HTMLSelectElement>('[data-testid="sort-key"]');
  const asc = () => panel.host.querySelector('[data-testid="sort-order-asc"]');
  const desc = () => panel.host.querySelector('[data-testid="sort-order-desc"]');
  const order = () =>
    Array.from(panel.host.querySelectorAll('[data-tree-row]')).map((item) => item.getAttribute('data-tree-row'));

  check('the sort is a labelled picker', sortKey?.getAttribute('aria-label'), '排序方式');
  check('defaulting to the title', sortKey?.value, 'title');
  check('which it calls 标题', sortKey?.selectedOptions[0]?.textContent, '标题');
  check('and running upwards by default', asc()?.getAttribute('aria-pressed'), 'true');
  check('with the other direction unpressed', desc()?.getAttribute('aria-pressed'), 'false');
  // Folders first, then the notes inside them - the order the tree is for.
  check('the tree is in title order', order(), ['folder:proj', 'note:s1', 'note:s2', 'note:s3']);

  await act(async () => {
    desc()?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  });
  await flush();
  check('choosing the other direction reaches the store', appStore.getState().sortOrder, 'desc');
  check('and turns the notes around', order(), ['folder:proj', 'note:s2', 'note:s1', 'note:s3']);
  check('showing which direction is on', desc()?.getAttribute('aria-pressed'), 'true');
  check('and which is not', asc()?.getAttribute('aria-pressed'), 'false');

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
    selection: [],
    loadingNotes: false,
    notesError: null,
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

  // Making a note asks where it goes first: the folder is a choice, not
  // something inferred from whatever was clicked last.
  await act(async () => {
    button('新建笔记')?.click();
  });
  await flush();
  check('making a note asks where it goes', document.querySelector('[data-testid="dialog-title"]')?.textContent, '新建笔记');
  check('with a title to give it', Boolean(document.querySelector('[data-testid="dialog-input"]')), true);
  const picker = document.querySelector<HTMLSelectElement>('[data-testid="dialog-folder-select"]');
  check('and a destination dropdown', picker?.getAttribute('aria-label'), '目标目录');
  check('whose first choice is the root', picker?.options[0]?.textContent, '根目录');
  check(
    'listing every folder there is',
    Array.from(picker?.options ?? []).map((option) => option.value),
    ['', 'proj', 'proj/deep'],
  );
  check('and a way to confirm it', Boolean(document.querySelector('[data-testid="dialog-confirm"]')), true);
  await act(async () => {
    cancel()?.click();
  });
  await flush();
  check('cancelling puts it away', Boolean(document.querySelector('[data-testid="dialog-title"]')), false);

  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="上传文件"]')?.click();
  });
  await flush();
  check('uploading asks the same question', document.querySelector('[data-testid="dialog-title"]')?.textContent, '上传文件');
  check('with the same destination dropdown', Boolean(document.querySelector('[data-testid="dialog-folder-select"]')), true);
  check(
    'and no title field, since the files carry their own names',
    Boolean(document.querySelector('[data-testid="dialog-input"]')),
    false,
  );
  // Any file is accepted: a picture is as much a part of the folder as a note.
  check('and the picker does not narrow the choice', host.querySelector('input[type="file"]')?.hasAttribute('accept'), false);
  await act(async () => {
    cancel()?.click();
  });
  await flush();

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

/* --- the way in from the front page --------------------------------------- */
console.log('\nthe front page (jsdom)');
{
  const App = (await import('./src/App')).default;
  const hold = appStore.getState();
  const realFetch = globalThis.fetch;
  // No server is reachable here: the question is what the page looks like
  // before anybody has signed in.
  globalThis.fetch = (async () => {
    throw new Error('no server here');
  }) as typeof fetch;
  appStore.setState({
    booted: true,
    user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
    notes: [note],
    activeId: null,
    activeNote: null,
    query: '',
    activeTag: null,
    favoriteOnly: false,
    pinnedOnly: false,
    expandedFolders: [],
    loadingNotes: false,
    notesError: null,
  } as never);
  w.history.replaceState(null, '', '/');

  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(App));
  });
  await flush();

  const entry = host.querySelector<HTMLAnchorElement>('[data-panel-entry]');
  check('the front page carries one way in', Boolean(entry), true);
  check('named for what it opens', entry?.getAttribute('aria-label'), '管理面板登录入口');
  check('pointing at the panel address', entry?.getAttribute('href'), '/manager/');
  // Deliberately blank: nothing of the panel is behind it.
  check(
    'and nothing of the panel is on it',
    host.innerHTML.includes('新建笔记') || host.innerHTML.includes('搜索笔记'),
    false,
  );
  check('nor the sign-in card', host.innerHTML.includes('登录工作台'), false);

  await act(async () => {
    entry?.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  // The front page hands over through a "wait" transition: the panel is only
  // rendered once the page on its way out has finished leaving.
  await settled();
  check('clicking it moves the address into the panel', w.location.pathname, '/manager/');
  check('and the panel is what follows', Boolean(host.querySelector('[data-note-tree]')), true);

  await act(async () => {
    root.unmount();
  });
  host.remove();
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
