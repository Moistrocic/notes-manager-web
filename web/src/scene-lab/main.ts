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
        say(playLog, `已绘制 ${status.frames} 帧`);
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
