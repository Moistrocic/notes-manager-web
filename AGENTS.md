# AGENTS.md

在这个仓库里动手的规矩。这份文件每轮都在上下文里，所以只写**必须知道、又没法从代码里一眼看出来**的东西：
项目是什么、怎么安装、有哪些功能，都在 [README.md](README.md)；命令与脚本在 [package.json](package.json)。

## 铁律：做完就提交

**每完成一个功能、或修好一个缺陷，立刻提交一次 commit。** 一个提交只做一件事；攒着最后一起提交，
可回溯的历史就没了，出问题时也定位不到是哪一步引入的。

收工标准是这条命令全绿（它覆盖 CI 会跑的全部检查）：

```bash
npm run check
```

红了先修再提交，修不动就在提交信息里写清楚红在哪、为什么先交。
提交信息用 Conventional Commits（feat / fix / refactor / test / docs / chore / perf）：
主题行写**做了什么**，正文写**为什么**——为什么这样改、放弃了哪条路、拿什么验的（实测数字、命令、断言数）。
新文件记得 `git add`：`check:repo` 会比对磁盘与 git 跟踪的文件，未跟踪即失败。
运行时状态（`data/`、`.env`、`sessions.json`、`settings.json`）一律不入库。

## 写断言

用户能看到的行为，用断言钉住，别只靠手点：
面板与编辑器是 [web/dom-check.tsx](web/dom-check.tsx)（jsdom 里渲染真实组件），
SSR 场景是 [web/render-check.tsx](web/render-check.tsx)，
store 的时序是 [web/store-check.tsx](web/store-check.tsx)，
HTTP 端到端是 [scripts/test-server.mjs](scripts/test-server.mjs)。
新增样式变量、URL 规则这类“纯规则”，写成纯函数再断言它，比截图式断言稳。

## 代码地图

| 要改的东西 | 去处 |
| --- | --- |
| 笔记/文件的后端行为：扫描、读写、改名、移动、回收站、统计 | `server/src/notes/repository.ts` + `server/src/http/routes/notes.ts` |
| 存储能力（本地与 OpenList 各实现一次） | `server/src/storage/*.ts` + `server/src/integrations/openlist/client.ts`；OpenList 的假后端与端到端断言在 `scripts/fake-openlist.mjs` / `scripts/test-openlist.mjs` |
| 前端全局状态（只有一个 store） | `web/src/store/useAppStore.ts` |
| 目录树 / 左侧面板 | `web/src/components/NoteTree.tsx` / `NoteList.tsx` |
| 编辑器与预览 | `web/src/components/{Editor,CodeEditor,Preview}.tsx` + `web/src/lib/markdown.ts` |
| 分栏两侧的滚动同步 | `web/src/lib/scroll-sync.ts`（源码行 ⇄ 预览位置的映射）+ `markdown.ts` 的 `sourceBlocks` / `annotateSourceLines` + `Editor.tsx` 里的 `data-sync-scroll` 按钮与监听 |
| 全站右键菜单 | `web/src/components/ContextMenu.tsx` |
| 博客（公开页面与公开接口） | `web/src/components/blog/**` + `web/src/lib/blog-api.ts` + `server/src/http/routes/blog.ts` |
| 发布管理（把笔记发布到博客上） | `web/src/components/publish/**` + store 的 `setPublish` / `forgetPublish` + `server/src/http/routes/notes.ts` 的 `/api/notes/publish` |
| 地址与深链（站点根 `/` 是博客，面板在 `/manager/` 之下） | `web/src/lib/url.ts` |
| 主题变量（颜色/间距只定义一次） | `web/src/styles.css` |

## 几个坑

- **非笔记文件没有 front matter**：它的 `id` 由路径派生，改名 / 移动 / 进回收站都会变。
  前端要跟随接口返回的 `id`（store 已有先例），服务端删除接口会把回收站里的新 `id` 一并返回。
- **OpenList 的 `move` 是异步任务，`rename` 与 `put` 是同步的**：`/api/fs/move` 把任务排进队列
  就回 200（fsmanage.go：*Create all tasks immediately without any synchronous validation*），
  「搬完了」必须自己轮询确认（driver 已做：目标出现且源消失，超时报 504 `openlist_move_pending`）。
  另外笔记改名必须走 `rename`：**绝不能「写新文件 + 删旧文件」**——在 OpenList 上写就是上传，
  文件会换一个身份，旧文件删不掉时两份并存，用户看到的就是「改了名还是旧名字」。
- **改 OpenList 相关行为前先读本仓库 `openlist/` 下的 Go 源码**：`server/handles/fsmanage.go`
  （FsRename / FsMove / FsCopy 的真实语义）与 `fsup.go`（PutDirectly 要求父目录存在）。
  `scripts/fake-openlist.mjs` 就是照它写的，改行为要连假后端一起改，否则测试会替一个
  不存在的服务背书。
