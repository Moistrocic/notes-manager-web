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
| 公式（KaTeX）与 markdown 渲染规则 | `web/src/lib/markdown.ts`：五条 tokenizer/renderer 扩展（`$$…$$` 块级与单行、`$…$`、`\[…\]`、`\(…\)`）、`PURIFY_CONFIG`（html + mathMl + svg profile）、只放行 `.katex` 里 `style` 的 hook |
| 排序优先级（四个键的先后） | store 的 `sortKeys` / `normaliseSortKeys` / `setSortKeys` / `moveSortKey` + `NoteTree.tsx` 的 `compareNotes`（树与列表共用）；localStorage `notes-manager-sort-keys`，旧键 `notes-manager-sort` 同步写 |
| 大纲折叠 | `web/src/lib/outline.ts` 的 `buildOutlineTree` / `collapsibleHeadingIndexes` / `visibleOutlineRows` + `OutlinePanel.tsx`（默认收起、全部展开/收起；导航仍用扁平 index） |
| 壁纸（含自定义壁纸） | `web/src/lib/wallpaper.ts` + `components/Wallpaper.tsx` + `components/CustomWallpaper.tsx`（rAF 写 transform + 库 ParticleSystem 画粒子）+ `web/src/lib/scene/pkg-wallpaper.ts`（.pkg → layer 0 贴图 → 回退 `renderSceneStill` → 缩图）+ `AppearanceDialog.tsx`；管理员默认背景在 `lib/admin-background.ts` + `SettingsDialog.tsx` |
| 「新建笔记」的默认目录 | store 的 `lastFolder`（`selectNote` 记笔记所在目录、树里点文件夹记该路径；`renameFolder` / `moveFolder` 跟随、`deleteFolder` 清空）+ `NoteList.tsx` 的 `lastFolder → newNoteFolder`（目录不在列表里时回退根目录） |
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
- **服务令牌也有自己的 `base_path`**：OpenList 把每个请求路径 join 到账号的 base_path 上
  （`user.JoinPath` → `JoinBasePath`），所以绝对路径的 `OPENLIST_ROOT` 必须先换算成该账号看到的
  路径再发。会话用户带 `openlistBasePath`；**服务令牌没有会话**（面板回退时才用它读），
  `resolve()` 会调一次 `client.me()` 问出 base_path 并按 token 缓存 5 分钟（`invalidateProbe()`
  一并清掉）。拿不到就退回 `/`（与旧版一致，不新增失败）。忘了这一步的表现：把
  `/public/Notes` 原样发给 jail 在 `/public` 的账号 → OpenList 去找 `/public/public/Notes` →
  `object not found` → 报「读不到根目录」。断言在 `scripts/test-openlist.mjs` 的 jail 一段。
- **博客读 OpenList 用的是 guest 身份，不是令牌**：匿名请求在 OpenList 里就是它的 guest 账号
  （`middlewares/auth.go`：token 为空即访客），`routes/blog.ts` 的三个接口都带 `asGuest: true`，
  `resolveGuest()` 匿名问一次 `/api/me` 拿 guest 的 `base_path` 再换算路径（5 分钟缓存）。
  别改回「用服务令牌读」：令牌账号能看到的目录未必是发布者看到的那个（断言：令牌被限制在
  `/private`、访客能看 `/public` 时，面板 403 而博客正常）。guest 被禁用时博客必须报
  403 `openlist_guest_disabled` 并说清怎么办——OpenList 出厂默认禁用 guest，所以**开启博客的
  前提就是允许访客访问**；guest 被 jail 则是 403 `openlist_forbidden`（消息里带 base_path）。
  这与 `settings.guest.enabled`（面板游客开关）无关：那个开关只管面板，关掉博客照常读。
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
- **拖放落点：文件行的目录要从 summary 读，不能从 id 推**。非笔记文件没有 front matter，服务端发的
  `id` 是 `hashId(path)`（`f`+16 位十六进制），**不是路径**——想拿它所在目录必须读
  `summary.folder`（`NoteTree.tsx` 的 `dropTargetAt`）；用 `parentPath(id)` 会永远得到根目录，
  表现为「拖到某目录里的图片上，却移到了根目录」。
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
- **同步滚动的回声按「期望值」抑制，不是只靠一帧**：写入一侧后记下**浏览器实际落点**
  （`scrollTop` 读回值会被夹到可滚范围），对侧 `scroll` 到达时若与该期望相差 ≤2px 就当作自己的回声
  跳过。所以「用户滚了一次 → 对侧一定被写一次」并不总成立：先等一帧、必要时再比对实际 scrollTop，
  别把一次滚动事件当成一次镜像写入。
