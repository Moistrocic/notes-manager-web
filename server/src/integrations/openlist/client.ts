/**
 * HTTP client for the public OpenList REST API.
 *
 * This file is original TypeScript written for this project. It is an
 * independent *client* of OpenList: it speaks the documented HTTP endpoints
 * (`/api/fs/list`, `/api/fs/put`, `/api/auth/login`, ...) and contains no
 * OpenList source code. OpenList itself is a separate Go project under the
 * AGPL-3.0 and is neither bundled nor redistributed here - it is only ever
 * reached over the network. Implementing a client for a public network
 * interface does not create a derivative work, so this project stays MIT
 * licensed.
 *
 * See the licence section of the README for the full explanation.
 */
import { createLogger } from '../../logger.js';

const log = createLogger('openlist');

export class OpenListError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly target?: string,
  ) {
    super(message);
    this.name = 'OpenListError';
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isUnreachable(): boolean {
    return this.status === 0;
  }
}

export interface OpenListFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created: string;
  sign?: string;
  thumb?: string;
  type?: number;
  hashinfo?: string;
}

export interface OpenListListResult {
  content: OpenListFile[];
  total: number;
  write: boolean;
  provider?: string;
}

export interface OpenListFileInfo extends OpenListFile {
  raw_url?: string;
  readme?: string;
  provider?: string;
}

export interface OpenListUser {
  id: number;
  username: string;
  base_path?: string;
  role: number;
  permission: number;
  disabled?: boolean;
  otp?: boolean;
  sso_id?: string;
}

export interface OpenListClientOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  headers?: Record<string, string>;
  body?: Uint8Array | string | null;
  timeoutMs?: number;
  expectJson?: boolean;
  token?: string | null;
}

const USER_AGENT = 'notes-manager-web/1.0 (+https://github.com/)';

