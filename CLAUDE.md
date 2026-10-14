# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

Zotero2Eagle 是基于 zotero-plugin-scaffold 和 zotero-plugin-toolkit 的 Zotero 插件，`addon/manifest.json` 限定 Zotero 9.0 到 `10.0.*`。它把 PDF 图片标注通过 Eagle 本地 HTTP API 导出到本机运行的 Eagle，并在 Eagle 条目中附带 `zotero://open-pdf/...` 回链；它还在 Zotero 内提供图片管理器窗口，用于浏览、筛选、导出和删除 PDF 图片标注以及笔记中的嵌入图片。

图片管理器改编自 heimi98/zotero-figure-overview，代码中的 `figure`、`overview` 命名（`FigureAnnotationRecord`、`overviewScript.ts`、CSS 类 `figure-*`）都指图片管理器。

## 常用命令

- `npm ci`：安装依赖。
- `npm start`（`zotero-plugin serve`）：读取 `.env` 中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 和 `ZOTERO_PLUGIN_PROFILE_PATH`（模板见 `.env.example`，Windows 路径分隔符需要转义为 `\\`），启动 Zotero 并加载插件；源码修改后自动重新构建并重新加载插件。`ZOTERO_PLUGIN_DATA_DIR` 留空时使用该 profile 中设置的数据目录，它可能就是用户日常使用的文库。
- `npm run build`：`zotero-plugin build` 把插件输出到 `.scaffold/build/`（`addon/` 目录、`.xpi`、`update.json`），随后运行 `tsc --noEmit`。`tsconfig.json` 只包含 `src/` 和 `typings/`，`test/`、`unit/` 中的代码不经过类型检查。
- `npm run lint:check` / `npm run lint:fix`：Prettier 和 ESLint。
- `npm run test:unit`：用 Node 内置 test runner 运行 `unit/*.test.ts`，不需要 Zotero。
- 运行单个 unit 测试：`node --test --test-name-pattern="<测试名称片段>" unit/run.cjs`。`run.cjs` 总是加载 `unit/` 下的全部测试文件，只能按测试名称筛选。
- `npm test`（`zotero-plugin test`）：自行构建插件，使用每次运行之前清空的 `.scaffold/test/profile` 和 `.scaffold/test/data` 启动真实 Zotero，运行 `test/**/*.test.ts`（mocha 和 chai，单个用例超时 10 秒）。需要 `.env` 中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`。本地默认进入 watch 模式并保持 Zotero 打开，`npm test -- --no-watch` 运行一轮后退出。

CI（`.github/workflows/ci.yml`）运行 `lint:check`、`build` 和 `test`，不运行 `test:unit`。

在 `npm start` 或 `npm test` 运行期间中断 scaffold（Ctrl+C）会执行 `taskkill /f /im zotero.exe`，结束本机所有 Zotero 进程，包括用户日常使用的 Zotero。运行集成测试时使用 `npm test -- --no-watch`，等待它自行结束。

## 两套测试

- `unit/`：`unit/run.cjs` 为 `.ts` 文件注册 require hook，用 `ts.transpileModule` 把单个文件转译为 CommonJS（不做类型检查，不经过 esbuild），然后加载全部 `unit/*.test.ts`，断言使用 `node:assert/strict`。这里覆盖不依赖 Zotero 运行时的纯逻辑：`figure-annotations`、`overview-filters`、`collection-tree`、`image-manager-trash`、`image-manager-selection`、`image-manager-operations`、`annotation-deletion`、`note-images`、`note-reference-index`、`reader-navigation`、`services/noteImageExport`。被这些测试导入的模块在导入阶段不能访问 `Zotero`、`ztoolkit`、`addon` 全局变量。
- `test/`：在真实 Zotero 中运行，依赖 Zotero API、数据库或窗口 DOM 的行为在这里验证。`startup.test.ts` 检查插件实例、工具栏按钮和图片管理器窗口结构；`image-manager-data.test.ts` 在测试 profile 中创建真实的条目、标注、笔记和嵌入图片，验证记录加载、引用索引的持久化与增量更新，以及笔记页签的引用状态显示和永久删除。
- 测试中创建条目时使用 `saveTx({ skipSelect: true })`：条目列表默认会选中新条目，笔记编辑器载入后可能在后台再次保存笔记，改变它的 `clientDateModified`。
- scaffold 报告失败用例时只显示 `undefined`（错误对象经 JSON 序列化后丢失 message）。需要查看具体错误时，把错误写入 `Zotero.DataDirectory.dir`（也就是 `.scaffold/test/data/`）下的文件再读取。

## 架构

### 启动与生命周期

- `addon/bootstrap.js` 注册 `chrome://zotero2eagle/content/`，加载 esbuild 打包产物 `content/scripts/zotero2eagle.js`（入口 `src/index.ts`），然后调用 `Zotero.Zotero2Eagle.hooks.onStartup()`。
- `src/index.ts` 创建 `Addon` 单例（`src/addon.ts`）并赋值给 `Zotero.Zotero2Eagle`，同时在插件沙箱中定义全局变量 `addon` 和 `ztoolkit`（类型声明在 `typings/global.d.ts`）。`addon.data.annotationExport` 持有 `AnnotationExportService` 实例，`addon.api.openOverview()` 打开图片管理器。
- `src/hooks.ts` 集中处理生命周期：`onStartup` 注册偏好设置面板、启动导出服务的 Notifier 观察者、注册阅读器 `createAnnotationContextMenu` 监听器，并为每个主窗口安装工具栏按钮（`modules/main-window.ts`）；`onShutdown` 关闭图片管理器窗口并逐项注销。禁用插件和 `npm start` 自动重新加载插件都会调用 `onShutdown`（重新加载随后再次调用 `onStartup`），新增的注册项需要在 `onShutdown` 或 `onMainWindowUnload` 中注销。

### Eagle 导出

- 手动导出有两个入口：阅读器标注右键菜单（`hooks.ts`）和图片管理器的“保存至 Eagle”，两者都调用 `AnnotationExportService.exportAnnotationIDs()`。服务启动时注册 `Zotero.Notifier` 观察者，偏好 `enableAutoImport` 开启时自动导出新建的图片标注，同一标注 60 秒内只处理一次。`exportSelected()`（从条目树的当前选择中收集图片标注，支持标注、PDF 附件和顶层条目）目前没有任何界面入口调用。
- 单个标注的导出流程在 `services/annotationExport.ts`：从父附件和顶层条目读取标题、作者、年份，从 `annotationPosition` 计算页码；`waitForAnnotationCachePath()`（`services/annotationImage.ts`）轮询 `Zotero.Annotations.getCacheImagePath()` 和数据目录 `cache/` 下的候选路径，等待文件大小保持 500 毫秒不变之后返回路径（最长等待 30 秒），用于等待 Zotero 完成新标注缓存图片的写入；最后调用 `eagleClient.addItemFromPath()`。
- `services/eagleClient.ts` 通过 `Zotero.HTTP.request` 调用 Eagle 本地 HTTP API（默认 `http://localhost:41595`）：`GET /api/application/info` 用于测试连接，`POST /api/item/addFromPath` 用于导入。GET 请求把 token 附加在查询参数中，POST 请求把 token 写入 JSON body。本地 HTTP API 使用 `folderId` 指定目标文件夹（Eagle 插件 API 的对应字段是 `folders`）。
- `utils/zoteroLink.ts` 生成回链 `zotero://open-pdf/library/items/<附件 key>?page=<页码>&annotation=<标注 key>`。笔记图片导出（`services/noteImageExport.ts`）直接提交附件文件路径，回链为指向所属笔记的 `zotero://select/...`。

### 图片管理器

- 工具栏按钮位于 `zotero-tabs-toolbar`。`modules/overview-window.ts` 用 `openDialog` 打开唯一的 `chrome://zotero2eagle/content/overview.xhtml` 窗口（窗口已经打开时聚焦已有窗口），并在打开时添加 load/unload 监听器，触发窗口的初始化与清理。
- `modules/overviewScript.ts` 的 `initializeOverviewWindow()` 创建两个控制器：`OverviewController`（“PDF 批注图片”页签）和 `NoteManager`（`modules/note-manager.ts`，“笔记图片附件”页签，首次切换到该页签时初始化）。两者通过固定 ID（`zotero2eagle-image-manager-*`、`zotero2eagle-note-*`）查找 `overview.xhtml` 中的元素，缺少元素时抛出异常；修改元素 ID 需要同时修改 xhtml、控制器和 `test/startup.test.ts`。
- 数据来源：每次打开窗口、首次切换到笔记页签或点击刷新按钮都从数据库重新加载，没有跨窗口的记录缓存。`collectFigureAnnotations()`（`modules/figure-annotations.ts`）用 SQL 查询 `itemAnnotations` 中的图片标注（排除回收站中的标注和父附件），`collectNoteImages()`（`modules/note-images.ts`）用 SQL 查询笔记下的内嵌图片附件。条目数据都通过 `modules/item-loading.ts` 的 `loadItemsWithData()` 批量加载：`Zotero.Items.getAsync()` 加载主数据，`Zotero.Items.loadDataTypes()` 补齐所需的数据类型（顶层条目要先加载 `creators` 再加载 `itemData`，部分条目类型的显示标题由作者生成）。不要逐条目调用 `Item.loadAllData()`：Zotero 的实现不检查已加载状态，每次都会对单个条目重新查询全部数据类型，300 个图片标注的加载会从约 0.15 秒变为约 6 秒。
- 笔记引用索引（`modules/note-reference-index.ts`）：记录每条笔记中 `<img data-attachment-key="...">` 引用的图片，持久化到 `<Zotero 数据目录>/zotero2eagle/note-references.json`。`NoteManager` 打开笔记页签时调用 `getNoteReferenceIndex().refresh()` 做增量更新：先查询全部未进入回收站的笔记的 `clientDateModified`，只重新读取新增的笔记、修改时间变化的笔记，以及 `clientDateModified` 不早于上次读取时间 `scannedAt` 的笔记（`clientDateModified` 是保存事务的开始时间，只精确到秒，同一秒内的保存可能晚于读取）。笔记内容按每批 200 条在 `Zotero.DB.executeTransaction()` 中读取，Zotero 的事务串行执行，读到的修改时间与内容一致。“扫描未引用图片”按钮调用 `refresh({ full: true })`，忽略已有索引并重写文件；索引文件结构损坏时增量更新抛出异常，界面显示“未检查”，完整重新扫描可以重建文件。同一个索引实例不允许并发调用 `refresh()`，`NoteManager` 用 `busy` 标记保证这一点。
- 管理器回收站：软删除列表以 JSON 存储在偏好 `imageManagerTrash` 和 `noteImageManagerTrash` 中（`modules/image-manager-trash.ts`），记录标识为 `libraryID:key`（`recordIdentity()`），每次加载时由 `reconcileTrashEntries()` 清除已经不存在的条目。移入或移出回收站只修改这两个偏好。
- 永久删除：
  - PDF 图片标注：`modules/annotation-deletion.ts` 先确认记录与当前条目的类型、key、文库、父附件一致，然后调用 `eraseTx()`（与 Zotero 阅读器删除标注的方式相同，会发出 Notifier 事件并参与同步），最后删除缓存图片。缓存图片清理失败时标注已经删除，失败次数单独计入 `cleanupFailed`。
  - 笔记嵌入图片：删除之前先对引用索引做一次增量更新，`deleteNoteImageBatch()` 在删除每个附件之前还会用 SQL 重新查询一次引用，仍然被引用的附件跳过；索引更新失败时中止整个删除操作。
- 双击卡片由 `modules/reader-navigation.ts` 调用 `Zotero.Reader.open()`，优先使用标注的 `position` 定位，没有位置信息时使用 `annotationID`，并设置 `allowDuplicate: false`。

### Scaffold 构建约定

- `addon/` 下文件中的 `__addonRef__`、`__addonInstance__`、`__addonName__`、`__buildVersion__`、`__buildTime__` 等占位符在构建时按 `package.json` 的 `config` 字段和 `zotero-plugin.config.ts` 的 `build.define` 替换。TypeScript 代码从 `package.json` 导入 `config`、`version` 获取同样的值。
- Fluent 字符串：`addon/locale/{en-US,zh-CN}/*.ftl` 和 xhtml 的 `data-l10n-id` 中使用不带前缀的 ID，构建时自动添加 `zotero2eagle-` 前缀，并把文件重命名为 `zotero2eagle-*.ftl`。`getString()`（`utils/locale.ts`）在运行时添加前缀，并且只加载 `addon.ftl`；`preferences.ftl` 只供 `preferences.xhtml` 使用；`mainWindow.ftl` 的内容是插件模板的示例字符串，没有被加载。新增字符串需要同时写入 en-US 和 zh-CN 两份文件。
- 偏好：默认值在 `addon/prefs.js` 中用短名称声明，构建时为 `prefs.js` 的键和 xhtml 的 `preference="..."` 属性添加 `extensions.zotero.zotero2eagle.` 前缀。代码通过 `utils/prefs.ts` 的 `getPref` / `setPref` 使用短名称读写。
- `typings/i10n.d.ts`（`FluentMessageId`）和 `typings/prefs.d.ts`（`PluginPrefsMap`）由构建过程根据 `.ftl` 文件和 `addon/prefs.js` 生成，不要手动编辑。新增字符串或偏好之后运行 `npm run build`，它会先重新生成这两个文件，然后执行 `tsc`。
- 偏好设置面板：`preferences.xhtml` 根元素的 `onload` 调用 `hooks.onPrefsEvent("load")`，然后由 `modules/preferenceScript.ts` 的 `registerPrefsScripts()` 逐个填充控件值并绑定事件写回偏好。新增设置项需要同时修改 `addon/prefs.js`、`preferences.xhtml`（控件 ID 格式为 `zotero-prefpane-__addonRef__-<名称>`）、两种语言的 `preferences.ftl` 和 `preferenceScript.ts`。

## 代码风格

- Prettier（`printWidth: 80`、`tabWidth: 2`、LF 换行）和 `@zotero-plugin/eslint-config`（关闭了 `@typescript-eslint/no-unused-vars`）。
- `.prettierignore` 排除了 `src/hooks.ts`、`src/services/annotationExport.ts`、`src/services/annotationImage.ts`、`src/services/eagleClient.ts` 和 `addon/content/preferences.xhtml`，`lint:fix` 不会重新格式化这些文件，修改时保持它们现有的格式。

## 发布

项目使用的发布流程（见 `doc/DEVELOPMENT.md` 和 v0.2.0 的发布提交）：修改 `package.json` 与 `package-lock.json` 中的版本号，同步 `README.md` 和 `doc/README-zhCN.md` 中的当前版本，新增 `doc/RELEASE-vX.Y.Z.md`，提交之后推送 `vX.Y.Z` 标签。`.github/workflows/release.yml` 随后在 CI 中运行 `npm run build` 和 `npm run release`，生成 XPI 并发布到 GitHub Releases，同时更新 `release` 标签下供插件自动更新使用的 `update.json`。`manifest.json` 的版本号和图片管理器窗口标题中的版本号都在构建时来自 `package.json`。

在本地运行 `npm run release` 会由 bumpp 交互式选择新版本号，然后自动提交、创建标签并推送到远程；本项目只在 release 工作流中运行这个命令。