- **预览比输入晚一拍（`PREVIEW_SETTLE_MS = 120ms`）**：编辑栏即时回显，右侧预览在打字停顿后
  才重渲染（整篇 marked + DOMPurify + 标注 + 取图，1600 行约 160ms，以前是每次按键都付）；
  **切换笔记立即显示**，不延迟。断言里「敲字后立刻检查预览内容」要等 ≥150ms 再断言，
  或者先断言旧内容、等一拍再断言新内容——直接读会读到上一版。
- **公式是五条 marked 扩展，写在自己这里是有原因的**：`marked-katex-extension` 的 peer 范围卡在
  已被废弃的 KaTeX 0.18（那个版本是误发布），用它要么装废弃版、要么打包两份 KaTeX。规则在
  `markdown.ts` 顶部，渲染统一走 `typesetFormula`（`throwOnError: false`，写错就地标出、不抛）。
  KaTeX 的 `style` 属性是排版必需，但只允许出现在 `.katex` 里（`uponSanitizeAttribute` hook）；
  MathML/SVG 靠 `USE_PROFILES` 放行。KaTeX 字体约 1MB、59 个文件，是前端体积的主要来源。
- **排序优先级只有一个真相：store 的 `sortKeys`**。`compareNotes` 收整条顺序（树与列表共用同一份），
  单键 `sort` 只是 `sortKeys[0]` 的兼容视图。旧版本只存 `notes-manager-sort`，升级迁移只发生在
  「没有 `notes-manager-sort-keys`」时（旧键当主键、其余按默认补齐）；写入时两个键都要写，
  老版本读到主键才不会退回默认。
- **大纲折叠只是「画哪些行」，不改导航索引**：`visibleOutlineRows` 决定画哪些，扁平 `index`
  永远是 `extractHeadings` 里的位置（`onNavigate(heading, index)` 用的就是它）。折叠状态是
  `OutlinePanel` 的局部 state，按 `activeNote.id` 重置——切换笔记必须回到「全部收起」，
  但同一篇笔记里编辑不要重置（否则刚展开的章节会在打字时自己合上）。
- **自定义壁纸「有图片才动」，且不再被 reduced-motion 停掉**：晃动由一个 rAF 循环直接写
  `[data-custom-image-frame]` 的 `transform`（与粒子同一个循环，按库的 `oscillateposition` 精确算），
  粒子画在 `[data-custom-particles]` 上；没有 2D 上下文时晃动照常跑、只是不画粒子。
  粒子**不是手写噪声**：用库的 `ParticleSystem`（`createLibraryParticles`）跑仿真，`buildVertices`
  取四边形、实测的 halo 贴图 + `globalCompositeOperation='lighter'` 加色绘制，再挂一个 glow
  子发射器（放大 ~20 倍、全屏时 alpha 压到 0.02–0.06）；开屏前 `warmUpLibraryParticles` 预热
  3.2 秒（预设 starttime 是 3s）。断言里先固定 `Math.random`（mulberry32）再取统计量，
  否则 aliveCount / 尺寸类断言会偶发红。
  `prefers-reduced-motion` **不整体停用**（场景库也一样会动），显式开关
  （`customSway` / `customShowParticles`）才是唯一的停用方式——断言里「reduced-motion 下 0 次 rAF」
  已翻成「仍然调度、transform 帧间变化」。没有图片时仍渲染 `[data-custom-placeholder]` 主题渐变占位。
  清理在 effect 的 cleanup 里（`cancelAnimationFrame`、resize / visibilitychange / matchMedia 监听），
  否则切走壁纸后还在画；DPR 上限 2。
- **别再用 framer-motion 的 keyframes 做壁纸晃动**：首挂那次动画不启动，背景图会停在第一帧
  （真实 Chromium 上肉眼可见）；要「挂上就动、暂停能停、卸载能清」就用 rAF 自己写 transform。
- **自定义壁纸的导入也收 `.pkg`**：`lib/scene/pkg-wallpaper.ts` 走 `scene.json → layer → model →
  material → passes[].textures[0]` 找 `materials/<name>.tex`（引擎内置贴图如 `particle/halo`
  不在包里，会继续找下一张），取**不超过 4096 的 mip**、非 2 次幂的 RGBA 裁回真实尺寸；
  PNG/JPEG 直接取字节，其余用库的纹理解码器。取不到就走 `renderSceneStill` 渲一帧，再走缩图。
  错误消息要能看懂：「这不是 .pkg 场景包」「这个场景包是空的」「这个文件不是 Wallpaper Engine
  的场景包（scene.pkg）」。测试用 `data/backgrounds/rossi.pkg`（gitignored，本机有）。