export class OpenListClient {
  readonly baseUrl: string;
  private token: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: OpenListClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token || undefined;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  }

  setToken(token: string | undefined): void {
    this.token = token || undefined;
  }

  /** True when requests carry an OpenList token (user session or API token). */
  get hasToken(): boolean {
    return Boolean(this.token);
  }

  withToken(token: string | undefined): OpenListClient {
    return new OpenListClient({ baseUrl: this.baseUrl, token, timeoutMs: this.timeoutMs });
  }

  private buildUrl(pathname: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async request<T>(pathname: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, json, headers = {}, body, expectJson = true } = options;
    const token = options.token === undefined ? this.token : options.token ?? undefined;
    const url = this.buildUrl(pathname, query);
    const finalHeaders: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': USER_AGENT,
      ...headers,
    };
    if (token) finalHeaders.Authorization = token;
    if (json !== undefined) finalHeaders['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: json !== undefined ? JSON.stringify(json) : (body ?? undefined),

        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
        redirect: 'follow',
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      const detail = cause?.code || cause?.message || (err as Error).message;
      throw new OpenListError(`OpenList is unreachable (${detail})`, 0, undefined, url);
    }

    if (!expectJson) {
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new OpenListError(`OpenList request failed: ${response.status} ${text.slice(0, 200)}`, response.status, undefined, url);
      }
      return undefined as T;
    }

    const text = await response.text();
    let payload: { code?: number; message?: string; data?: unknown } | null = null;
    try {
      payload = text ? (JSON.parse(text) as { code?: number; message?: string; data?: unknown }) : null;
    } catch {
      payload = null;
    }

    if (!payload) {
      if (!response.ok) {
        throw new OpenListError(`OpenList request failed (${response.status})`, response.status, undefined, url);
      }
      throw new OpenListError('OpenList returned a non-JSON response - is the URL pointing at an OpenList instance?', response.status, undefined, url);
    }

    const code = payload.code ?? response.status;
    if (code !== 200) {
      throw new OpenListError(payload.message || `OpenList error ${code}`, response.status, code, url);
    }
    return payload.data as T;
  }

  /* ----------------------------- system ---------------------------------- */

  /**
   * Health check.
   *
   * The probe deliberately starts with `/api/public/settings`, which every
   * OpenList release answers with JSON. It must NOT start with
   * `/api/public/init_status`: that route was added after v4.2.6, and on older
   * builds it falls through to the SPA fallback and answers `index.html` with
   * HTTP 200 - which looks exactly like "not an OpenList server".
   */
  async ping(): Promise<{ ok: boolean; initialized: boolean; siteTitle?: string; version?: string; error?: string }> {
    const probeTimeout = Math.min(this.timeoutMs, 6000);
    try {
      const settings = await this.request<Record<string, unknown>>('/api/public/settings', { timeoutMs: probeTimeout });
      const siteTitle = typeof settings?.site_title === 'string' ? settings.site_title : undefined;
      const version = typeof settings?.version === 'string' ? settings.version : undefined;

      // Optional: only newer builds expose it. When it is missing we simply
      // assume the instance is usable instead of reporting a false negative.
      let initialized = true;
      try {
        const init = await this.request<{ initialized?: boolean }>('/api/public/init_status', { timeoutMs: probeTimeout });
        if (typeof init?.initialized === 'boolean') initialized = init.initialized;
      } catch {
        /* route not available in this OpenList build */
      }

      return { ok: true, initialized, siteTitle, version };
    } catch (err) {
      if (err instanceof OpenListError) {
        return { ok: false, initialized: false, error: err.message };
      }
      return { ok: false, initialized: false, error: (err as Error).message };
    }
  }

  async publicSettings(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/public/settings');
  }

  /* ------------------------------ auth ----------------------------------- */

  async login(username: string, password: string, otpCode?: string): Promise<string> {
    const data = await this.request<{ token: string }>('/api/auth/login', {
      method: 'POST',
      json: { username, password, otp_code: otpCode ?? '' },
    });
    if (!data?.token) throw new OpenListError('OpenList did not return a token', 500);
    return data.token;
  }

  async me(): Promise<OpenListUser> {
    return this.request<OpenListUser>('/api/me');
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout');
    } catch (err) {
      log.debug('logout failed:', (err as Error).message);
    }
  }

  /* ------------------------------- fs ------------------------------------ */

  async list(dir: string, opts: { refresh?: boolean; page?: number; perPage?: number } = {}): Promise<OpenListListResult> {
    const data = await this.request<OpenListListResult>('/api/fs/list', {
      method: 'POST',
      json: {
        path: dir,
        password: '',
        page: opts.page ?? 1,
        per_page: opts.perPage ?? 0,
        refresh: opts.refresh ?? false,
      },
    });
    return {
      content: Array.isArray(data?.content) ? data.content : [],
      total: typeof data?.total === 'number' ? data.total : (data?.content?.length ?? 0),
      write: Boolean(data?.write),
      provider: data?.provider,
    };
  }

  async get(filePath: string): Promise<OpenListFileInfo> {
    return this.request<OpenListFileInfo>('/api/fs/get', {
      method: 'POST',
      json: { path: filePath, password: '' },
    });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await this.get(filePath);
      return true;
    } catch (err) {
      if (err instanceof OpenListError && (err.status === 404 || err.code === 404 || /not found|object not found/i.test(err.message))) {
        return false;
      }
      if (err instanceof OpenListError && err.status >= 400 && err.status < 500) return false;
      if (err instanceof OpenListError && err.status === 500 && /not found/i.test(err.message)) return false;
      throw err;
    }
  }

  /** Reads a text file by resolving its `raw_url` through `/api/fs/get`. */
  async readText(filePath: string): Promise<string> {
    const info = await this.get(filePath);
    if (info.is_dir) throw new OpenListError(`${filePath} is a directory`, 400);
    const rawUrl = info.raw_url;
    if (!rawUrl) throw new OpenListError(`OpenList returned no download URL for ${filePath}`, 500);

    // `raw_url` can be relative when the site URL is not configured.
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${this.baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        signal: AbortSignal.timeout(Math.max(this.timeoutMs, 30000)),
        redirect: 'follow',
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new OpenListError(`Failed to download ${filePath}: ${cause?.code || cause?.message || (err as Error).message}`, 0, undefined, url);
    }
    if (!response.ok) {
      throw new OpenListError(`Failed to download ${filePath}: HTTP ${response.status}`, response.status, undefined, url);
    }
    return response.text();
  }

  /** Reads a text file through the OpenList proxy endpoint (`/p/...`), which always works for text. */
  async readTextViaProxy(filePath: string): Promise<string> {
    const encoded = filePath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const url = this.buildUrl(`/p${encoded}`, { d: '' });
    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.token ? { Authorization: this.token, 'User-Agent': USER_AGENT } : { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(Math.max(this.timeoutMs, 30000)),
        redirect: 'follow',
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause;
      throw new OpenListError(`Failed to download ${filePath}: ${cause?.code || cause?.message || (err as Error).message}`, 0, undefined, url);
    }
    if (!response.ok) {
      throw new OpenListError(`Failed to download ${filePath}: HTTP ${response.status}`, response.status, undefined, url);
    }
    return response.text();
  }

  async put(filePath: string, content: string | Uint8Array, opts: { contentType?: string; modified?: Date; overwrite?: boolean } = {}): Promise<void> {
    const body: Uint8Array = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await this.request('/api/fs/put', {
      method: 'PUT',
      headers: {
        'File-Path': encodeURIComponent(filePath),
        'Content-Type': opts.contentType ?? 'text/markdown; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Last-Modified': String((opts.modified ?? new Date()).getTime()),
        Overwrite: opts.overwrite === false ? 'false' : 'true',
      },
      body,
      timeoutMs: Math.max(this.timeoutMs, 30000),
    });
  }

  async mkdir(dirPath: string): Promise<void> {
    try {
      await this.request('/api/fs/mkdir', { method: 'POST', json: { path: dirPath } });
    } catch (err) {
      // Creating an existing directory is not an error for our callers.
      if (err instanceof OpenListError && /exist/i.test(err.message)) return;
      throw err;
    }
  }

  async remove(dir: string, names: string[]): Promise<void> {
    await this.request('/api/fs/remove', { method: 'POST', json: { dir, names } });
  }

  async rename(filePath: string, newName: string): Promise<void> {
    await this.request('/api/fs/rename', { method: 'POST', json: { path: filePath, name: newName } });
  }

  async move(srcDir: string, dstDir: string, names: string[]): Promise<void> {
    await this.request('/api/fs/move', { method: 'POST', json: { src_dir: srcDir, dst_dir: dstDir, names } });
  }

  /** Recursively ensures every directory of `dirPath` exists. */
  async ensureDir(dirPath: string): Promise<void> {
    const segments = dirPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      await this.mkdir(current);
    }
  }
}
