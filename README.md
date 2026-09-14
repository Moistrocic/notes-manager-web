# 笔记管理面板 · notes-manager-web

一个自托管的 Markdown 笔记管理面板：笔记以普通 `.md` 文件的形式直接存放在 OpenList 目录里，
支持用你自己的 OpenList 账户登录；服务器上没装 OpenList 时也能正常运行（自动回落到本地磁盘）。

> 前端 React 19 + Vite 7 + Tailwind CSS v4 + Framer Motion + CodeMirror 6
> 后端 Node.js + Express 5 + TypeScript，单进程同时提供 API 与前端，零数据库

---

## AI 开发提示

> 这个项目由 AI 结对开发。从界面组件、测试到安装脚本，绝大部分代码是在与 AI 助手的对话中写成的，
> 人类负责提需求、验收与决策。所以仓库里的注释、测试与提交信息都写得比较"自解释"，
> 目的是让下一个接手的人（或 AI）不必先把全部代码读一遍。

### 动手之前先看这里

| 想改什么 | 去哪里 |
| --- | --- |
| 笔记的字段 / front matter | `server/src/notes/`，字段类型同步到 `web/src/lib/types.ts` |
| 加一个接口 | `server/src/http/routes/`，前端封装在 `web/src/lib/api.ts` |
| 某个界面面板 | `web/src/components/` |
| 颜色、圆角、间距等设计令牌 | `web/src/styles.css` 顶部（`--accent`、`--line`、`--glass-blur` …） |
| 代码高亮配色 | `web/src/lib/code-theme.ts` —— 编辑分栏与预览分栏唯一的来源，改一处两边同时生效 |
| 内置字体 | 文件放进 `web/public/fonts/`，再到 `web/src/lib/builtin-fonts.ts` 注册一条 |
| 壁纸来源 | 设置与存储 `web/src/lib/wallpaper.ts`；本地壁纸库（含 Steam 探测）`web/src/lib/local-wallpapers.ts` |
| 安装 / 卸载行为 | `scripts/install.sh`、`scripts/uninstall.sh`，必须同步改 `scripts/test-install.sh` |
| 自动保存的时机 | `web/src/store/useAppStore.ts`，断言在 `web/store-check.tsx` |

### 改完必须跑

```bash
npm run check:repo && npm run typecheck && npm run test:server && npm run check:web
# 动过 scripts/*.sh 再补：
npm run test:installer
shellcheck --severity=warning scripts/install.sh scripts/uninstall.sh scripts/test-install.sh scripts/doctor.sh
```

CI 会原样执行这一整套（`.github/workflows/ci.yml`），本地跑不过就别推。

### 几条硬约定

| 约定 | 说明 |
| --- | --- |
| 提交信息 | Conventional Commits：`feat:` / `fix:` / `docs:` / `chore:` …。一个提交只做一件事，别把文档和功能混在一起 |
| 运行时状态一律不入库 | `.env`、`data/`、`sessions.json`、`settings.json` 都不提交。`npm run check:repo` 按路径与文件内容双重拦截（出现 `sessionSecret`、`adminPasswordHash`、`openlistToken` 直接失败） |
| `openlist/` 是只读参考 | OpenList 官方仓库的 clone，只用来阅读其 API 实现，不修改、不提交（已在 `.gitignore` 中锚定） |
| 用户可见的行为要有断言 | 新增或修改交互时请补 `web/dom-check.tsx`（jsdom）或 `scripts/test-server.mjs` 的断言，不要只靠手点 |
| 共享取值只留一处 | 见上表。同一个颜色 / 字体 / 尺寸在仓库里出现两份，就是下一个不一致 bug |

### 两个容易踩的坑

1. `scripts/test-install.sh` 用 `awk` 从 `install.sh` 里按函数名抽取真实函数体执行，
   判据是"第一个第 0 列的 `}`"。所以函数体内嵌的 shell / JS 片段必须缩进，
   否则抽取会在中间截断，报一个莫名其妙的引号不配对。