- **两个自定义壁纸的预览区已经删掉，别再找 `[data-custom-preview]` / `[data-admin-custom-preview]`**
  （用户要求去掉，取景区 `[data-crop-section]` 就是唯一的画面）；断言要断言它们**不存在**。
- **自定义壁纸的取景区与晃动写在不同元素上**：图片按 `cropMediaStyle(crop)`（width/height/left/top）
  摆在自己的 img 上，晃动写在外层 frame 的 transform 上（满幅时才用 `object-cover`）——
  两者不能写同一个元素，否则一次晃动会把取景覆盖掉。外观对话框与管理员设置都渲染同一个
  `CropSection`（`[data-crop-section]`，8 个 `aria-label="调整 …"` 手柄），没图片时只给提示。
- **`lastFolder` 是「新建笔记默认目录」的唯一来源**：`selectNote` 写笔记所在目录、树里点文件夹写
  该路径；`renameFolder` / `moveFolder` 会让它跟着改，`deleteFolder` 清空。对话框打开时还要再查
  一遍「这个目录现在还在不在」——不在就回退根目录，不能把一个不存在的路径塞进输入框。
- **PromptDialog 的输入框带着反自动填充属性**（`NoteList.tsx` 的 `PROMPT_INPUT_GUARDS`）：
  `autocomplete/autocorrect/autocapitalize=off`、`spellcheck=false`、三家密码管理器的 opt-out，
  而且 `name` 不能叫 username/password 这类。新增输入框别忘了带上，否则 Bitwarden 会在一个
  只是问「文件夹叫什么」的小框上弹「保存密码」。
- **Bitwarden 认的不是属性，是输入框的类型**：提示框里的输入统一 `type="search"`（Bitwarden 的
  content script 收集字段时无条件跳过 search，登录填充也排除它）。`data-bwignore` 只有在扩展设置里
  打开「页面可控属性」时才生效——**有属性不等于生效**，别把它当成修复；`appearance-none` + 隐藏
  webkit 搜索装饰只是把外观还原成普通输入框。旧扩展若仍识别，升级扩展或对本站点关闭自动填充。
- **新建笔记的目录可以还不存在**：确认时先 `createFolder(silent)` 再 `createNote`，目录建失败就
  不发建笔记请求（`NoteList.tsx` 的 onConfirm）；移动 / 上传仍要求精确匹配已有目录。路径先过
  `normaliseFolderInput`（`a//b` → `a/b`，`.` / `..` 段直接拒绝并提示），服务端 `createFolder`
  也会拒绝含 `..` 的路径（400 `invalid_folder`），递归建目录由 driver 保证（本地 `mkdir -p`，
  OpenList 逐段 `/api/fs/mkdir`）。
- **排序下拉的两个手势互斥**：单击 = 置顶（`setSort`），长按 300ms 后拖动 = 重排整条顺序
  （`setSortKeys`）——拖动结束后浏览器补发的那次 click 必须被吞掉（`swallowClick`），否则拖完就
  顺手置顶了。jsdom 里测拖动要自己派发 pointerdown、真实等 320ms、再 pointermove/pointerup；
  没有布局时行高按 `SORT_ROW_HEIGHT=28` 折算。
- **目录建议是 portal 到 body 的浮层，不是对话框里的绝对定位**：Modal 的内容区是
  `overflow-y-auto`，字段内的 absolute 浮层会在滚动边缘被裁掉；浮层挂在 body 上还带来一个好处——
  它不参与对话框布局，出现/消失**不会改变对话框高度**（hint 那行因此常驻 `min-h-4` 占位）。
  断言要用 `document` 查（不在对话框子树里找），并注意 field 的 onMouseDown preventDefault
  （键盘留在输入框）、focusout 后延迟 ~150ms 才收起、Esc 先关列表再关对话框。
