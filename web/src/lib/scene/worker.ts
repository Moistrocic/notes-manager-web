/**
 * One worker for everything a scene wallpaper needs.
 *
 * Both jobs are here because both parse the same 45 MB container once: the
 * still (composited on the CPU, seconds of work) and the live scene (WebGL on
 * an OffscreenCanvas the page handed over). Keeping them in one worker means a
 * wallpaper change parses once, off the main thread, either way.
 */

import type { SceneRequest, SceneResponse } from './protocol';

let worker: Worker | null = null;
let nextId = 1;

export function nextRequestId(): number {
  nextId += 1;
  return nextId;
}

export function getSceneWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./scene.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export function disposeSceneWorker(): void {
  worker?.terminate();
  worker = null;
}

/** Resolves with the first reply carrying this id, or rejects on a worker fault. */
export function awaitReply<T extends SceneResponse>(id: number, target: Worker): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent<T>) => {
      if (event.data?.id !== id) return;
      target.removeEventListener('message', onMessage as EventListener);
      target.removeEventListener('error', onError);
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      target.removeEventListener('message', onMessage as EventListener);
      target.removeEventListener('error', onError);
      reject(new Error(event.message || '场景渲染线程出错'));
    };
    target.addEventListener('message', onMessage as EventListener);
    target.addEventListener('error', onError);
  });
}

export function send(request: SceneRequest, transfer: Transferable[] = []): void {
  getSceneWorker().postMessage(request, transfer);
}