2. `.gitignore` 里的模式要加前导 `/`。曾经因为写了不带斜杠的 `openlist/`，
   把 `server/src/integrations/openlist/` 一起忽略了，源码没进仓库、新克隆直接编译失败。
   `npm run check:repo` 就是为这件事加的。

### 判断"修好了没有"的标准是证据

不是复述代码，也不只是"看起来对了"。仓库里几个真实 bug 都是先用无头浏览器截图或失败断言抓到、
再动手改的：两栏代码配色漂移（让 CodeMirror 吐出它自己生成的样式表，再和预览的 CSS 逐 token 比对）、
模糊壁纸边缘淡出（截真实应用看到四角发黑）、`--skip-deps` 保留旧依赖（把包装起来重跑构建，
复现出与线上一致的报错）、字体排序测试在 CI 挂掉（验证 `localeCompare` 在 zh-CN / en-US 下的不同结果）。

**能复现的先复现，能断言的先写断言，能截图的先截图。**

---

## 项目描述

### 这是什么

一个自托管的 Markdown 笔记面板，形态是单个 Node.js 进程：同一个进程既提供 REST API，
也把构建好的前端当静态资源托管。没有数据库、没有消息队列、没有外部服务依赖，
一个 `systemd` 服务就能跑起来，卸载就是删目录。

### 它解决什么问题

很多人已经在用 OpenList 管理网盘 / 对象存储 / WebDAV。想记笔记时通常只有两个选择：
用某个笔记软件（笔记被锁进它的私有数据库，跟你的文件体系脱节），
或者直接在文件管理器里编辑 `.md`（没有检索、标签、大纲、预览）。

这个项目要的是两者兼得：

- 笔记就是普通的 `.md` 文件，带一段 YAML front matter 记录标题、标签、置顶、颜色等元信息。
  在 OpenList 的文件管理器里可以直接看到、编辑、同步它们。
- 反过来，你手动丢进目录的 `.md` 文件也会被自动识别（没有 front matter 也能解析）。
- 面板提供编辑器、实时预览、大纲、全文检索、标签、嵌套文件夹、回收站、自动保存。

### 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 19 · Vite 7 · Tailwind CSS v4 · Framer Motion 12 |
| 编辑器 | CodeMirror 6（语法包按需异步加载） |
| 状态 | Zustand（vanilla store + `useStore`） |
| 后端 | Node.js ≥ 20.19 · Express 5 · TypeScript（ESM） |
| 存储 | OpenList REST API ／ 本地磁盘，同一套抽象，运行时可切换、可降级 |
| 持久化 | JSON 文件（`settings.json` / `sessions.json` / `state.json`），零数据库 |
| 部署 | Linux + systemd，一键安装 / 卸载脚本 |

### OpenList 联动简介

