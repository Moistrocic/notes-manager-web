/**
 * The scene wallpaper test bench.
 *
 * Runs a scene.pkg through the same modules the application uses - the same
 * worker, the same still compositor, the same live renderer - so that what it
 * shows here is what the app does, and a failure here is a failure there.
 *
 * Its reason for existing is that the live path could only be judged from
 * inside a wallpaper layer, which reports nothing. Everything the worker says
 * is printed, including the messages that arrive long after the first frame and
 * used to be dropped on the floor.
 */

import { canPlayScenes, playScene, type ScenePlayer } from '../lib/scene/play-scene';
import { canRenderScenes, renderSceneStill } from '../lib/scene/render-still';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const fileInput = $<HTMLInputElement>('file');
const sourceLabel = $('source');
const stillButton = $<HTMLButtonElement>('still');
const stillImage = $<HTMLImageElement>('still-img');
const stillLog = $('still-log');
const stillNote = $('still-note');
const playButton = $<HTMLButtonElement>('play');
const stopButton = $<HTMLButtonElement>('stop');
const playStage = $('play-stage');
const playLog = $('play-log');
const playNote = $('play-note');
const reloadButton = $<HTMLButtonElement>('reload');
const layersButton = $<HTMLButtonElement>('layers');

let pkg: { name: string; bytes: ArrayBuffer } | null = null;
let player: ScenePlayer | null = null;
let ticker: number | null = null;
const stillUrl: { current: string | null } = { current: null };

function say(target: HTMLElement, line: string, tone: 'plain' | 'ok' | 'bad' = 'plain') {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const cls = tone === 'ok' ? ' class="ok"' : tone === 'bad' ? ' class="bad"' : '';
  target.innerHTML += `\n<span class="muted">${stamp}</span> <span${cls}>${line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</span>`;
  target.scrollTop = target.scrollHeight;
}

function reset(target: HTMLElement, line: string) {
  target.innerHTML = line;
}

function ready() {
  const canStill = canRenderScenes() && Boolean(pkg);
  const canLive = canPlayScenes() && Boolean(pkg);
  stillButton.disabled = !canStill;
  playButton.disabled = !canLive;
  stopButton.disabled = !player;
  stillNote.textContent = pkg ? `${(pkg.bytes.byteLength / 1024 / 1024).toFixed(1)} MB` : '';
  playNote.textContent = canPlayScenes()
    ? pkg
      ? `${(pkg.bytes.byteLength / 1024 / 1024).toFixed(1)} MB`
      : ''
    : '这个浏览器不支持（需要 WebGL2 与 OffscreenCanvas）';
}

function usePkg(name: string, bytes: ArrayBuffer) {
  pkg = { name, bytes };
  sourceLabel.textContent = `${name} · ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`;
  reset(stillLog, '已载入，等待合成…');
  reset(playLog, '已载入，等待渲染…');
  ready();
  // Listed straight away: choosing what to draw is the point of the page, and
  // having to press a button to discover that is a step in the way.
  void inspectLayers();
}

/* ------------------------------- loading -------------------------------- */

async function loadFromUrl(url = '/scene.pkg') {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error('文件为空');
    usePkg(url.split('/').pop() ?? 'scene.pkg', bytes);
  } catch (err) {
    sourceLabel.textContent = `没有在 ${url} 找到 scene.pkg（${(err as Error).message}）。请手动选择文件。`;
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void file.arrayBuffer().then((bytes) => usePkg(file.name, bytes));
});

reloadButton.addEventListener('click', () => void loadFromUrl());

// Dropping the file anywhere on the page is quicker than the picker.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) void file.arrayBuffer().then((bytes) => usePkg(file.name, bytes));
});

/* -------------------------------- still --------------------------------- */