- **auto 模式绝不静默退回本地**：OpenList 已配置但连不上时 `StorageManager.resolve()` 抛
  `StorageError(503, openlist_unreachable)`，不再返回 `degraded` 的本地驱动。本地树不是 OpenList 的
  副本，断线时写进去的笔记会在 OpenList 恢复后从面板和博客里一起消失（Lead 用假 OpenList 复现过：
  降级时发布 → 恢复后 `GET /api/blog` 200 但 posts=0、面板里也看不到那篇）。只有「没配
  OpenList」才用本地——那时本地就是存储本身；选「本地」同理。
- **OpenList 的 `list()` 只允许对非根目录吞掉 not-found**：子目录不见了当空目录（扫描会走到
  已经删掉的目录），但**配置的根目录读不到必须报错**（`openlist_root_missing`，消息里带
  remote 根路径）。当成空目录的话，错的 `OPENLIST_ROOT`／不属于同一账号的令牌会表现成
  「面板没有笔记」「博客还没有内容」，而不是一个能查的错误——这条有断言
  （`scripts/test-openlist.mjs` 里把假后端的根删掉再读博客）。
- **批量操作读的是 store 里的 `selection`**：先移动、后清空；反了会让批量移动静默变成空操作。
- **拖放与多选的区分**：位移 > 8px 是拖动，按住不动满 300ms 才进多选。拖动过程的中间态不要写进 selection。
- **同步滚动按源码行，行号来自 lexer 各 token 的 `raw` 换行累计**：`sourceBlocks` 数的是
  「前面出现过多少个 \n」，**不要**改成按行 `split` 计数——空行 token 的 `raw` 带着上一行结尾的
  换行，一段一段数下来每遇到一个空行就整体漂一行（踩过，已修）。
- **滚动同步的断言要自己搭舞台**：jsdom 没有布局，预览的块几何要用 `Object.defineProperty`
  给出 `getBoundingClientRect`、`scroll` 事件得自己派发（改 `scrollTop` 不会触发它）；
  测试自己为摆位置写 `scrollTop` 也会走记录 setter，断言前要先把这份记账清掉。
  被测的那一侧刚被写过会忽略自己那一帧的事件（防回声），所以模拟「用户滚动被镜像的那一侧」
  之前要**等一帧**（`await flush()`），否则什么都不会发生——那是预期，不是 bug。
  点大纲/锚点之后预览有一段「自己在滚」的时间（`PreviewApi.isSelfScrolling()`），这段时间不镜像；
  jsdom 里 `scrollTo` 被打桩、不会自己产生 scroll 事件，所以那段等于 300ms 兜底计时——
  要在同一个场景里测镜像，就先等它过去。
- **发布信息在 front matter 里**（`blog` / `blogAt` / `blogTitle` / `blogSummary`）：
  博客只列 `blog` 为真的笔记。**取消发布**只写 `blog: false`——留痕，发布管理里那一行还在、
  状态是未发布；**删除发布信息**才把四个字段一起清掉。`blogTitle` 等于笔记自己的标题时
  不要写成覆盖值（送空串）：存下来会把卡片标题冻住，笔记之后改名，卡片就不再跟着变。
- **公开取图必须走 `/api/blog/file`**（面板的 `/api/notes/file` 会先要账号），
  而它的白名单只认「已发布笔记引用过的文件」——换了取图地址就会 404，不是权限问题。
- **发布弹窗在 SSR 里也会被渲染**：`NoteList` 一直挂着 `PublishDialog`（关着也挂），
  所以它内部不能在组件体里无条件调 `renderMarkdown`——Node 里 DOMPurify 没有 DOM，
  一调就 `DOMPurify.sanitize is not a function`，整个面板都别想服务端渲染。
- **上传接口固定发 `application/octet-stream`**：`express.json()` 挂在前面，浏览器对 `.json` 会报 `application/json`，
  那样 body 会被先解析掉、拿不到字节。
- **jsdom 没有 `document.elementFromPoint`，也没有暴露 `DOMParser`**：手势与图片解析的断言要先打桩；
  `AnimatePresence` 的退出动画在 jsdom 里不跑，“某东西消失了”的断言要等一等（dom-check 的 `settled()`）。
- **`.env` 里的 `ADMIN_PASSWORD` 每次启动都会覆盖存档哈希**：在面板里改过密码之后要把它删掉，
  否则重启又变回去。本仓库开发时服务跑在 8080，账号 `admin`。
- **`data/` 被 .gitignore 忽略**：`rg`/`grep` 默认跳过它，查本地笔记内容要用 `Select-String` 之类。
- **Windows 上偶发 `ReplaceFileW EIO`**：文件被杀毒/编译器临时占用，重试一次即可。
