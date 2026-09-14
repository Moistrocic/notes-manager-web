# 笔记管理面板 · notes-manager-web

一个现代化、带动画的 Markdown 笔记管理面板。笔记**直接存放在 OpenList 目录**中，
支持**使用 OpenList 账户登录**；服务器上**没有安装 OpenList 时也能正常运行**（自动回落本地磁盘）。

> 前端 React 19 + Vite 7 + Tailwind CSS v4 + Framer Motion + CodeMirror 6
> 后端 Node.js + Express 5 + TypeScript（零外部数据库，状态保存在 JSON 文件里）

---

## 目录

- [功能特性](#功能特性)
- [与 OpenList 的联动](#与-openlist-的联动)
- [快速开始（本地开发）](#快速开始本地开发)
- [一键安装 / 卸载（Linux 服务器）](#一键安装--卸载linux-服务器)
- [配置项参考](#配置项参考)
- [HTTP API](#http-api)
- [目录结构](#目录结构)
- [常见问题](#常见问题)

---

## 功能特性

**界面**

- 两栏工作台：**左侧导航与笔记列表合并为一栏**（可整体隐藏），右侧为编辑器 + 可折叠大纲面板
- 列表三种视图：卡片列表 / 网格 / **紧凑（仅标题）**；嵌套文件夹以树形展示，支持创建 `a/b/c` 多级目录
- **专注模式**：一键隐藏列表与笔记上方的三排工具栏，只留迷你操作条（⌘ 视图切换 / 大纲 / 退出），`Esc` 退出
- 编辑/预览分栏**可拖动**，双击分隔条恢复居中；点击大纲会**同时**滚动编辑区与预览区并在预览中高亮落点
- **深链与锚点**：地址栏始终反映当前笔记与其位置，形如
  `https://example.com/public/Notes/Readme.md#11-分层`；可直接分享，浏览器前进/后退可逐篇回退，
  笔记内的 `[文字](#锚点)` 与 `[文字](./另一篇.md)` 均可点击跳转
- 深色 / 浅色主题，动态极光背景，玻璃拟态面板，全流程 Framer Motion 动画
- **字体**：内置 **Cascadia Code**（随安装包一起部署，代码字体默认就是它，开箱即用，无需联网下载）；
  管理员还可以上传 woff2 / woff / ttf / otf，分别指定界面字体与代码字体，
  上传的文件存放在服务器数据目录，**重启后依然生效**
- **壁纸**：支持**本地壁纸库**（直接读取你电脑上已有的壁纸文件夹，比如 Wallpaper Engine 的
  `steamapps/workshop/content/431960`，缩略图网格挑选）、图片链接、单个本地图片或本地视频（静音循环），
  可调模糊 / 暗度 / 缩放。纯前端实现——文件存在浏览器 IndexedDB，不上传服务器，人人可用
  （列表布局动画、卡片入场错峰、模态弹簧过渡、Toast 堆叠）
- CodeMirror 6 编辑器：Markdown 语法高亮、行号、括号匹配、搜索、自动换行
- 代码块**按语言高亮**（VS Code Dark+ / Light+ 配色）：```ts```、```python``` 等 140+ 种语言，
  语法包按需加载，只有笔记里真正用到的才下载
- 编辑 / 分栏 / 预览三种模式，Markdown 实时预览（GFM、表格、任务列表、代码高亮）
- 命令面板（`Ctrl/⌘ + K`）、全文检索（`/` 聚焦）、快捷键、Toast 撤销
- 自动保存：**先比对再保存**——内容没有实际变化时不会写入（打开笔记、编辑器回显、
  失焦都不会触发），把改动改回原样还会取消待保存；防抖 900ms + 状态指示
- 置顶 / 收藏 / 颜色标记 / 标签 / 嵌套文件夹
- 回收站：删除 → 撤销 → 恢复 → 彻底删除

**数据**

- 笔记就是普通 Markdown 文件，带 YAML front matter，可直接在 OpenList 里查看、编辑、同步
- 双向兼容：手动放进目录的 `.md` 文件会被自动识别（无 front matter 也能解析）
- 存储层抽象：OpenList 驱动 / 本地磁盘驱动，一次请求内按用户解析（每个用户用自己的 OpenList 令牌）
- 内存缓存按「大小 + 修改时间」失效，列表刷新只做一次目录请求

**安全**

- 会话保存在服务端，Cookie `HttpOnly` + `SameSite=Lax`，支持反向代理下的 `Secure`
- 本地管理员密码使用 scrypt 加盐哈希；无公开注册接口
- 状态变更请求校验 `Origin`，路径规范化防止目录穿越
- 存储层支持「每个用户独立子目录」

---

## 与 OpenList 的联动

本项目基于 [OpenList](https://github.com/OpenListTeam/OpenList) 的 HTTP API 实现，
兼容 OpenList v4 及其上游 AList 的接口（`/api/auth/login`、`/api/fs/*`、`/p/*` 等）。

### 1. 使用 OpenList 账户登录

- 登录页可选择「OpenList 账户 / 本地管理员 / 自动」
- 后端调用 `POST /api/auth/login` 拿到令牌，再 `GET /api/me` 读取账户信息
- 支持 OpenList 的两步验证（返回 `402` 时前端会要求输入动态验证码）
- 登录后该会话所有的文件操作都使用**你自己的 OpenList 令牌**，
  因此 OpenList 的权限、`base_path` 限制完全生效
- 未实现注册功能：账号只能在 OpenList 中创建

### 2. 笔记存放到 OpenList 目录

**关于 `OPENLIST_ROOT` 与账号「基础路径」**

`OPENLIST_ROOT` 填的是 **OpenList 中的绝对路径**。OpenList 会给每个账号加一层
「基础路径」(`base_path`)，并且是简单拼接（`path.Join(basePath, reqPath)`），
所以如果面板把 `/public/Notes` 原样发出去、而账号的基础路径是 `/public`，
就会变成 `/public/public/Notes`。

面板会自动做换算：**先确定 OpenList 的绝对路径，再按当前账号的基础路径取相对路径**。

| `.env` 的 `OPENLIST_ROOT` | 账号基础路径 | 实际访问 | 结果 |
| --- | --- | --- | --- |
| `/public/Notes` | `/public` | `/public/Notes` | 正常 |
| `/public` | `/public` | `/public` | 正常 |
| `/public/Notes` | `/`（管理员） | `/public/Notes` | 正常 |
| `/notes` | `/public` | — | **权限不足**，面板会明确提示 |
| `/other` | `/public` | — | **权限不足**，面板会明确提示 |

无法访问时的提示形如：

> 只读模式：… / No access to /notes: /notes is outside /public, which is the folder this
> OpenList account is limited to. Change OPENLIST_ROOT, or use an account whose base path contains it.

要解决：把 `OPENLIST_ROOT` 改成该账号基础路径**之内**的目录，或改用基础路径覆盖该目录的账号。


- 默认根目录 `OPENLIST_ROOT=/notes`，可通过 `--openlist-root` 或界面「设置」修改
- 写入走 `PUT /api/fs/put`（`File-Path` 头 + 原始字节），读取走 `POST /api/fs/get` → `raw_url`，
  失败时自动回退到 `/p/<path>` 代理端点
- 目录、重命名、删除分别使用 `/api/fs/mkdir`、`/api/fs/rename`、`/api/fs/remove`
- 回收站是 OpenList 目录下的 `_trash` 文件夹，删除即移动，恢复即写回原目录
- 本地管理员（没有 OpenList 账号）访问 OpenList 存储时使用 `OPENLIST_TOKEN`
  （OpenList →「设置」→「API」中创建）

### 3. 没有安装 OpenList 也能运行

存储驱动有三种模式（界面「设置」或 `STORAGE_DRIVER`）：

| 模式 | 行为 |
| --- | --- |
| `auto`（默认） | 启动和每次请求都探测 OpenList（`/api/public/init_status`，结果缓存 8 秒）。可达则用 OpenList，不可达自动回落本地磁盘，界面显示「本地存储（降级）」 |
| `openlist` | 强制使用 OpenList，不可达时接口返回 `503` 与明确错误信息 |
| `local` | 始终使用本地磁盘（`DATA_DIR/notes`） |

因此全新服务器上直接安装即可使用，之后再填 OpenList 地址即可无缝切换。

---

## 快速开始（本地开发）

需要 **Node.js ≥ 20.19**（推荐 22 LTS）。

```bash
git clone <this-repo> notes-manager-web
cd notes-manager-web
npm install

# 终端 1：后端（默认 http://127.0.0.1:8080）
npm run dev:server

# 终端 2：前端开发服务器（http://127.0.0.1:5173，已配置 /api 代理）
npm run dev:web
```

首次启动若未设置 `ADMIN_PASSWORD`，会自动生成随机密码并打印在日志里，
同时写入 `data/initial-admin.txt`。

### 生产模式（单进程同时提供 API 和前端）

```bash
npm run build     # 构建 web/dist 与 server/dist
npm start         # http://127.0.0.1:8080
```

### 没有 OpenList 也想体验 OpenList 模式？

仓库自带一个 OpenList 兼容的模拟服务（仅实现本项目用到的接口），用于开发与自动化测试：

```bash
node scripts/mock-openlist.mjs --port 5244 --root ./tmp/mock-openlist
# 账号：admin/admin（管理员）、writer/writer；API 令牌：mock-api-token
```

随后在面板「设置」里把 OpenList 地址填成 `http://127.0.0.1:5244` 即可。

### 测试

```bash
# 1) 接口冒烟测试：登录 → 增删改查 → 标签 / 文件夹 / 回收站 → 退出（22 项断言）
node scripts/smoke-test.mjs http://127.0.0.1:8080 admin <password>          # 本地磁盘模式
SMOKE_PROVIDER=openlist SMOKE_USERNAME=admin SMOKE_PASSWORD=admin \
  node scripts/smoke-test.mjs http://127.0.0.1:8080                        # OpenList 模式

# 2) 前端检查，三组：
#    render-check  渲染整个组件树（启动页/登录页/工作台/弹窗/只读/专注模式）
#    store-check   驱动 store 验证「什么时候才会触发保存」
#    outline-check 大纲/锚点 slug 与渲染器逐项对齐（跳转不会错位）
#    dom-check     jsdom 中真实点击大纲与锚点链接，断言地址栏/编辑器/预览三者一致
npm run check:web

# 3) 安装脚本测试（从 install.sh 提取真实函数与配置段落执行）
npm run test:installer

# 4) 服务端单元测试（基础路径换算、字体仓库、内置字体 id 等）
npm run test:server

# 5) 仓库完整性检查：磁盘上的源文件是否都在 git 里；
#    并拒绝任何运行时状态入库（.env / data/ / sessions.json / settings.json，
#    以及内容里带 sessionSecret、adminPasswordHash 的文件）
npm run check:repo

# 6) 类型检查
npm run typecheck

# 7) 重新生成应用图标（改动了图标设计时）
npm run icons
```

以上各项都会在 GitHub Actions 中自动执行（`.github/workflows/ci.yml`），另外还会跑 `shellcheck`。

---

## 一键安装 / 卸载（Linux 服务器）

要求：systemd 的 Linux 发行版（Debian/Ubuntu、RHEL/CentOS/Rocky、Fedora、Arch、Alpine 等），
root 权限，能访问 npm 源（首次安装 Node.js 时会联网）。

### 安装（推荐流程）

配置写在**项目目录的 `.env`** 里，安装脚本会读取它：

```bash
# 1. 拉取项目
git clone https://github.com/Moistrocic/notes-manager-web.git
cd notes-manager-web

# 2. 生成并编辑配置（端口、OpenList 地址、管理员账号都在这里）
cp .env.example .env
vi .env

# 3. 一键安装
sudo ./scripts/install.sh
```

安装完成后脚本会明确打印**运行时配置文件的位置**（默认 `/opt/notes-manager/.env`），
那就是服务真正读取的那一份。它在三处都能查到：

| 位置 | 内容 |
| --- | --- |
| 安装结束的摘要 | `运行时配置文件 : /opt/notes-manager/.env` |
| 服务启动日志 | `config file : /opt/notes-manager/.env` |
| Web 界面 | 「设置 → 服务器配置文件」 |

以后修改配置：

```bash
sudo nano /opt/notes-manager/.env
sudo systemctl restart notes-manager
```

配置优先级（从高到低）：**命令行参数 > 项目 `.env` > `NOTES_MANAGER_*` 环境变量 > 内置默认值**。
安装后运行期则是：**真实环境变量 > 运行时 `.env` > 界面里保存的设置 > 默认值**。

> 项目目录里若存在一个**没被读取**的 `.env`，启动日志会明确告警：
> `... exists but is NOT read - the active configuration file is ...` —— 不会再出现"改了没反应"。

命令行参数依然可用，且优先级高于 `.env`：

```bash
sudo ./scripts/install.sh --port 8080 --openlist-url http://127.0.0.1:5244 --openlist-token <TOKEN>
```

脚本会依次完成：

1. 检测/安装 Node.js（优先系统包管理器 + NodeSource，失败则下载官方 tarball 到 `/usr/local/lib/nodejs`）
2. 创建系统用户与目录：`/opt/notes-manager`、`/var/lib/notes-manager`
3. 读取项目目录的 `.env`（命令行参数优先），并解析出本次安装的最终配置
4. 通过 `find -prune` + `tar` 精确拷贝源码（不使用 rsync 的 glob 排除规则，避免误伤
   `server/src/integrations/openlist/` 这类同名嵌套目录；保留已有的 `.env`、`node_modules`），
   随后再次校验关键文件确实落地
5. `npm ci` + `npm run build`
6. 把最终配置写入 `/opt/notes-manager/.env`（项目 `.env` 的副本 + 解析结果，权限 600；
   未配置管理员密码时生成随机密码并写入）
7. 写入并启用 systemd 服务 `notes-manager.service`，通过 `Environment=ENV_FILE=...` 告诉应用
   读哪个配置文件（**不使用 `EnvironmentFile=`**，避免第二份配置源静默覆盖 `.env`）
8. 启动服务并做健康检查，最后打印访问地址、账号密码、
   **运行时配置文件路径**与常用命令

常用参数（`sudo ./scripts/install.sh --help` 查看全部）：

| 参数 | 说明 |
| --- | --- |
| `--dir` / `--data` / `--config` | 程序 / 数据 / 配置目录 |
| `--port` `--host` `--base-path` `--public-url` | 监听端口、绑定地址、子路径、对外 URL |
| `--driver auto\|openlist\|local` | 存储驱动 |
| `--openlist-url` `--openlist-token` `--openlist-root` `--openlist-per-user` | OpenList 相关配置 |
| `--admin-user` `--admin-password` `--no-local-auth` | 本地账户 |
| `--skip-deps` `--skip-build` `--force-node` `--no-start` | 精细控制 |

> `--skip-deps` 只在**依赖确实没变**时才用。安装脚本会保留 `node_modules` 以便快速重装，所以
> `git pull` 带进来的新依赖只有跑过 npm 才会出现；脚本因此在校验 `package-lock.json` 指纹不符时
> **直接拒绝并提示去掉 `--skip-deps`**，而不是等到构建时报一个看不懂的错。

> `--base-path` 会被编译进前端资源路径（`VITE_BASE_PATH`），修改后需要重新执行安装或手动
> `VITE_BASE_PATH=/notes npm run build`。

### 卸载

```bash
sudo ./scripts/uninstall.sh           # 停服务、禁用开机自启、删除程序文件，保留数据与配置
sudo ./scripts/uninstall.sh --purge   # 额外删除配置、数据（会二次确认）与系统用户
```

### 升级到新版本

```bash
cd ~/notes-manager-web && git pull
sudo ./scripts/install.sh          # 不要加 --skip-deps
```

> `git pull` 可能带来新的依赖，只有 npm 会把它们装上。安装脚本会比对 `package-lock.json` 的
> 指纹，不一致时拒绝使用 `--skip-deps` 并在构建前逐个列出缺失的依赖包。

### 服务管理

```bash
systemctl status notes-manager
systemctl restart notes-manager
journalctl -u notes-manager -f
```

---

## 配置项参考

所有配置都可以用环境变量提供（见 `.env.example`）。**环境变量优先级高于界面里保存的设置**，
设置页会用「env 锁定」标出被环境变量覆盖的字段。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | 监听地址与端口 |
| `BASE_PATH` | 空 | 子路径部署，例如 `/notes` |
| `PUBLIC_URL` | 空 | 反向代理后的对外地址，用于判定 Cookie `Secure` |
| `DATA_DIR` | `./data` | 会话、设置、字体、本地笔记等运行时数据 |
| `STORAGE_DRIVER` | `auto` | `auto` / `openlist` / `local` |
| `OPENLIST_URL` | 空 | OpenList 地址，如 `http://127.0.0.1:5244` |
| `OPENLIST_TOKEN` | 空 | OpenList API 令牌（本地账户读写用） |
| `OPENLIST_ROOT` | `/notes` | OpenList 中的笔记根目录（**绝对路径**，见下） |
| `OPENLIST_PER_USER` | `false` | 每个用户存到 `<root>/<用户名>` |
| `NOTES_ROOT` | `<DATA_DIR>/notes` | 本地驱动的笔记目录 |
| `ADMIN_USERNAME` | `admin` | 本地管理员用户名 |
| `ADMIN_PASSWORD` | 随机生成 | 本地管理员密码 |
| `AUTH_LOCAL_ENABLED` | `true` | 是否允许本地账户登录 |
| `SESSION_TTL_HOURS` | `72` | 会话有效期 |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

---

## HTTP API

所有接口都在 `/api` 下，使用 Cookie 会话认证。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/system/health` | 健康检查（公开） |
| `GET` | `/api/system/status` | 版本、存储状态、可用登录方式 |
| `GET/PUT` | `/api/system/settings` | 读取/保存存储设置（管理员） |
| `POST` | `/api/system/openlist/test` | 测试 OpenList 连接（管理员） |
| `POST` | `/api/system/cache/clear` | 清空服务端缓存（管理员） |
| `GET` | `/api/auth/providers` | 可用的登录方式 |
| `POST` | `/api/auth/login` | `{username, password, otp?, provider?}`；`provider` 可为 `auto`/`openlist`/`local`/**`guest`** |
| `POST` | `/api/auth/logout` | 退出登录 |
| `GET` | `/api/auth/me` | 当前用户 |
| `POST` | `/api/auth/password` | 修改本地管理员密码 |
| `GET` | `/api/notes` | 列表，支持 `q` `tag` `folder` `favorite` `sort` |
| `POST` | `/api/notes` | 新建笔记 |
| `GET/PUT/DELETE` | `/api/notes/:id` | 读取 / 更新 / 删除（`?permanent=true` 彻底删除） |
| `POST` | `/api/notes/:id/restore` | 从回收站恢复 |
| `GET` | `/api/notes/trash` · `POST /api/notes/trash/empty` | 回收站 |
| `GET/POST` | `/api/notes/folders` · `DELETE /api/notes/folders?path=` | 文件夹 |
| `GET` | `/api/notes/tags` | 标签及计数 |
| `GET` | `/api/fonts` | 已导入字体列表与当前选择 |
| `POST` | `/api/fonts` | 上传字体（原始字节 + `X-Font-Filename` / `X-Font-Name` 头，管理员） |
| `DELETE` | `/api/fonts/:id` | 删除字体（管理员） |
| `PUT` | `/api/fonts/selection` | 指定界面 / 代码字体（管理员）；`builtin:` 开头的 id 表示内置字体 |
| `GET` | `/api/fonts/:id/file` | 字体文件本体（供 `@font-face` 加载） |

---

## 目录结构

```
notes-manager-web/
├── server/                      # Node.js + Express 5 + TypeScript
│   └── src/
│       ├── index.ts             # 入口
│       ├── app.ts               # Express 应用（API + 静态 SPA）
│       ├── config.ts            # 配置解析（env > settings.json > 默认值）
│       ├── services.ts          # 依赖容器
│       ├── auth/                # scrypt 密码、会话存储、登录服务
│       ├── integrations/
│       │   └── openlist/client.ts  # 【本项目原创】OpenList REST API 客户端
│       ├── storage/             # 存储抽象：local / openlist / manager
│       ├── notes/               # front matter 解析、笔记仓库（缓存 + 检索）
│       └── http/                # 中间件与路由
├── web/                         # React 19 + Vite 7 + Tailwind v4
│   ├── public/                  # 应用图标（favicon.svg / .ico / PNG / manifest）
│   └── src/
│       ├── App.tsx              # 布局与路由（登录 / 工作台）
│       ├── components/          # 编辑器、列表、侧栏、命令面板、弹窗…
│       ├── store/useAppStore.ts # Zustand 状态与自动保存
│       ├── lib/                 # API 客户端、Markdown 渲染、格式化
│       └── styles.css           # 设计令牌、动画、Markdown/编辑器样式
├── scripts/
│   ├── generate-icons.mjs       # 由矢量定义生成 favicon / PNG / manifest（npm run icons）
│   ├── install.sh               # 一键安装（Linux + systemd）
│   ├── uninstall.sh             # 一键卸载
│   ├── doctor.sh                # 诊断脚本（服务/配置/网络连通性）
│   ├── test-install.sh          # 安装脚本测试（74 项断言）
│   ├── check-repo-files.mjs     # 仓库完整性检查
│   ├── mock-openlist.mjs        # OpenList 兼容模拟服务（开发/测试）
│   └── smoke-test.mjs           # 端到端接口冒烟测试
├── web/render-check.tsx         # 组件树渲染检查（npm run check:render）
├── openlist/                    # OpenList 源码（仅用于阅读参考，已在 .gitignore 中忽略）
├── .env.example
└── package.json                 # npm workspaces（server + web）
```

> `openlist/` 目录是通过 `git clone` 拉取的 OpenList 官方仓库，仅用于阅读其 API 实现，
> **本项目不会修改它，也不会提交到本仓库**（见 `.gitignore`）。

---

## 常见问题

**Q：字体/壁纸会随重装丢失吗？**

| 内容 | 存放位置 | 重装/重启 |
| --- | --- | --- |
| 内置字体（Cascadia Code） | 前端静态资源 `web/dist/fonts/` | 随安装包重新部署，**无需任何配置** |
| 上传的字体文件 | 服务器 `DATA_DIR/fonts/`（默认 `/var/lib/notes-manager/fonts`） | **保留**（重装不会删除数据目录） |
| 字体选择 | 同目录的 `index.json` | **保留** |
| 壁纸 | 浏览器本地（localStorage + IndexedDB） | 保留，但**换设备需重设** |
| 壁纸文件夹授权 | 浏览器本地（IndexedDB 里的目录句柄） | 保留，但浏览器会**再确认一次**才允许读取 |

> 字体是整站设置（所有用户共享）；壁纸是**每台浏览器各自的偏好**，因为需求是"仅前端支持、
> 不需要服务器"。卸载脚本执行 `--purge` 时会连同数据目录一起删除。

**Q：更新后构建失败，报 `Rollup failed to resolve import "..."`？**

某个依赖没装上。安装脚本会保留上一次的 `node_modules` 以加快重装，如果升级时用了
`--skip-deps`，`git pull` 带进来的新依赖就不会被安装：

```bash
cd ~/notes-manager-web && git pull
sudo ./scripts/install.sh          # 关键：不要带 --skip-deps
```

现在的脚本会在构建前就拦住这种情况，直接列出缺失的依赖包名，不会再让你对着 Vite 的报错猜。

**Q：面板显示「OpenList 无法连接」，但我用浏览器打开 OpenList 是好的？**

先跑诊断脚本，它会把服务状态、配置、以及**从服务器发起**的连通性测试全部打印出来：

```bash
cd ~/notes-manager-web && git pull
sudo ./scripts/doctor.sh
```

最常见的两种原因：

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `OPENLIST_URL is empty` | 没填地址（`.env.example` 里该项默认为空） | 「设置 → OpenList 连接」填写，或改 `/opt/notes-manager/.env` |
| 第 7 节 `no local listener on port 5244` | **`127.0.0.1` 在服务器上指的是服务器自己**，而 OpenList 装在你的电脑/另一台机器上 | 改成服务器能访问的地址，如 `http://192.168.1.10:5244` |
| 第 6 节返回 HTML 而不是 JSON | OpenList 版本较旧 | 已修复（见下），升级到最新版本即可 |

> 浏览器里的 `127.0.0.1` 是**你正在用的那台电脑**；面板里的 `127.0.0.1` 是**服务器**。
> 两者只有在面板和 OpenList 跑在同一台机器上时才是同一个地址。

> **OpenList 版本兼容性**：健康探测使用 `/api/public/settings`，该接口在所有已发布版本中都存在。
> `/api/public/init_status` 是 **v4.2.6 之后**才加入的路由，在旧版本上会落到 SPA 回退、返回
> `index.html`（HTTP 200、`text/html`）——早期版本的面板正是因此误判为"无法连接"。
> 现在它只作为可选的版本探测，缺失时按"可用"处理。

**Q：面板显示「本地存储（降级）」？**
A：说明 OpenList 探测失败（地址已配置但连不上）。用 `sudo ./scripts/doctor.sh` 定位，
或在「设置 → 测试连接」中查看具体报错（会显示 `ECONNREFUSED` / `ETIMEDOUT` 等底层原因）。

**Q：用本地管理员登录后，写 OpenList 目录报权限错误？**
A：本地账户没有 OpenList 令牌。请在 OpenList「设置 → API」创建令牌并填入
`OPENLIST_TOKEN`（或界面设置），或者改用 OpenList 账户登录。

**Q：笔记写入失败 / 云盘不支持写入？**
A：OpenList 的存储驱动需要可写。挂载对象存储、WebDAV 或本地存储即可；
只读云盘（如部分只读分享挂载）无法写入，此时可把 `STORAGE_DRIVER` 设为 `local`。

**Q：界面里改了设置但没生效？**
A：环境变量优先级更高，设置页会显示「env 锁定」。请修改 `.env` 或
`/etc/notes-manager/notes-manager.env` 后重启服务。

**Q：前端资源 404（子路径部署）？**
A：用 `BASE_PATH` / `--base-path` 部署时需要带上 `VITE_BASE_PATH` 重新构建，
安装脚本会自动处理。

---

## 许可

本项目基于 [MIT 许可](./LICENSE) 发布，完整条款见仓库根目录的 `LICENSE` 文件。

### 第三方资源

| 资源 | 位置 | 许可 |
| --- | --- | --- |
| Cascadia Code 字体 | `web/public/fonts/CascadiaCode.woff2` | [SIL OFL 1.1](./web/public/fonts/CascadiaCode-LICENSE.txt)（Microsoft，保留字体名 `Cascadia Code`；文件原样分发、未改名、未修改） |

字体随前端一起构建到 `web/dist/fonts/`，因此部署后无需联网即可使用。想换成别的内置字体，
把字体文件放进 `web/public/fonts/` 并在 `web/src/lib/builtin-fonts.ts` 里加一条即可。

### 与 OpenList 的关系（重要）

OpenList 是由 OpenList Team 独立维护的 Go 项目，遵循
[AGPL-3.0](https://github.com/OpenListTeam/OpenList/blob/main/LICENSE)。
**本项目与它在代码层面完全无关**，具体而言：

| 项目 | 说明 |
| --- | --- |
| 是否包含 OpenList 源码 | **否**。仓库中 `*.go` 文件数量为 **0**；本项目是 TypeScript/React 项目 |
| 是否修改 OpenList | **否**。开发期 clone 的 `openlist/` 仅作只读参考，已被 `.gitignore` 忽略，**不随本仓库分发**（`git ls-files openlist` 为空） |
| 是否链接/内嵌 OpenList | **否**。两者是各自独立运行、各自独立部署的进程 |
| 交互方式 | 仅通过 **HTTP 网络接口**调用 OpenList 的公开 REST API |

因此本项目不构成 OpenList 的衍生作品，适用自身的 MIT 许可。

**关于 API 与代码的区分**：HTTP 端点路径、JSON 字段名、请求参数属于**功能性接口**，
而非受版权保护的表达。`server/src/integrations/openlist/client.ts` 是本项目**自行编写的
TypeScript 客户端**（文件名与目录名均已明确标注为 `integrations`，即"集成适配层"），
它只负责按 OpenList 的接口约定收发 JSON。这与"浏览器实现 HTTP 协议""数据库驱动实现
某数据库的线协议"属于同一性质。

> 说明：以上是工程层面的判断，不构成法律意见。若你的使用场景对合规有更高要求，
> 请咨询专业律师。此外，**你自己**若修改 OpenList 源码并对外提供服务，
> 需要遵守 AGPL-3.0 的相应义务。
