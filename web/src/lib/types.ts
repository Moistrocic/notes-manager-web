import type { BackgroundOptions } from './admin-background';

/**
 * What a file in the notes tree is.
 *
 * The panel started as a markdown editor, but a note refers to pictures, and
 * those live beside it in the same folders - so the tree lists every file and
 * this says which of them the editor has any business opening.
 */
export type EntryKind = 'note' | 'image' | 'file';

export interface NoteSummary {
  id: string;
  kind: EntryKind;
  /** Published to the blog, and when it was. */
  blog: boolean;
  blogAt: string | null;
  title: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  color: string | null;
  folder: string;
  path: string;
  created: string;
  updated: string;
  excerpt: string;
  wordCount: number;
  size: number;
  hasFrontMatter: boolean;
  deletedAt?: string | null;
  originFolder?: string | null;
}

export interface Note extends NoteSummary {
  content: string;
}

/** One card on the blog: a published note, without its body. */
export interface BlogPostSummary {
  id: string;
  /** Storage path, which is also the address of its page. */
  path: string;
  title: string;
  /**
   * The opening of the note, as markdown.
   *
   * Markdown rather than plain text because the card renders it: a summary
   * that starts with a list or a bold sentence should look like one.
   */
  summary: string;
  publishedAt: string;
  updatedAt: string;
  wordCount: number;
  tags: string[];
}

export interface BlogPost extends BlogPostSummary {
  content: string;
}

export interface BlogIndexPayload {
  /** Whether the blog is on at all; when it is not, the site shows the panel. */
  enabled: boolean;
  title: string;
  posts: BlogPostSummary[];
}

export interface BlogPostPayload {
  enabled: boolean;
  post: BlogPost;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface FolderCount {
  path: string;
  name: string;
  /** Notes directly inside this folder. */
  count: number;
  /** Nesting level, 0 for a top level folder. */
  depth: number;
}

export interface NoteStats {
  notes: number;
  tags: number;
  folders: number;
  words: number;
  updatedAt: string | null;
}

export interface SessionUser {
  sid: string;
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  provider: 'local' | 'openlist';
  openlistBasePath?: string;
  openlistIsAdmin?: boolean;
  /** Nobody signed in: a visitor browsing read-only. */
  guest?: boolean;
  /** Anonymous OpenList visitor (no credentials). */
  openlistGuest?: boolean;
  permissions?: { write: boolean; rename: boolean; move: boolean; remove: boolean };
  createdAt: number;
  expiresAt: number;
}

export interface ProbeResult {
  configured: boolean;
  url: string;
  reachable: boolean;
  initialized: boolean;
  siteTitle?: string;
  version?: string;
  error?: string;
  checkedAt: number;
}

export interface StorageStatus {
  driver: 'openlist' | 'local';
  mode: 'auto' | 'openlist' | 'local';
  displayRoot: string;
  degraded: boolean;
  detail: string;
  openlist: ProbeResult;
  localRoot: string;
  perUser: boolean;
  tokenAttached: boolean;
}

export interface SystemStatus {
  version: string;
  basePath: string;
  publicUrl: string;
  uptimeSeconds: number;
  storage: StorageStatus;
  providers: {
    local: boolean;
    openlist: boolean;
    openlistInitialized: boolean;
    openlistSiteTitle: string | null;
  };
  user: SessionUser | null;
  /** Read before signing in: the site's front page needs to know what it is. */
  blog: { enabled: boolean };
}

export interface NotesPayload {
  notes: NoteSummary[];
  stats: NoteStats;
  tags: TagCount[];
  folders: FolderCount[];
  capabilities?: NoteCapabilities;
  user?: {
    username: string;
    provider: 'local' | 'openlist';
    role: 'admin' | 'user';
    guest: boolean;
    permissions: NoteCapabilities['permissions'];
    basePath: string | null;
  } | null;
}

export interface AuthProviders {
  local: boolean;
  openlist: boolean;
  openlistConfigured: boolean;
  openlistUrl: string | null;
  openlistInitialized: boolean;
  /** Why the probe failed (e.g. "connect ECONNREFUSED 127.0.0.1:5244"). */
  openlistError?: string | null;
  /** True when OpenList accepts anonymous visitors. */
  guest: boolean;
}

export interface FontRecord {
  id: string;
  /** Display name, also used as the CSS family. */
  name: string;
  fileName: string;
  format: 'woff2' | 'woff' | 'truetype' | 'opentype';
  size: number;
  uploadedAt: string;
}

export interface FontSelection {
  /** Font id used for the interface, empty for the built-in stack. */
  sans: string;
  /** Font id used for the editor and code, empty for the built-in stack. */
  mono: string;
}

/** A folder waiting in the trash, recoverable until the trash is emptied. */
export interface TrashedFolder {
  path: string;
  name: string;
  originalPath: string;
  deletedAt: string;
}

export interface NoteCapabilities {
  driver: 'openlist' | 'local';
  root: string;
  /** The backend says the notes folder can be written to. */
  writable: boolean;
  permissions: {
    write: boolean;
    rename: boolean;
    move: boolean;
    remove: boolean;
  } | null;
}

/** What the server stores about the administrator's default background. */
export interface BackgroundSettings extends BackgroundOptions {
  kind: 'off' | 'aurora' | 'image' | 'video' | 'scene';
  file: string;
  note: string;
}

export interface AppSettingsPayload {
  settings: {
    storage: {
      driver: 'auto' | 'openlist' | 'local';
      openlist: { url: string; token: string; root: string; perUser: boolean; timeoutMs: number };
      local: { root: string };
    };
    background: BackgroundSettings;
    guest: { enabled: boolean };
    blog: { enabled: boolean };
  };
  effective: {
    storage: {
      driver: 'auto' | 'openlist' | 'local';
      openlist: { url: string; token: string; root: string; perUser: boolean; timeoutMs: number };
      local: { root: string };
    };
    background: BackgroundSettings;
    guest: { enabled: boolean };
    blog: { enabled: boolean };
    sources: Record<string, 'env' | 'file' | 'default'>;
  };
  paths: {
    projectRoot: string;
    dataDir: string;
    localNotesRoot: string;
    /** Configuration file the running process actually reads. */
    envFile: string;
    envFileLoaded: boolean;
  };
  env: {
    storageDriver: string | null;
    openlistUrl: string | null;
    openlistTokenSet: boolean;
    openlistRoot: string | null;
    notesRoot: string | null;
  };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}
