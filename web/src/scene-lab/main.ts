/**
 * The scene wallpaper test bench.
 *
 * Drives wallpaper-scene-layers directly. The library takes an
 * HTMLCanvasElement rather than an OffscreenCanvas, so this runs on the main
 * thread - and that makes the canvas readable, which is how the motion counter
 * below can be honest about whether the picture is actually changing.
 */

import { createRossiWallpaper, createWallpaper, type Wallpaper } from 'wallpaper-scene-layers';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const fileInput = $<HTMLInputElement>('file');
const sourceLabel = $('source');
const modeSelect = $<HTMLSelectElement>('mode');
const stillButton = $<HTMLButtonElement>('still');
const stillImage = $<HTMLImageElement>('still-img');
const stillLog = $('still-log');
const stillNote = $('still-note');
const playButton = $<HTMLButtonElement>('play');
const stopButton = $<HTMLButtonElement>('stop');
const playCanvas = $<HTMLCanvasElement>('play-canvas');
const playLog = $('play-log');
const playNote = $('play-note');
const reloadButton = $<HTMLButtonElement>('reload');
const layersButton = $<HTMLButtonElement>('layers');
const layerList = $('layer-list');

let pkg: { name: string; bytes: ArrayBuffer } | null = null;
let live: Wallpaper | null = null;
let ticker: number | null = null;
let stillUrl: string | null = null;
/** Layers switched off by hand, by id. */
const hidden = new Set<number>();

function say(target: HTMLElement, line: string, tone: 'plain' | 'ok' | 'bad' = 'plain') {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const cls = tone === 'ok' ? ' class="ok"' : tone === 'bad' ? ' class="bad"' : '';
  target.innerHTML += `\n<span class="muted">${stamp}</span> <span${cls}>${line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</span>`;
  target.scrollTop = target.scrollHeight;
}

const reset = (target: HTMLElement, line: string) => {
  target.innerHTML = line;
};

/** The Rossi preset, or the scene as it comes. */
const rossi = () => modeSelect.value === 'rossi';

function common() {
  return {
    fit: 'cover' as const,
    autoStart: false,
    trackMouse: true,
    onDiagnostic: (message: string) => say(playLog, `诊断：${message}`),
  };
}

function ready() {
  stillButton.disabled = !pkg;
  playButton.disabled = !pkg;
  stopButton.disabled = !live;
  const size = pkg ? `${(pkg.bytes.byteLength / 1024 / 1024).toFixed(1)} MB` : '';
  stillNote.textContent = size;
  playNote.textContent = size;
}

/* ------------------------------- loading -------------------------------- */

function usePkg(name: string, bytes: ArrayBuffer) {
  pkg = { name, bytes };
  hidden.clear();
  sourceLabel.textContent = `${name} · ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB`;
  reset(stillLog, '已载入，等待取帧…');
  reset(playLog, '已载入，等待渲染…');
  layerList.replaceChildren();
  ready();
}

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
  if (file) void file.arrayBuffer().then((bytes) => usePkg(file.name, bytes));
});
reloadButton.addEventListener('click', () => void loadFromUrl());
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) void file.arrayBuffer().then((bytes) => usePkg(file.name, bytes));
});

/* --------------------------------- still -------------------------------- */