[OpenList](https://github.com/OpenListTeam/OpenList) 是一个 Go 编写的多存储文件列表程序。
本项目不包含、不修改、不链接它的任何代码，只通过它的 HTTP REST API 交互：

- **登录**：可用 OpenList 账户登录。后端拿 `POST /api/auth/login` 换来令牌，再 `GET /api/me`
  读账户信息；此后该会话的所有文件操作都用你自己的那个令牌，所以 OpenList 侧的权限与
  `base_path` 限制完全生效。
- **存储**：笔记的读写增删走 `/api/fs/*`，读取失败时自动回退到 `/p/<path>` 代理端点。
- **降级**：OpenList 连不上就自动改用本地磁盘，界面显示「本地存储（降级）」。
  因此全新服务器上不装 OpenList 也能先把面板跑起来，之后再填地址即可无缝切换。

具体到每个功能调用哪个端点，见[功能介绍](#功能介绍)里的「与 OpenList 的具体联动」。

---

## 功能介绍

### 界面

- 两栏工作台：左侧导航与笔记列表合并为一栏（可整体隐藏），右侧为编辑器 + 可折叠大纲面板
- 列表三种视图：卡片列表 / 网格 / 紧凑（仅标题）；嵌套文件夹以树形展示，支持创建 `a/b/c` 多级目录
- 专注模式：一键隐藏列表与三排工具栏，只留迷你操作条（视图切换 / 大纲 / 退出），`Esc` 退出
- 编辑 / 分栏 / 预览三种模式；分隔条可拖动，双击恢复居中
- 点击大纲会同时滚动编辑区与预览区，并在预览中高亮落点
- 深链与锚点：地址栏始终反映当前笔记与位置，形如
  `https://example.com/public/Notes/Readme.md#11-分层`，可直接分享；浏览器前进 / 后退逐篇回退；
  笔记内的 `[文字](#锚点)` 与 `[文字](./另一篇.md)` 均可点击跳转
- 深色 / 浅色主题，动态极光背景，玻璃拟态面板，全流程 Framer Motion 动画
- 命令面板（`Ctrl/⌘ + K`）、全文检索（`/` 聚焦）、快捷键、Toast 撤销
- 自动保存：先比对再保存——内容没有实际变化时不写入（打开笔记、编辑器回显、失焦都不触发），
  把改动改回原样还会取消待保存；防抖 900ms + 状态指示
- 置顶 / 收藏 / 颜色标记 / 标签 / 嵌套文件夹
- 回收站：删除 → 撤销 → 恢复 → 彻底删除

字体：内置 Cascadia Code（随安装包部署，代码字体默认就是它，开箱即用、无需联网下载）；
管理员还可上传 woff2 / woff / ttf / otf，分别指定界面字体与代码字体，文件存在服务器数据目录，
重启后依然生效。

壁纸：三种来源——图片链接、单个本地图片 / 视频、本地壁纸库。壁纸库会从你授权的目录里
自动定位 Wallpaper Engine 的壁纸总文件夹（`steamapps/workshop/content/431960`），
按每个壁纸一格展示预览图。场景壁纸是打包的 `scene.pkg` 加编译过的着色器，浏览器无法播放，
这类壁纸会改用它的 `preview.jpg` / `preview.gif` 作静态背景（GIF 会动），并在格子上标注「静态」。
纯前端实现，文件存在浏览器 IndexedDB，不上传服务器，人人可用。

代码高亮：`ts` / `python` 等 140+ 种语言按需加载，只有笔记里真正用到的才下载；
编辑分栏与预览分栏共用同一套配色（VS Code Dark+ / Light+），字体、字号、行高与每个 token 的
颜色都从 `web/src/lib/code-theme.ts` 一处派生。

### 数据

- 笔记是普通 Markdown 文件，带 YAML front matter，可直接在 OpenList 里查看、编辑、同步
- 双向兼容：手动放进目录的 `.md` 会被自动识别（无 front matter 也能解析）
- 存储层抽象（OpenList 驱动 / 本地磁盘驱动），一次请求内按用户解析——每个用户用自己的令牌
- 内存缓存按「大小 + 修改时间」失效；列表刷新只做一次目录请求
- 回收站不是隐藏数据库，而是 OpenList 目录下的 `_trash` 文件夹：删除即移动，恢复即写回

### 安全

- 会话保存在服务端，Cookie `HttpOnly` + `SameSite=Lax`，反向代理下自动启用 `Secure`
- 本地管理员密码用 scrypt 加盐哈希；没有公开注册接口
- 状态变更请求校验 `Origin`；路径规范化防止目录穿越
- 支持「每个用户独立子目录」（`OPENLIST_PER_USER`），多用户互不可见
- 仓库层面：运行时状态与凭据永不入库，`npm run check:repo` 按路径与内容双重拦截

### 与 OpenList 的具体联动

兼容 OpenList v4 及其上游 AList 的接口。面板里的每个操作对应的端点：

| 面板里的操作 | 调用的 OpenList 端点 |
| --- | --- |
| 用 OpenList 账户登录 | `POST /api/auth/login` → `GET /api/me` |
| 登录后校验会话仍然有效 | `GET /api/me` |
| 列出笔记 / 文件夹 | `POST /api/fs/list`（`refresh`、分页参数） |
| 打开笔记 | `POST /api/fs/get` 取 `raw_url`；失败回退 `GET /p/<path>` |
| 保存笔记 | `PUT /api/fs/put`（`File-Path` 头 + 原始字节） |
| 新建文件夹 | `POST /api/fs/mkdir` |
| 重命名 | `POST /api/fs/rename` |
| 移入回收站 / 从回收站恢复 | `POST /api/fs/move` |
| 彻底删除 | `POST /api/fs/remove` |
| 健康探测（决定用不用降级） | `GET /api/public/settings`，可选再探 `GET /api/public/init_status` |

登录：

- 登录页可选「OpenList 账户 / 本地管理员 / 自动」
- 支持 OpenList 的两步验证：返回 `402` 时前端会要求输入动态验证码
- 登录后该会话所有文件操作都用你自己的令牌，OpenList 的权限与 `base_path` 完全生效
- 未实现注册：账号只能在 OpenList 中创建

权限：按 OpenList 返回的权限位掩码判断能力，没有写权限时界面进入只读模式并说明原因。

| 位 | 能力 | 面板中的体现 |
| --- | --- | --- |
| bit 3 | 写入 | 新建 / 保存笔记 |
| bit 4 | 重命名 | 重命名笔记与文件夹 |
| bit 5 | 移动 | 移入回收站 / 恢复 / 换文件夹 |
| bit 7 | 删除 | 彻底删除 |

`OPENLIST_PER_USER` 打开后，每个用户的笔记落在 `<OPENLIST_ROOT>/<用户名>` 下，互不可见。

关于 `OPENLIST_ROOT` 与账号「基础路径」：`OPENLIST_ROOT` 填的是 OpenList 中的绝对路径。
OpenList 会给每个账号加一层「基础路径」(`base_path`)，而且是简单拼接
（`path.Join(basePath, reqPath)`）。所以如果面板把 `/public/Notes` 原样发出去、
而账号基础路径是 `/public`，就会变成 `/public/public/Notes`。

面板会自动换算：先确定 OpenList 的绝对路径，再按当前账号的基础路径取相对路径。

| `.env` 的 `OPENLIST_ROOT` | 账号基础路径 | 实际访问 | 结果 |
| --- | --- | --- | --- |
| `/public/Notes` | `/public` | `/public/Notes` | 正常 |
| `/public` | `/public` | `/public` | 正常 |
| `/public/Notes` | `/`（管理员） | `/public/Notes` | 正常 |
| `/notes` | `/public` | — | 权限不足，面板明确提示 |
| `/other` | `/public` | — | 权限不足，面板明确提示 |

提示形如：

> 只读模式：… / No access to /notes: /notes is outside /public, which is the folder this
> OpenList account is limited to. Change OPENLIST_ROOT, or use an account whose base path contains it.

解决办法：把 `OPENLIST_ROOT` 改成该账号基础路径之内的目录，或改用基础路径覆盖该目录的账号。

本地管理员访问 OpenList 存储时没有个人令牌，需要使用 `OPENLIST_TOKEN`
（OpenList →「设置」→「API」中创建）。

没有安装 OpenList 也能运行：存储驱动三种模式（界面「设置」或 `STORAGE_DRIVER`）：

| 模式 | 行为 |
| --- | --- |
| `auto`（默认） | 先请求 `/api/public/settings`（所有已发布版本都有这个接口），成功后再用 `/api/public/init_status` 判断是否已初始化；结果缓存 8 秒。可达用 OpenList，不可达自动回落本地磁盘，界面显示「本地存储（降级）」 |
| `openlist` | 强制使用 OpenList，不可达时接口返回 `503` 与明确错误信息 |
| `local` | 始终使用本地磁盘（`DATA_DIR/notes`） |

---

## 安装 / 卸载方法

### 环境要求

- **本地开发**：Node.js ≥ 20.19（推荐 22 LTS）
- **服务器安装**：systemd 的 Linux 发行版（Debian/Ubuntu、RHEL/CentOS/Rocky、Fedora、Arch、Alpine 等），
  root 权限，能访问 npm 源（首次安装 Node.js 时会联网）

### 本地开发

```bash
git clone https://github.com/Moistrocic/notes-manager-web.git
cd notes-manager-web
npm install

# 终端 1：后端（默认 http://127.0.0.1:8080）
npm run dev:server

# 终端 2：前端开发服务器（http://127.0.0.1:5173，已配置 /api 代理）
npm run dev:web
```

首次启动若未设置 `ADMIN_PASSWORD`，会自动生成随机密码并打印在日志里，
同时写入 `data/initial-admin.txt`。

生产模式（单进程同时提供 API 和前端）：

```bash
npm run build     # 构建 web/dist 与 server/dist
npm start         # http://127.0.0.1:8080
```

没有 OpenList 也想体验 OpenList 模式？仓库自带一个 OpenList 兼容的模拟服务
（仅实现本项目用到的接口），用于开发与自动化测试：

```bash
node scripts/mock-openlist.mjs --port 5244 --root ./tmp/mock-openlist
# 账号：admin/admin（管理员）、writer/writer；API 令牌：mock-api-token
```

随后在面板「设置」里把 OpenList 地址填成 `http://127.0.0.1:5244` 即可。

### 一键安装（Linux 服务器）

配置写在项目目录的 `.env` 里，安装脚本会读取它：

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

安装完成后脚本会明确打印运行时配置文件的位置（默认 `/opt/notes-manager/.env`），
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

配置优先级（从高到低）：命令行参数 > 项目 `.env` > `NOTES_MANAGER_*` 环境变量 > 内置默认值。
安装后运行期则是：真实环境变量 > 运行时 `.env` > 界面里保存的设置 > 默认值。

> 项目目录里若存在一个没被读取的 `.env`，启动日志会明确告警
> （`... exists but is NOT read - the active configuration file is ...`），不会再出现"改了没反应"。

命令行参数依然可用，且优先级高于 `.env`：

```bash
sudo ./scripts/install.sh --port 8080 --openlist-url http://127.0.0.1:5244 --openlist-token <TOKEN>
```

脚本会依次完成：

1. 检测 / 安装 Node.js（优先系统包管理器 + NodeSource，失败则下载官方 tarball 到 `/usr/local/lib/nodejs`）
2. 创建系统用户与目录：`/opt/notes-manager`、`/var/lib/notes-manager`
3. 读取项目目录的 `.env`（命令行参数优先），解析出本次安装的最终配置
4. 通过 `find -prune` + `tar` 精确拷贝源码（不使用 rsync 的 glob 排除规则，避免误伤
   `server/src/integrations/openlist/` 这类同名嵌套目录；保留已有的 `.env`、`node_modules`），
   随后再次校验关键文件确实落地
5. 校验依赖：比对 `package-lock.json` 的指纹，逐个检查声明的依赖是否真的装上
6. `npm ci` + `npm run build`
7. 把最终配置写入 `/opt/notes-manager/.env`（项目 `.env` 的副本 + 解析结果，权限 600；
   未配置管理员密码时生成随机密码并写入）
8. 写入并启用 systemd 服务 `notes-manager.service`，通过 `Environment=ENV_FILE=...` 告诉应用
   读哪个配置文件（不使用 `EnvironmentFile=`，避免第二份配置源静默覆盖 `.env`）
9. 启动服务并做健康检查，最后打印访问地址、账号密码、运行时配置文件路径与常用命令

常用参数（`sudo ./scripts/install.sh --help` 查看全部）：

| 参数 | 说明 |
| --- | --- |
| `--dir` / `--data` / `--config` | 程序 / 数据 / 配置目录 |
| `--port` `--host` `--base-path` `--public-url` | 监听端口、绑定地址、子路径、对外 URL |
| `--driver auto\|openlist\|local` | 存储驱动 |
| `--openlist-url` `--openlist-token` `--openlist-root` `--openlist-per-user` | OpenList 相关配置 |
| `--admin-user` `--admin-password` `--no-local-auth` | 本地账户 |
| `--skip-deps` `--skip-build` `--force-node` `--no-start` | 精细控制 |

> `--skip-deps` 只在依赖确实没变时才用。安装脚本会保留 `node_modules` 以便快速重装，所以
> `git pull` 带进来的新依赖只有跑过 npm 才会出现；脚本因此在校验 `package-lock.json` 指纹不符时
> 直接拒绝并提示去掉 `--skip-deps`，而不是等到构建时报一个看不懂的错。

> `--base-path` 会被编译进前端资源路径（`VITE_BASE_PATH`），修改后需要重新执行安装或手动
> `VITE_BASE_PATH=/notes npm run build`。

### 卸载

```bash
sudo ./scripts/uninstall.sh           # 停服务、禁用开机自启、删除程序文件，保留数据与配置
sudo ./scripts/uninstall.sh --purge   # 额外删除配置、数据（会二次确认）与系统用户
```

卸载时运行时 `.env` 会备份到 `/etc/notes-manager/notes-manager.env.saved`，即使误删也能找回。
执行 `--purge` 则会连同数据目录一起删除。

### 升级与服务管理

```bash
cd ~/notes-manager-web && git pull
sudo ./scripts/install.sh          # 不要加 --skip-deps
```

```bash
systemctl status notes-manager
systemctl restart notes-manager
journalctl -u notes-manager -f
sudo ./scripts/doctor.sh           # 诊断：服务 / 配置 / 从服务器发起的连通性测试
```

---

## 许可声明

本项目基于 **MIT 许可**发布，完整条款见仓库根目录的 `LICENSE` 文件。

### 第三方资源

| 资源 | 位置 | 许可 |
| --- | --- | --- |
| Cascadia Code 字体 | `web/public/fonts/CascadiaCode.woff2` | SIL OFL 1.1（见 `web/public/fonts/CascadiaCode-LICENSE.txt`）。Microsoft 版权所有，保留字体名 Cascadia Code；文件原样分发、未改名、未修改 |

字体随前端一起构建到 `web/dist/fonts/`，因此部署后无需联网即可使用。想换成别的内置字体，
把字体文件放进 `web/public/fonts/` 并在 `web/src/lib/builtin-fonts.ts` 里加一条即可。

直接依赖共 19 个：16 个 MIT、1 个 BSD-3-Clause、1 个 ISC、1 个 MPL-2.0 或 Apache-2.0 双许可，
不含 GPL / AGPL 类传染性许可。

### 与 OpenList 的关系

OpenList 是由 OpenList Team 独立维护的 Go 项目，遵循
[AGPL-3.0](https://github.com/OpenListTeam/OpenList/blob/main/LICENSE)。
本项目与它在代码层面完全无关：

| 项目 | 说明 |
| --- | --- |
| 是否包含 OpenList 源码 | 否。仓库中 `*.go` 文件数量为 0；本项目是 TypeScript / React 项目 |
| 是否修改 OpenList | 否。开发期 clone 的 `openlist/` 仅作只读参考，已被 `.gitignore` 忽略，不随本仓库分发（`git ls-files openlist` 为空） |
| 是否链接 / 内嵌 OpenList | 否。两者是各自独立运行、各自独立部署的进程 |
| 交互方式 | 仅通过 HTTP 网络接口调用 OpenList 的公开 REST API |

因此本项目不构成 OpenList 的衍生作品，适用自身的 MIT 许可。

关于 API 与代码的区分：HTTP 端点路径、JSON 字段名、请求参数属于功能性接口，而非受版权保护的表达。
`server/src/integrations/openlist/client.ts` 是本项目自行编写的 TypeScript 客户端
（目录名已明确标注为 `integrations`，即"集成适配层"），它只负责按 OpenList 的接口约定收发 JSON。
这与"浏览器实现 HTTP 协议""数据库驱动实现某数据库的线协议"属于同一性质。

> 以上是工程层面的判断，不构成法律意见。若你的使用场景对合规有更高要求，请咨询专业律师。
> 此外，你自己若修改 OpenList 源码并对外提供服务，需要遵守 AGPL-3.0 的相应义务。