stillButton.addEventListener('click', () => {
  if (!pkg) return;
  stillButton.disabled = true;
  reset(stillLog, '正在合成…');
  const started = performance.now();

  void (async () => {
    try {
      const still = await renderSceneStill(pkg!.bytes.slice(0), {
        cacheKey: `lab:${pkg!.name}:${pkg!.bytes.byteLength}`,
        // Always render. A cached frame would hide the effect of the very
        // change being tested, and look exactly like a fix that did nothing.
        useCache: false,
        overrides,
      });
      const elapsed = Math.round(performance.now() - started);
      if (stillUrl.current) URL.revokeObjectURL(stillUrl.current);
      stillUrl.current = URL.createObjectURL(still.blob);
      stillImage.src = stillUrl.current;
      say(
        stillLog,
        `完成：${still.width}×${still.height}，绘制 ${still.drawn} 层，解析 ${still.resolved}，跳过 ${still.skipped}，${elapsed} ms，${(still.blob.size / 1024).toFixed(0)} KB`,
        'ok',
      );
    } catch (err) {
      say(stillLog, `合成失败：${(err as Error).message}`, 'bad');
      // The stack is the useful part when a layer cannot be decoded.
      say(stillLog, String((err as Error).stack ?? '').split('\n').slice(0, 4).join(' | '), 'bad');
    } finally {
      ready();
    }
  })();
});


/* ------------------------------- layers --------------------------------- */

/**
 * What the loader kept, what it dropped, and why.
 *
 * A white rectangle in the picture is caused by a layer that should not have
 * been drawn, so the layer responsible is by definition missing from the
 * visible set. Listing the dropped ones with their reasons turns that from a
 * guess into an answer - and the average colour of each kept layer's texture
 * catches the other case, a layer drawn with a texture that is itself blank.
 */
const layerList = $('layer-list');

/**
 * Which layers the person has decided about, by index, kept between visits.
 *
 * The loader's rules are a guess about what Wallpaper Engine would have drawn,
 * and a wrong guess is indistinguishable from a rendering bug. This is the
 * escape hatch: say what you want and see it.
 */
const OVERRIDE_KEY = 'scene-lab-layer-overrides';
const overrides: Record<number, boolean> = (() => {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) ?? '{}') as Record<number, boolean>;
  } catch {
    return {};
  }
})();

function saveOverrides(): void {
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
}

function setOverride(index: number, value: boolean | null): void {
  if (value === null) delete overrides[index];
  else overrides[index] = value;
  saveOverrides();
  // Redrawn from what is already known rather than re-inspected: asking the
  // loader again would re-parse a 45 MB container and decode its textures for
  // every checkbox, which is a second of work per click.
  if (lastRows) renderLayerList(lastRows);
}

interface LayerRow {
  index: number;
  name: string;
  /** What the rules alone decided, before any manual choice. */
  ruleDrawn: boolean;
  reason: string | null;
}

let lastRows: LayerRow[] | null = null;

async function inspectLayers(): Promise<void> {
  if (!pkg) return;
  reset(stillLog, '正在解析图层…');
  try {
    const { parsePkg } = await import('../lib/we-scene/src/pkg/container.js');
    const { parseScene } = await import('../lib/we-scene/src/scene/parse.js');
    const { loadSceneAssets } = await import('../lib/scene/load-browser');

    const container = parsePkg(new Uint8Array(pkg.bytes.slice(0)));
    const entry = container.entries.find((e: { name: string }) => e.name === 'scene.json');
    if (!entry) throw new Error('scene.json 不在容器里');
    const data = new TextDecoder().decode(
      container.buf.subarray(container.dataStart + entry.offset, container.dataStart + entry.offset + entry.size),
    );
    const scene = parseScene(JSON.parse(data));
    // Asked with no overrides, so the list shows what the rules decided and
    // the manual choices are layered on top of that rather than baked in.
    const { hidden, drawn, textures } = await loadSceneAssets(container, scene, {});

    const byIndex = new Map<number, string>();
    for (const h of hidden) byIndex.set(h.index, h.reason);
    const drawnIndex = new Set(drawn.map((d) => d.index));

    const rows: LayerRow[] = scene.layers.map((layer: { name?: string }, index: number) => ({
      index,
      name: String(layer.name ?? ''),
      ruleDrawn: drawnIndex.has(index),
      reason: byIndex.get(index) ?? null,
    }));

    lastRows = rows;
    const willDraw = rows.filter((r) => overrides[r.index] ?? r.ruleDrawn).length;
    reset(stillLog, `共 ${rows.length} 层 · 规则会画 ${drawn.length} · 不画 ${hidden.length} · 纹理 ${textures.size}`);
    say(stillLog, `按当前选择会画 ${willDraw} 层`);
    renderLayerList(rows);
  } catch (err) {
    say(stillLog, `解析失败：${(err as Error).message}`, 'bad');
  }
}

