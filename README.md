# 笔记管理面板 · notes-manager-web

一个自托管的 Markdown 笔记管理面板：笔记以普通 `.md` 文件直接存放在 OpenList 目录里，
可以用你自己的 OpenList 账户登录；服务器上没装 OpenList 时也能正常运行。

## AI 开发提示

> 这个项目由 AI 结对开发：绝大部分代码是在与 AI 助手的对话中写成的，人类负责提需求、
> 验收与决策。所以注释、测试与提交信息都写得比较"自解释"，不必先把全部代码读一遍。

**改完必须跑**（CI 会原样执行这一整套）：

```bash
npm run check:repo && npm run typecheck && npm run test:server && npm run check:web
# 动过 scripts/*.sh 再补：
npm run test:installer
shellcheck --severity=warning scripts/install.sh scripts/uninstall.sh scripts/test-install.sh scripts/doctor.sh
```

**约定**

- 提交信息用 Conventional Commits，一个提交只做一件事
- 运行时状态一律不入库（`.env`、`data/`、`sessions.json`、`settings.json`）；
  `npm run check:repo` 会按路径和文件内容双重拦截
- `openlist/` 只是阅读用的只读参考，不修改、不提交
- 用户可见的行为要有断言（`web/dom-check.tsx` 或 `scripts/test-server.mjs`），不要只靠手点
- 同一个颜色 / 字体 / 尺寸只写一处，别在仓库里出现两份

**两个坑**

- `scripts/test-install.sh` 用 `awk` 从 `install.sh` 里按函数名抽取真实函数体执行，
  判据是"第一个第 0 列的 `}`"，所以内嵌的 shell / JS 片段必须缩进，否则抽取会中途截断
- `.gitignore` 里的模式要加前导 `/`：曾经写了不带斜杠的 `openlist/`，
  把 `server/src/integrations/openlist/` 一起忽略了，源码没进仓库

## 功能介绍

**笔记**

- 普通 Markdown 文件 + YAML front matter（标题、标签、置顶、收藏、颜色），
  可直接在 OpenList 里查看、编辑、同步
- 手动放进目录的 `.md` 会被自动识别，没有 front matter 也能解析
- 编辑器 / 分栏 / 预览三种模式，分隔条可拖动、双击恢复居中
- 实时预览（GFM、表格、任务列表），代码块按语言高亮，140+ 种语法包按需加载
- 编辑与预览共用同一套代码配色（VS Code Dark+ / Light+），字体字号行高也一致
- 大纲面板可折叠；点击大纲同时滚动编辑区与预览，并在预览中高亮落点
- 全文检索、标签筛选、嵌套文件夹（可建 `a/b/c` 多级）、置顶 / 收藏 / 颜色标记
- 回收站：删除 → 撤销 → 恢复 → 彻底删除
- 自动保存：内容没有实际变化就不写入，防抖 900ms + 状态指示
- 深链与锚点：地址栏始终反映当前笔记与位置，可直接分享；笔记内的
  `[文字](#锚点)` 与 `[文字](./另一篇.md)` 均可点击跳转
- 命令面板（`Ctrl/⌘ + K`）、快捷键、专注模式、Toast 撤销
- 列表三种视图（卡片 / 网格 / 仅标题），左侧栏可整体隐藏

**外观**

- 深色 / 浅色主题，动态极光背景，玻璃拟态面板，全流程过渡动画
- 字体：内置 Cascadia Code（代码字体默认就是它，无需联网下载）；管理员还可上传
  woff2 / woff / ttf / otf，分别指定界面字体与代码字体，重启后依然生效
- 壁纸：图片链接 / 本地图片或视频 / 本地壁纸库三种来源，可调模糊、暗度、缩放
  - 壁纸库会从你授权的目录里自动定位 Wallpaper Engine 的壁纸总文件夹，
    按每个壁纸一格展示预览图
  - 场景壁纸（`scene.pkg`）浏览器无法播放，会改用它的 `preview.jpg` /
    `preview.gif` 作静态背景（GIF 会动），并在格子上标注「静态」
- 壁纸只存在浏览器本地，不上传服务器

**与 OpenList 的联动**

- 用 OpenList 账户登录（支持两步验证）；登录后所有文件操作都用你自己的令牌，
  OpenList 侧的权限与基础路径限制完全生效
- 笔记就是 OpenList 目录里的 `.md` 文件；新建、重命名、删除、回收站都直接作用于该目录
- 回收站是 OpenList 目录下的 `_trash` 文件夹，不是隐藏数据库
- 没有写权限的账号自动进入只读模式；只读云盘也能正常浏览
- 每个用户可以用独立的子目录（`OPENLIST_PER_USER`），互不可见
- 本地管理员要访问 OpenList 存储，需要一个 API 令牌（OpenList →「设置」→「API」中创建）
- 没装 OpenList 也能用：连不上时自动改用本地磁盘，界面标注「本地存储（降级）」，
  之后填上地址即可无缝切换
- `OPENLIST_ROOT` 填 OpenList 里的绝对路径；如果它不在账号的基础路径之内，
  面板会明确提示权限不足

## 安装与卸载

**要求**：systemd 的 Linux 发行版，root 权限，能访问 npm 源。

### 安装

配置写在项目目录的 `.env` 里：

```bash
git clone https://github.com/Moistrocic/notes-manager-web.git
cd notes-manager-web
cp .env.example .env      # 端口、OpenList 地址、管理员账号都在这里
vi .env
sudo ./scripts/install.sh
```

脚本会装好 Node、把程序拷到 `/opt/notes-manager`、构建、写配置、注册并启动 systemd 服务，
最后打印访问地址与账号密码。更多参数见 `sudo ./scripts/install.sh --help`。

**安装后要改配置，改的是运行时那一份**（默认 `/opt/notes-manager/.env`），
不是项目目录里的 `.env`。它的位置在安装结束的摘要、服务启动日志、
以及界面「设置 → 服务器配置文件」里都能看到：

```bash
sudo nano /opt/notes-manager/.env
sudo systemctl restart notes-manager
```

### 卸载

```bash
sudo ./scripts/uninstall.sh           # 停服务、删程序文件，保留数据与配置
sudo ./scripts/uninstall.sh --purge   # 额外删除配置、数据（会二次确认）与系统用户
```

## 许可声明

本项目使用 MIT 许可，完整条款见仓库根目录的 `LICENSE` 文件。

本项目**没有使用 OpenList 的代码**：不包含它的源码、不修改它、不链接也不内嵌它，
只通过 HTTP 调用它的公开接口。仓库里的 `openlist/` 目录只是开发期用于阅读其 API 实现的
只读参考，已被 `.gitignore` 忽略，不随本仓库分发。