- **自定义壁纸只有 7 个参数，并且语义对齐场景库**：`resolveCustomEffect()`（web）与
  `mergeSettings`（server）是唯一补默认/夹范围的地方；开关是 `customSway` / `customShowParticles`，
  数字是 `customSwayAmplitude`（0–8% 短边）/ `customSwayFrequency`（0.02–0.5 Hz）/
  `customParticleRise`（0–500）/ `customParticleDrift`（0–400）/ `customParticleDirection`（0–1）。
  映射：晃动 = 库 `oscillateposition`（x=sin、y=cos，由 rAF 循环直接写 transform，图片放大
  `1 + 2·amplitude% + 0.01` 才不会露出边缘）；粒子 = `ParticleDriftOptions`
  （rise / speed / forwardRatio，spread 固定 0.6）；场景单位→px 用库的 3840×2160 正交视图
  cover 换算（`sceneUnitScale`）。**没有图片时是主题渐变占位（`data-custom-placeholder`），
  不吃 crop/blur，只有 dim 生效**。
- **1.5.x 的旧壁纸参数是「忽略 + 补默认」迁移**：`customA/customB/customDrift/customDensity/
  customParticle*` 等留在 `WallpaperSettings` 上只为让旧 settings.json 与老 fixture 通过类型检查，
  读写都不再用（服务端同样忽略）；不要把它们重新接回 UI 或渲染 —— 旧客户端发这些字段只应
  得到 200 与新默认值（test-server 有一条兼容断言）。
- **deprecated 兼容层的可删条件**：那些 @deprecated 导出/字段（`CUSTOM_DEFAULTS`、
  `CUSTOM_WALLPAPER_SLIDERS`、`resolveCustomWallpaper`、`customParticleCount`、`customBackdrop`
  之外的旧粒子配置）在 `grep` 结果为 0 引用后由 Lead 决定删除；删之前 `resolveCustomEffect` +
  `CUSTOM_EFFECT_*` 必须已经是唯一入口（当前断言已全部切到新表面）。
- **`api.request` 不允许再返回 `(payload ?? {})`**：200 + 空 body、200 + 非 JSON、JSON `null`
  都必须抛 `ApiError(..., 'bad_response')`；调用方不得信任「200 就一定是 JSON」。列表接口还要在
  store 里再校验一遍（`refreshNotes`：notes 必须是数组，否则保留上一次的列表并设置可读的
  `notesError`；tags/folders 只接收数组，畸形条目丢弃；stats/capabilities 走 normalise）。
  真实事故：`/api/notes` 返回 200 + `{}`，列表被写成 `undefined`，`CommandPalette` 的
  `notes.filter` 让整页崩掉——现在 `CommandPalette` 也做了防御，但根因在入口。
- **启动页与错误边界**：`web/index.html` 里有一段内联兜底（`#boot` 占位、`data-boot-state`、
  `#boot-line` / `#boot-error` / `#boot-reload`、`window.__boot`、`vite:preloadError` → 自动刷新
  一次（`notes-manager-boot-reloaded-at`、10s 防抖）、`MOUNT_TIMEOUT_MS = 12000`）。改 index.html
  时这些钩子一个都不能删——它们是白屏时唯一的说明；`main.tsx` 在第一次 commit 后调用
  `__boot.markMounted()` 移除占位。根 `ErrorBoundary`（`main.tsx`）显示「页面出错了」面板 +
  `error-reload` / `error-clear-cache`；壁纸有**自己的一层** `ErrorBoundary`（`Wallpaper.tsx`，
  fallback 是 `data-testid="wallpaper-fallback"` 的颜色渐变，按 kind/url 重新挂载），所以壁纸崩了
  只回退背景，面板不受影响。
- **静态 404 的契约**：`/assets/*` 与常见静态扩展名（js/css/map/svg/图片/字体/wasm/视频/pkg 等，
  见 `app.ts` 的 `STATIC_ASSET_EXTENSIONS`）找不到时回 **404 text/plain**，不回落 index.html，
  并打一行 `static asset not found, likely a stale page: <path>`；页面路由（`/`、`/manager/`、
  笔记地址）才回落 index.html；`/api/*` 未知路径仍是 404 JSON。这条日志是「用户说黑屏」时判断
  旧版本的第一线索。
- **`POST /api/background` 是管理员专用的裸字节上传**（和笔记/字体上传同一种形状）：octet-stream、
  文件名在 `X-Background-Filename`（percent-encoded）、上限 20 MB、**扩展名由 magic 嗅探决定**
  （`.webp`/`.png`/`.jpg`/`.gif`），body 为空 400 `empty_body`、不是图片 400 `invalid_background`、
  匿名 401、非管理员 403；201 返回 `{file, available}`。`PUT /api/system/settings` 选 kind=custom 时
  还会校验文件存在（400 `background_missing`）且是图片（`background_kind_mismatch`）。
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
