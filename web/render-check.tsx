/**
 * Render smoke test: mounts the whole component tree in Node to catch
 * import-time and first-render errors (the app itself runs in the browser).
 *
 *   npm run check:render
 */
import { renderToString } from 'react-dom/server';
import App from './src/App';
import { appStore } from './src/store/useAppStore';
import type { Note, SessionUser, StorageStatus, SystemStatus } from './src/lib/types';

const note: Note = {
  id: 'render-check',
  title: '渲染检查笔记',
  tags: ['check', '渲染'],
  pinned: true,
  favorite: true,
  color: '#8b6cff',
  folder: '',
  path: '/render-check.md',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  excerpt: '用于验证组件树可以正常渲染。',
  wordCount: 12,
  size: 128,
  hasFrontMatter: true,
  deletedAt: null,
  originFolder: null,
  content: '# 标题\n\n- 项目一\n- 项目二\n\n```js\nconst a = 1;\n```\n',
};

const user: SessionUser = {
  sid: 'render',
  id: 'local:admin',
  username: 'admin',
  displayName: 'admin',
  role: 'admin',
  provider: 'local',
  permissions: { write: true, rename: true, move: true, remove: true },
  createdAt: Date.now(),
  expiresAt: Date.now() + 3600_000,
};

const storage: StorageStatus = {
  driver: 'openlist',
  mode: 'auto',
  displayRoot: '/notes',
  degraded: false,
  detail: 'Connected to OpenList',
  openlist: { configured: true, url: 'http://127.0.0.1:5244', reachable: true, initialized: true, version: 'v4.0.0', checkedAt: Date.now() },
  localRoot: '/var/lib/notes-manager/notes',
  perUser: false,
  tokenAttached: true,
};

const status: SystemStatus = {
  version: '1.0.0',
  basePath: '',
  publicUrl: '',
  uptimeSeconds: 12,
  storage,
  providers: { local: true, openlist: true, openlistInitialized: true, openlistSiteTitle: 'OpenList' },
  user,
};

interface Scenario {
  name: string;
  state: Record<string, unknown>;
  expect: string[];
  /** Markup that must NOT be present (panes that were hidden). */
  absent?: string[];
}

const providers = {
  local: true,
  openlist: true,
  openlistConfigured: true,
  openlistUrl: 'http://127.0.0.1:5244',
  openlistInitialized: true,
  guest: false,
};

const capabilities = {
  driver: 'openlist' as const,
  root: '/notes',
  writable: true,
  permissions: { write: true, rename: true, move: true, remove: true },
};

