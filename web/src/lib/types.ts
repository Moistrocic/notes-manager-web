export interface NoteSummary {
  id: string;
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

export interface TagCount {
  tag: string;
  count: number;
}

export interface FolderCount {
  path: string;
  name: string;
  count: number;
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
}

export interface NotesPayload {
  notes: NoteSummary[];
  stats: NoteStats;
  tags: TagCount[];
  folders: FolderCount[];
}

export interface AuthProviders {
  local: boolean;
  openlist: boolean;
  openlistConfigured: boolean;
  openlistUrl: string | null;
  openlistInitialized: boolean;
  /** Why the probe failed (e.g. "connect ECONNREFUSED 127.0.0.1:5244"). */
  openlistError?: string | null;
}

export interface AppSettingsPayload {
  settings: {
    storage: {
      driver: 'auto' | 'openlist' | 'local';
      openlist: { url: string; token: string; root: string; perUser: boolean; timeoutMs: number };
      local: { root: string };
    };
  };
  effective: {
    storage: {
      driver: 'auto' | 'openlist' | 'local';
      openlist: { url: string; token: string; root: string; perUser: boolean; timeoutMs: number };
      local: { root: string };
    };
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