stillButton.addEventListener('click', () => {
  if (!pkg) return;
  stillButton.disabled = true;
  reset(stillLog, '正在取帧…');
  const started = performance.now();
  void (async () => {
    try {
      // A canvas of its own: the library attaches to the canvas it is given, and
      // the live one already belongs to whatever is running in the other pane.
      const canvas = document.createElement('canvas');
      canvas.width = 2560;
      canvas.height = 1440;
      const options = { ...common(), canvas, source: pkg!.bytes.slice(0) };
      const wallpaper = rossi() ? await createRossiWallpaper(options) : await createWallpaper(options);
      // One frame, which is exactly what a still is.
      wallpaper.renderFrame(0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('toBlob 返回空');
      if (stillUrl) URL.revokeObjectURL(stillUrl);
      stillUrl = URL.createObjectURL(blob);
      stillImage.src = stillUrl;
      say(
        stillLog,
        `完成：${canvas.width}×${canvas.height}，${wallpaper.layers.length} 层，${((performance.now() - started) / 1000).toFixed(2)} s，${(blob.size / 1024).toFixed(0)} KB`,
        'ok',
      );
      wallpaper.dispose();
    } catch (err) {
      say(stillLog, `取帧失败：${(err as Error).message}`, 'bad');
      say(stillLog, String((err as Error).stack ?? '').split('\n').slice(0, 3).join(' | '), 'bad');
    } finally {
      ready();
    }
  })();
});

/* --------------------------------- live --------------------------------- */

stopButton.addEventListener('click', () => {
  live?.stop();
  live = null;
  if (ticker !== null) window.clearInterval(ticker);
  ticker = null;
  reset(playLog, '已停止。');
  ready();
});

playButton.addEventListener('click', () => {
  if (!pkg) return;
  playButton.disabled = true;
  reset(playLog, '正在加载…');
  const started = performance.now();
  void (async () => {
    try {
      live?.dispose();
      live = null;
      const options = { ...common(), canvas: playCanvas, source: pkg!.bytes.slice(0), autoStart: true };
      const wallpaper = rossi() ? await createRossiWallpaper(options) : await createWallpaper(options);
      live = wallpaper;
      for (const id of hidden) wallpaper.setLayerVisible(id, false);
      say(playLog, `已启动：${wallpaper.layers.length} 层，${((performance.now() - started) / 1000).toFixed(2)} s`, 'ok');
      renderLayers(wallpaper);

      // The canvas is read rather than the frame count watched. This is a real
      // canvas on the main thread, so unlike a transferred one it can be read
      // back honestly - and "the loop is running" is a different claim from
      // "the picture is changing", which is the one that matters.
      let last = '';
      let samples = 0;
      let changes = 0;
      ticker = window.setInterval(() => {
        samples += 1;
        const probe = document.createElement('canvas');
        probe.width = 64;
        probe.height = 36;
        const ctx = probe.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(playCanvas, 0, 0, 64, 36);
        const shot = probe.toDataURL('image/png');
        if (last && shot !== last) changes += 1;
        last = shot;
        const stalled = samples > 3 && changes === 0;
        say(
          playLog,
          `采样 ${samples} 次 · 画面变化 ${changes} 次${stalled ? '  ← 画面没有变化' : ''}`,
          stalled ? 'bad' : 'plain',
        );
      }, 1500);
    } catch (err) {
      say(playLog, `启动失败：${(err as Error).message}`, 'bad');
      say(playLog, String((err as Error).stack ?? '').split('\n').slice(0, 3).join(' | '), 'bad');
    } finally {
      ready();
    }
  })();
});

/* -------------------------------- layers -------------------------------- */

function renderLayers(wallpaper: Wallpaper) {
  layerList.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = `图层（${wallpaper.layers.length} 个，勾选 = 显示）`;
  layerList.append(title);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = '勾选立即生效，不需要重新开始渲染。';
  layerList.append(hint);

  for (const layer of wallpaper.layers) {
    const item = document.createElement('label');
    const on = !hidden.has(layer.id);
    item.className = 'layer ' + (on ? 'on' : 'off');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', () => {
      wallpaper.setLayerVisible(layer.id, box.checked);
      if (box.checked) hidden.delete(layer.id);
      else hidden.add(layer.id);
      item.className = 'layer ' + (box.checked ? 'on' : 'off');
    });
    item.append(box);

    const meta = document.createElement('span');
    meta.className = 'meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `#${layer.id} ${layer.name || layer.type}`;
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = `${layer.type}${layer.visible ? '' : ' · 场景里本来是关闭的'}`;
    meta.append(name, document.createElement('br'), why);
    item.append(meta);
    layerList.append(item);
  }
}

layersButton.addEventListener('click', () => {
  if (live) renderLayers(live);
  else say(stillLog, '先开始渲染——图层清单来自正在运行的壁纸。', 'bad');
});

/* --------------------------------- boot --------------------------------- */

ready();
modeSelect.addEventListener('change', () => {
  hidden.clear();
  reset(playLog, rossi() ? '已切到洛茜预设，重新开始渲染生效。' : '已切到通用加载，重新开始渲染生效。');
});
void loadFromUrl();