const scenarios: Scenario[] = [
  {
    name: 'boot / splash',
    state: { booted: false, user: null },
    expect: ['笔记管理面板', 'aurora'],
  },
  {
    name: 'login screen (with OpenList guest access)',
    state: { booted: true, user: null, providers: { ...providers, guest: true } },
    expect: ['登录工作台', 'OpenList 账户', '进入工作台', '以游客身份浏览', '游客访问已开启'],
  },
  {
    name: 'workspace: editor + merged left panel + outline',
    state: {
      booted: true,
      user,
      status,
      providers,
      notes: [note],
      tags: [{ tag: 'check', count: 1 }],
      folders: [{ path: '工作', name: '工作', count: 0 }],
      stats: { notes: 1, tags: 2, folders: 1, words: 12, updatedAt: note.updated },
      capabilities,
      activeId: note.id,
      activeNote: note,
      editorMode: 'edit',
      metaOpen: true,
      sidebarOpen: true,
    },
    expect: ['渲染检查笔记', 'outline-panel', '新建笔记', '置顶'],
  },
  {
    name: 'workspace: no note selected (merged left panel visible)',
    state: {
      booted: true,
      user,
      status,
      providers,
      notes: [note],
      tags: [{ tag: 'check', count: 1 }],
      folders: [],
      stats: { notes: 1, tags: 1, folders: 0, words: 12, updatedAt: note.updated },
      capabilities,
      activeId: null,
      activeNote: null,
      sidebarOpen: true,
      navOpen: true,
    },
    // The storage card is gone; where notes live is a badge beside the version
    // now, and the connection detail is in the server settings.
    expect: ['笔记管理面板', '导航', '搜索笔记、标签', '全部笔记', '文件夹', 'OpenList'],
  },
  {
    name: 'workspace: read-only account',
    state: {
      booted: true,
      user: {
        ...user,
        provider: 'openlist',
        role: 'user',
        openlistGuest: true,
        permissions: { write: false, rename: false, move: false, remove: false },
      },
      status,
      providers,
      notes: [note],
      capabilities: { ...capabilities, writable: false, permissions: { write: false, rename: false, move: false, remove: false } },
      activeId: note.id,
      activeNote: note,
      editorMode: 'edit',
      metaOpen: true,
    },
    expect: ['只读', '没有写入权限', '渲染检查笔记'],
  },
  {
    name: 'workspace: outline hidden leaves no pane behind',
    state: {
      booted: true,
      user,
      status,
      providers,
      notes: [note],
      stats: { notes: 1, tags: 0, folders: 0, words: 12, updatedAt: note.updated },
      capabilities,
      activeId: note.id,
      activeNote: note,
      // 'edit' keeps the markdown preview out of the picture: DOMPurify needs a
      // real DOM, which this Node renderer does not provide.
      editorMode: 'edit',
      metaOpen: false,
    },
    expect: ['渲染检查笔记'],
    absent: ['outline-panel'],
  },
  {
    name: 'workspace: focus mode hides the list and the toolbars',
    state: {
      booted: true,
      user,
      status,
      providers,
      notes: [note],
      stats: { notes: 1, tags: 0, folders: 0, words: 12, updatedAt: note.updated },
      capabilities,
      activeId: note.id,
      activeNote: note,
      editorMode: 'edit',
      focusMode: true,
      sidebarOpen: false,
      metaOpen: false,
    },
    // Focus mode keeps only the mini bar: no title row, no tag row, no toolbar.
    expect: ['退出专注模式', '显示大纲'],
    absent: ['outline-panel', '更新于', '笔记标题', '添加标签'],
  },
  {
    name: 'workspace: list hidden shows a way back',
    state: {
      booted: true,
      user,
      status,
      providers,
      notes: [note],
      stats: { notes: 1, tags: 0, folders: 0, words: 12, updatedAt: note.updated },
      capabilities,
      activeId: null,
      activeNote: null,
      sidebarOpen: false,
      focusMode: false,
    },
    expect: ['显示列表', '你好'],
  },
  {
    name: 'command palette + dialogs',
    state: {
      paletteOpen: true,
      settingsOpen: true,
      trashOpen: true,
      metaOpen: false,
      trash: [{ ...note, deletedAt: note.updated }],
    },
    expect: ['存储与服务器设置', '回收站', '搜索笔记或输入命令', '显示大纲'],
  },
];

// zustand exposes `getInitialState()` as the server snapshot, which React uses
// during `renderToString`. Point it at the live state so each scenario renders
// the state we just set (this is a test-only shim).
appStore.getInitialState = () => appStore.getState();

let failed = 0;
for (const scenario of scenarios) {
  appStore.setState(scenario.state as never);
  try {
    const html = renderToString(<App />);
    const missing = scenario.expect.filter((needle) => !html.includes(needle));
    const unexpected = (scenario.absent ?? []).filter((needle) => html.includes(needle));
    if (missing.length === 0 && unexpected.length === 0) {
      console.log(`  ok    ${scenario.name} (${html.length} bytes)`);
    } else {
      failed += 1;
      const parts: string[] = [];
      if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
      if (unexpected.length) parts.push(`should be hidden: ${unexpected.join(', ')}`);
      console.log(`  FAIL  ${scenario.name} - ${parts.join(' | ')}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${scenario.name} - ${(err as Error).message}`);
  }
}

console.log(failed === 0 ? '\nRender check passed' : `\n${failed} scenario(s) failed`);
process.exit(failed === 0 ? 0 : 1);