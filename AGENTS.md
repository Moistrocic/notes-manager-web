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
| 存储能力（本地与 OpenList 各实现一次） | `server/src/storage/*.ts` + `server/src/integrations/openlist/client.ts` |
| 前端全局状态（只有一个 store） | `web/src/store/useAppStore.ts` |
| 目录树 / 左侧面板 | `web/src/components/NoteTree.tsx` / `NoteList.tsx` |
| 编辑器与预览 | `web/src/components/{Editor,CodeEditor,Preview}.tsx` + `web/src/lib/markdown.ts` |
| 全站右键菜单 | `web/src/components/ContextMenu.tsx` |
| 博客（公开页面与公开接口） | `web/src/components/blog/**` + `web/src/lib/blog-api.ts` + `server/src/http/routes/blog.ts` |
| 地址与深链（站点根 `/` 是博客，面板在 `/manager/` 之下） | `web/src/lib/url.ts` |
| 主题变量（颜色/间距只定义一次） | `web/src/styles.css` |

## 几个坑

- **非笔记文件没有 front matter**：它的 `id` 由路径派生，改名 / 移动 / 进回收站都会变。
  前端要跟随接口返回的 `id`（store 已有先例），服务端删除接口会把回收站里的新 `id` 一并返回。
- **批量操作读的是 store 里的 `selection`**：先移动、后清空；反了会让批量移动静默变成空操作。
- **拖放与多选的区分**：位移 > 8px 是拖动，按住不动满 300ms 才进多选。拖动过程的中间态不要写进 selection。
- **发布标记在 front matter 的 `blog` / `blogAt`**：博客只列这两项齐全的笔记。
  公开取图必须走 `/api/blog/file`（面板的 `/api/notes/file` 会先要账号），
  而它的白名单只认「已发布笔记引用过的文件」——换了取图地址就会 404，不是权限问题。
- **上传接口固定发 `application/octet-stream`**：`express.json()` 挂在前面，浏览器对 `.json` 会报 `application/json`，
  那样 body 会被先解析掉、拿不到字节。
- **jsdom 没有 `document.elementFromPoint`，也没有暴露 `DOMParser`**：手势与图片解析的断言要先打桩；
  `AnimatePresence` 的退出动画在 jsdom 里不跑，“某东西消失了”的断言要等一等（dom-check 的 `settled()`）。
- **`.env` 里的 `ADMIN_PASSWORD` 每次启动都会覆盖存档哈希**：在面板里改过密码之后要把它删掉，
  否则重启又变回去。本仓库开发时服务跑在 8080，账号 `admin`。
- **`data/` 被 .gitignore 忽略**：`rg`/`grep` 默认跳过它，查本地笔记内容要用 `Select-String` 之类。
- **Windows 上偶发 `ReplaceFileW EIO`**：文件被杀毒/编译器临时占用，重试一次即可。