function renderLayerList(rows: LayerRow[]): void {
  layerList.replaceChildren();

  const title = document.createElement('h3');
  title.textContent = '图层（勾选 = 画出来）';
  layerList.append(title);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    '改动会记住，并在下次「取第一帧」或「开始渲染」时生效。带「手动」的图层是你自己决定的，点「自动」还给规则。';
  layerList.append(hint);

  const reset_ = document.createElement('button');
  reset_.type = 'button';
  reset_.textContent = '全部交回规则';
  reset_.style.marginBottom = '8px';
  reset_.addEventListener('click', () => {
    for (const key of Object.keys(overrides)) delete overrides[Number(key)];
    saveOverrides();
    void inspectLayers();
  });
  layerList.append(reset_);

  for (const row of rows) {
    const item = document.createElement('label');
    const manual = overrides[row.index] !== undefined;
    const willDraw = overrides[row.index] ?? row.ruleDrawn;
    item.className = 'layer ' + (willDraw ? 'on' : 'off') + (manual ? ' manual' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = willDraw;
    box.addEventListener('change', () => setOverride(row.index, box.checked));
    item.append(box);

    const meta = document.createElement('span');
    meta.className = 'meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `#${String(row.index).padStart(2, '0')} ${row.name}`;
    meta.append(name);
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = manual ? '手动' : (row.reason ?? '（规则允许，会画出来）');
    meta.append(document.createElement('br'), why);
    item.append(meta);

    if (manual) {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.textContent = '自动';
      auto.style.flex = 'none';
      auto.addEventListener('click', (event) => {
        event.preventDefault();
        setOverride(row.index, null);
      });
      item.append(auto);
    }
    layerList.append(item);
  }
}

layersButton.addEventListener('click', () => void inspectLayers());

/* --------------------------------- live --------------------------------- */

stopButton.addEventListener('click', () => {
  player?.stop();
  player = null;
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
  reset(playLog, '已停止。');
  ready();
});

playButton.addEventListener('click', () => {
  if (!pkg) return;
  playButton.disabled = true;
  reset(playLog, '正在启动 WebGL…');

  // A canvas can only be handed to a worker once, ever, so every start gets a
  // brand new element. Reusing one is what silently broke this in the app.
  const canvas = document.createElement('canvas');
  canvas.id = 'play-canvas';
  playStage.replaceChildren(canvas);

  const started = performance.now();
  void (async () => {
    try {
      const started2 = await playScene(canvas, pkg!.bytes.slice(0), {
        maxWidth: 1920,
        fps: 30,
        overrides,
        onError: (message) => say(playLog, `渲染中途失败：${message}`, 'bad'),
      });
      player = started2;
      const info = started2.info;
      say(
        playLog,
        `已启动：${info.width}×${info.height}，解析 ${info.resolved}，跳过 ${info.skipped}，握手 ${Math.round(performance.now() - started)} ms`,
        'ok',
      );

      // Only the worker's own count is reported. Sampling the placeholder with
      // drawImage looks like it would answer "is it moving", but Chrome hands
      // back the snapshot from the moment the canvas was transferred, so it
      // reads a still picture off a scene that is animating perfectly well.
      // Judge the picture with your eyes; this number says the loop is alive.
      ticker = window.setInterval(() => {
        const status = started2.status();
        if (status.error) {
          say(playLog, `worker 报告错误：${status.error}`, 'bad');
          if (ticker !== null) window.clearInterval(ticker);
          ticker = null;
          return;
        }
        // Two numbers, because one of them lies on its own: frames counts the
        // loop turning, painted counts the picture actually changing.
        say(
          playLog,
          `已绘制 ${status.frames} 帧 · 画面变化 ${status.painted} 次` +
            (status.frames > 60 && status.painted === 0 ? '  ← 循环在跑但画面没变' : ''),
          status.frames > 60 && status.painted === 0 ? 'bad' : 'plain',
        );
      }, 2000);
    } catch (err) {
      say(playLog, `启动失败：${(err as Error).message}`, 'bad');
      say(playLog, String((err as Error).stack ?? '').split('\n').slice(0, 4).join(' | '), 'bad');
    } finally {
      ready();
    }
  })();
});

/* --------------------------------- boot --------------------------------- */

ready();
if (!canRenderScenes()) say(stillLog, '这个浏览器不支持合成（需要 Worker / OffscreenCanvas / createImageBitmap）', 'bad');
void loadFromUrl();
