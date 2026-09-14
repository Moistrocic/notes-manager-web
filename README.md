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

- 三栏工作台：侧边导航 / 笔记列表 / 编辑器 + 大纲面板，可折叠、响应式（手机为抽屉式）
- 深色 / 浅色主题，动态极光背景，玻璃拟态面板，全流程 Framer Motion 动画
  （列表布局动画、卡片入场错峰、模态弹簧过渡、Toast 堆叠）
- CodeMirror 6 编辑器：Markdown 语法高亮、行号、括号匹配、搜索、自动换行
- 编辑 / 分栏 / 预览三种模式，Markdown 实时预览（GFM、表格、任务列表、代码高亮）
- 命令面板（`Ctrl/⌘ + K`）、全文检索（`/` 聚焦）、快捷键、Toast 撤销
- 自动保存（防抖 + 状态指示），置顶 / 收藏 / 颜色标记 / 标签 / 文件夹
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

### 冒烟测试

```bash
# 本地磁盘模式（provider=local）
node scripts/smoke-test.mjs http://127.0.0.1:8080 admin <password>

# OpenList 模式（provider=openlist）
SMOKE_PROVIDER=openlist SMOKE_USERNAME=admin SMOKE_PASSWORD=admin \
  node scripts/smoke-test.mjs http://127.0.0.1:8080
```

---

## 一键安装 / 卸载（Linux 服务器）

要求：systemd 的 Linux 发行版（Debian/Ubuntu、RHEL/CentOS/Rocky、Fedora、Arch、Alpine 等），
root 权限，能访问 npm 源（首次安装 Node.js 时会联网）。

### 安装

```bash
# 上传或 clone 项目到服务器后，在项目根目录执行
sudo ./scripts/install.sh

# 或者一步到位，直接绑定 OpenList
sudo ./scripts/install.sh \
  --port 8080 \
  --openlist-url http://127.0.0.1:5244 \
  --openlist-token <你的 OpenList API 令牌> \
  --openlist-root /notes
```

脚本会依次完成：

1. 检测/安装 Node.js（优先系统包管理器 + NodeSource，失败则下载官方 tarball 到 `/usr/local/lib/nodejs`）
2. 创建系统用户与目录：`/opt/notes-manager`、`/var/lib/notes-manager`、`/etc/notes-manager`
3. 拷贝源码（自动排除 `node_modules`、`.git`、克隆的 `openlist/`、构建产物）
4. `npm ci` + `npm run build`
5. 生成配置文件 `/etc/notes-manager/notes-manager.env`（含随机管理员密码）
6. 写入并启用 systemd 服务 `notes-manager.service`（带 `NoNewPrivileges`、`ProtectSystem` 等加固）
7. 启动服务并做健康检查，最后打印访问地址、账号密码与常用命令

常用参数（`sudo ./scripts/install.sh --help` 查看全部）：

| 参数 | 说明 |
| --- | --- |
| `--dir` / `--data` / `--config` | 程序 / 数据 / 配置目录 |
| `--port` `--host` `--base-path` `--public-url` | 监听端口、绑定地址、子路径、对外 URL |
| `--driver auto\|openlist\|local` | 存储驱动 |
| `--openlist-url` `--openlist-token` `--openlist-root` `--openlist-per-user` | OpenList 相关配置 |
| `--admin-user` `--admin-password` `--no-local-auth` | 本地账户 |
| `--skip-deps` `--skip-build` `--force-node` `--no-start` | 精细控制 |

> `--base-path` 会被编译进前端资源路径（`VITE_BASE_PATH`），修改后需要重新执行安装或手动
> `VITE_BASE_PATH=/notes npm run build`。

### 卸载

```bash
sudo ./scripts/uninstall.sh           # 停服务、禁用开机自启、删除程序文件，保留数据与配置
sudo ./scripts/uninstall.sh --purge   # 额外删除配置、数据（会二次确认）与系统用户
```

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
| `DATA_DIR` | `./data` | 会话、设置、本地笔记等运行时数据 |
| `STORAGE_DRIVER` | `auto` | `auto` / `openlist` / `local` |
| `OPENLIST_URL` | 空 | OpenList 地址，如 `http://127.0.0.1:5244` |
| `OPENLIST_TOKEN` | 空 | OpenList API 令牌（本地账户读写用） |
| `OPENLIST_ROOT` | `/notes` | OpenList 中的笔记根目录 |
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
| `POST` | `/api/auth/login` | `{username, password, otp?, provider?}` |
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
│       ├── openlist/client.ts   # OpenList HTTP API 客户端
│       ├── storage/             # 存储抽象：local / openlist / manager
│       ├── notes/               # front matter 解析、笔记仓库（缓存 + 检索）
│       └── http/                # 中间件与路由
├── web/                         # React 19 + Vite 7 + Tailwind v4
│   └── src/
│       ├── App.tsx              # 布局与路由（登录 / 工作台）
│       ├── components/          # 编辑器、列表、侧栏、命令面板、弹窗…
│       ├── store/useAppStore.ts # Zustand 状态与自动保存
│       ├── lib/                 # API 客户端、Markdown 渲染、格式化
│       └── styles.css           # 设计令牌、动画、Markdown/编辑器样式
├── scripts/
│   ├── install.sh               # 一键安装（Linux + systemd）
│   ├── uninstall.sh             # 一键卸载
│   ├── mock-openlist.mjs        # OpenList 兼容模拟服务（开发/测试）
│   └── smoke-test.mjs           # 端到端接口冒烟测试
├── openlist/                    # OpenList 源码（仅用于阅读参考，已在 .gitignore 中忽略）
├── .env.example
└── package.json                 # npm workspaces（server + web）
```

> `openlist/` 目录是通过 `git clone` 拉取的 OpenList 官方仓库，仅用于阅读其 API 实现，
> **本项目不会修改它，也不会提交到本仓库**（见 `.gitignore`）。

---

## 常见问题

**Q：面板显示「本地存储（降级）」？**
A：说明 OpenList 探测失败。检查地址端口、OpenList 是否已初始化（`/api/public/init_status`），
然后在「设置 → 测试连接」中确认。

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

本项目基于 MIT 许可发布。OpenList 为独立项目，遵循其自身的开源许可（AGPL-3.0）。
