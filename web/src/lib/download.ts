/**
 * Reading a response while saying how far along it is.
 *
 * A wallpaper is tens of megabytes, and `arrayBuffer()` resolves once at the
 * end knowing nothing in between - which is a long silence on a remote server.
 * The length header is what makes a percentage possible, and it is treated as
 * optional throughout: a proxy is allowed to drop it, and then the count of
 * bytes is all anyone can honestly report.
 */

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
export async function fetchWithProgress(url: string, onProgress?: DownloadProgress): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  return readWithProgress(response, onProgress);
}