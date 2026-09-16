/**
 * Reading a response while saying how far along it is, and remembering what
 * was read.
 *
 * A wallpaper is tens of megabytes, and `arrayBuffer()` resolves once at the
 * end knowing nothing in between - which is a long silence on a remote server.
 * The length header is what makes a percentage possible, and it is treated as
 * optional throughout: a proxy is allowed to drop it, and then the count of
 * bytes is all anyone can honestly report.
 *
 * Two things stop the same file being fetched twice. The container cache keeps
 * the one wallpaper in use, under the fingerprint the server gave for its
 * contents, so a visit that changes nothing is a read from disk. And a download
 * already running is joined rather than started again: the layer's effect can
 * run more than once while the application is still settling, and a second 45 MB
 * request competing with the first is what a slow wallpaper looks like.
 */
import { idbGet, idbPut } from './wallpaper';

/** How far a download has got, when the server says how big it is. */
export type DownloadProgress = (loaded: number, total: number | null) => void;

/** Reads a response body in chunks, reporting each one as it lands. */
export async function readWithProgress(response: Response, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  const total = Number(response.headers.get('content-length')) || null;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, total);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** The same, for a URL: fetches it and fails the way a fetch should. */
export async function fetchWithProgress(
  url: string,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  return readWithProgress(response, onProgress);
}

/** One wallpaper container, kept under the fingerprint of its contents. */
const CONTAINER_KEY = 'scene-container';

interface CachedContainer {
  identity: string;
  blob: Blob;
}

interface RunningDownload {
  promise: Promise<ArrayBuffer>;
  listeners: Set<DownloadProgress>;
  /** The last thing the readers were told, for anyone joining late. */
  last: [number, number | null] | null;
}

/** Downloads in progress, so two callers who want the same bytes wait together. */
const running = new Map<string, RunningDownload>();

/**
 * The container, from the browser's own copy when it is the same one.
 *
 * @param identity what the bytes are - a content hash, or a file's name, size
 *   and timestamp. Without one this is a plain download: a bare URL can serve
 *   something else tomorrow, and nothing here would know.
 */
export async function fetchContainer(
  url: string,
  identity: string | null,
  onProgress?: DownloadProgress,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!identity) return fetchWithProgress(url, onProgress, signal);

  const remembered = await idbGet<CachedContainer>(CONTAINER_KEY);
  if (remembered?.blob && remembered.identity === identity) {
    // Said as finished progress, so a caller that shows a bar does not sit at
    // zero while the bytes are read off the disk.
    onProgress?.(remembered.blob.size, remembered.blob.size);
    return remembered.blob.arrayBuffer();
  }

  const existing = running.get(identity);
  if (existing) {
    if (onProgress) {
      existing.listeners.add(onProgress);
      if (existing.last) onProgress(existing.last[0], existing.last[1]);
    }
    return existing.promise;
  }

  const entry: RunningDownload = {
    listeners: new Set(onProgress ? [onProgress] : []),
    last: null,
    promise: Promise.resolve(new ArrayBuffer(0)),
  };
  entry.promise = fetchWithProgress(
    url,
    (loaded, total) => {
      entry.last = [loaded, total];
      for (const listener of [...entry.listeners]) listener(loaded, total);
    },
    signal,
  )
    .then((bytes) => {
      // One record, replaced rather than added to: only the wallpaper in use is
      // worth 45 MB of somebody's disk, and the one it replaces is not.
      void idbPut(CONTAINER_KEY, { identity, blob: new Blob([bytes]) } satisfies CachedContainer);
      return bytes;
    })
    .finally(() => running.delete(identity));
  running.set(identity, entry);
  return entry.promise;
}