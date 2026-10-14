# Zotero2Eagle 开发指南

Zotero2Eagle 是 Zotero 9 和 10 的插件：把 PDF 中的图片标注导出到 Eagle 并保留 `zotero://open-pdf/...` 回链，同时在 Zotero 内提供图片管理器窗口。

## 环境要求

- **Node.js** 22.13 及以上的 22.x 版本，或 24 及以上（`zotero-plugin-scaffold` 0.9 要求 22.8 以上，ESLint 10 要求 22.13 以上的 22.x 或 24 以上）
- **Zotero** 9.x 或 10.0.x（`addon/manifest.json` 中的 `strict_min_version` 与 `strict_max_version`）
- **Eagle**（本机运行，本地 HTTP API 默认端口 `41595`）

## 项目结构

- `addon/`：Zotero 直接加载的静态资源，构建时替换其中的占位符
  - `bootstrap.js`：注册 chrome 资源，加载打包后的脚本，调用生命周期钩子
  - `manifest.json`：插件清单，版本号和更新地址在构建时写入
  - `prefs.js`：偏好默认值
  - `content/overview.xhtml`、`content/overview.css`：图片管理器窗口
  - `content/preferences.xhtml`：偏好设置面板
  - `content/zoteroPane.css`：主窗口中图片管理器按钮的样式
  - `locale/en-US/`、`locale/zh-CN/`：Fluent 字符串；`addon.ftl` 供脚本和图片管理器使用，`preferences.ftl` 供偏好设置面板使用
- `src/`：TypeScript 源码，构建为 `content/scripts/zotero2eagle.js`
  - `index.ts`、`addon.ts`、`hooks.ts`：创建插件实例，处理插件生命周期
  - `services/eagleClient.ts`：Eagle 本地 HTTP API（测试连接、导入图片）
  - `services/annotationExport.ts`：图片标注的自动导出与手动导出
  - `services/annotationImage.ts`：查找并等待标注缓存图片，计算页码
  - `services/noteImageExport.ts`：把笔记图片附件导出到 Eagle
  - `modules/main-window.ts`：主窗口中的图片管理器按钮
  - `modules/overview-window.ts`、`modules/overviewScript.ts`：图片管理器窗口与“PDF 批注图片”页签
  - `modules/note-manager.ts`：“笔记图片附件”页签
  - `modules/item-loading.ts`：批量加载条目数据
  - `modules/figure-annotations.ts`：查询 PDF 图片标注，生成卡片记录
  - `modules/note-images.ts`：查询笔记图片附件，解析笔记中的图片引用，删除未引用的附件
  - `modules/note-reference-index.ts`：持久化的笔记引用索引
  - `modules/image-manager-trash.ts`、`modules/image-manager-selection.ts`、`modules/image-manager-operations.ts`、`modules/annotation-deletion.ts`：管理器回收站、选择与永久删除
  - `modules/overview-filters.ts`、`modules/collection-tree.ts`、`modules/image-sort-controls.ts`、`modules/image-preview.ts`、`modules/reader-navigation.ts`：筛选、集合树、排序、预览与阅读器跳转
  - `modules/preferenceScript.ts`：偏好设置面板交互
  - `utils/`：偏好读写、Fluent 字符串、日志、回链生成、ZToolkit 实例
- `typings/`：全局类型声明；`i10n.d.ts` 与 `prefs.d.ts` 由构建过程生成
- `unit/`：在 Node 中运行的单元测试
- `test/`：在 Zotero 中运行的集成测试
- `doc/`：中文 README、各版本发布说明与演示素材

## 架构

### 插件生命周期

1. Zotero 启动插件时，`addon/bootstrap.js` 注册 `chrome://zotero2eagle/content/`，加载 `content/scripts/zotero2eagle.js`，然后调用 `hooks.onStartup()`。
2. `onStartup()` 等待 Zotero 初始化完成，加载 Fluent 字符串，注册偏好设置面板，启动自动导出的 Notifier 观察者，注册阅读器标注右键菜单，并为每个主窗口安装图片管理器按钮。
3. 禁用插件或开发模式自动重新加载插件时调用 `onShutdown()`，关闭图片管理器窗口，逐项注销上述注册内容。

### 图片标注导出

1. 自动导出：偏好 `enableAutoImport` 开启时，Notifier 观察者收到新建的图片标注后立即导出，同一标注 60 秒内只处理一次。
2. 手动导出：阅读器标注右键菜单和图片管理器的“保存至 Eagle”都调用 `AnnotationExportService.exportAnnotationIDs()`。
3. `buildJob()` 从父附件与顶层条目读取标题、作者、年份，从 `annotationPosition` 计算页码；`waitForAnnotationCachePath()` 等待缓存 PNG 写入完成（文件大小保持 500 毫秒不变，最长等待 30 秒）；`buildOpenPdfLink()` 生成回链。
4. `eagleClient.addItemFromPath()` 向 `POST /api/item/addFromPath` 提交图片路径、名称、annotation 文本、tags、回链与 `folderId`。

### 图片管理器的数据加载

- 每次打开窗口或点击刷新按钮，都从数据库重新加载：`collectFigureAnnotations()` 用 SQL 找出未进入回收站的图片标注，`collectNoteImages()` 用 SQL 找出笔记下的内嵌图片附件。
- 条目数据通过 `modules/item-loading.ts` 批量加载：`Zotero.Items.getAsync()` 用一次查询加载缺少的主数据，`Zotero.Items.loadDataTypes()` 按文库补齐所需的数据类型。不要对每个条目调用 `Item.loadAllData()`：它不检查已加载状态，每次调用都会对单个条目重新查询全部数据类型，几百个条目就会让加载耗时达到数秒。

### 笔记引用索引

- `modules/note-reference-index.ts` 记录每条笔记中 `<img data-attachment-key="...">` 引用的图片，保存在 Zotero 数据目录下的 `zotero2eagle/note-references.json`。每条记录包含笔记的 `clientDateModified`、读取时间 `scannedAt` 与引用的图片 key。
- 打开“笔记图片附件”页签时自动执行增量更新：先查询全部未进入回收站的笔记的 `clientDateModified`，只重新读取新出现的笔记、修改时间变化的笔记，以及最后一次保存与上次读取处于同一秒的笔记（`clientDateModified` 只精确到秒）；进入回收站或已删除的笔记从索引中移除。
- 笔记内容按每批 200 条在独立事务中读取。Zotero 的事务串行执行，因此读到的修改时间与笔记内容来自同一次已提交的保存。
- “扫描未引用图片”按钮执行完整重新扫描，忽略已有索引并重写文件。索引文件损坏时增量更新会报错，图片显示“未检查”；完整重新扫描可以重建文件。
- 永久删除笔记图片之前先执行一次增量更新；`deleteNoteImageBatch()` 在删除每张图片之前还会用 SQL 单独查询一次引用，仍被引用的图片不会删除。

### 管理器回收站

- 软删除列表以 JSON 存储在偏好 `imageManagerTrash`（PDF 图片标注）和 `noteImageManagerTrash`（笔记图片附件）中，记录标识为 `libraryID:key`，每次加载时清除已经不存在的条目。移入或移出回收站只修改这两个偏好。
- 永久删除 PDF 图片标注时，先确认记录与当前条目的类型、key、文库、父附件一致，然后调用 `eraseTx()`，最后删除缓存图片。

### 构建约定

- `addon/` 中的 `__addonRef__`、`__addonInstance__`、`__buildVersion__` 等占位符在构建时按 `package.json` 的 `config` 与 `zotero-plugin.config.ts` 的 `build.define` 替换。
- Fluent 字符串 ID 与偏好名称在源码中都不带前缀，构建时自动添加 `zotero2eagle-` 和 `extensions.zotero.zotero2eagle.` 前缀，并据此生成 `typings/i10n.d.ts` 与 `typings/prefs.d.ts`。新增字符串需要同时写入 en-US 和 zh-CN；新增字符串或偏好之后运行 `npm run build` 重新生成类型声明。

## 开发环境搭建

### 1. 克隆与安装

```bash
git clone https://github.com/LuckYang1/zotero2eagle.git
cd zotero2eagle
npm ci
```

### 2. 配置 .env

把 `.env.example` 复制为 `.env`（`.env` 已被 gitignore），填写 Zotero 路径和开发 profile：

```env
ZOTERO_PLUGIN_ZOTERO_BIN_PATH = C:\\Program Files\\Zotero\\zotero.exe
ZOTERO_PLUGIN_PROFILE_PATH = C:\\Users\\<用户名>\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\<开发profile>
ZOTERO_PLUGIN_DATA_DIR =
```

- Windows 路径分隔符需要转义为 `\\`。
- 建议使用 `zotero.exe -p` 创建专用的开发 profile。
- `ZOTERO_PLUGIN_DATA_DIR` 留空时，Zotero 使用该 profile 中设置的数据目录；如果这个目录就是日常使用的文库，开发模式会直接读写这份文库。

### 3. 启动开发模式

```bash
npm start
```

此命令启动 Zotero 并加载插件，源码修改后自动重新构建并重新加载插件。

### 4. 配置 Eagle 连接

在 Zotero 中打开 `Preferences -> Zotero2Eagle`：

- **Eagle API URL**：默认 `http://localhost:41595`
- **Eagle API Token**：Eagle 设置中生成的 token
- **Eagle Folder ID**：可选，指定导入的目标文件夹
- 点击 **Test Connection** 确认连接正常

## 开发命令

- `npm start`：启动开发模式
- `npm run build`：构建插件到 `.scaffold/build/`（`addon/` 目录、`.xpi`、`update.json`），随后运行 `tsc --noEmit`；类型检查只覆盖 `src/` 与 `typings/`
- `npm run lint:check`：Prettier 与 ESLint 检查
- `npm run lint:fix`：Prettier 与 ESLint 自动修复
- `npm run test:unit`：运行 `unit/` 中的单元测试
- `npm test`：在 Zotero 中运行 `test/` 中的集成测试
- `npm run release`：发布插件，见下方发布流程

在 `npm start` 或 `npm test` 运行期间按下 Ctrl+C，scaffold 会执行 `taskkill /f /im zotero.exe`，结束本机所有 Zotero 进程，包括日常使用的 Zotero。

## 测试

CI（`.github/workflows/ci.yml`）运行 `lint:check`、`build` 和 `test`，不运行 `test:unit`，修改纯逻辑模块之后需要在本地运行单元测试。

### 单元测试（unit/）

- 使用 Node 内置的 `node:test` 与 `node:assert/strict`，不需要 Zotero。
- `unit/run.cjs` 用 `typescript.transpileModule` 逐个文件转译 `.ts`（不做类型检查），然后加载全部 `unit/*.test.ts`。被测试的模块在导入阶段不能访问 `Zotero`、`ztoolkit`、`addon` 全局变量。
- 覆盖范围：筛选与集合树、管理器回收站与选择、批量删除的结果统计、阅读器跳转位置、图片标注记录与排序、笔记引用的解析与筛选、笔记引用索引的增量判断与文件解析、笔记图片的导出请求。

```bash
npm run test:unit
```

运行单个测试：

```bash
node --test --test-name-pattern="<测试名称片段>" unit/run.cjs
```

### 集成测试（test/）

- `zotero-plugin test` 先构建插件，然后用每次运行前清空的 `.scaffold/test/profile` 与 `.scaffold/test/data` 启动真实 Zotero，运行 `test/**/*.test.ts`（mocha 与 chai，单个用例默认超时 10 秒）。需要 `.env` 中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH`。
- 本地默认进入 watch 模式，Zotero 保持打开，文件修改后重新运行；添加 `--no-watch` 参数后运行一轮就退出：

```bash
npm test -- --no-watch
```

- 依赖 Zotero 数据库、条目或窗口的行为在这里测试：
  - `startup.test.ts`：插件实例、图片管理器按钮、图片管理器窗口结构、笔记图片的永久删除
  - `image-manager-data.test.ts`：图片标注记录、笔记图片记录、引用索引的持久化与增量更新、打开笔记页签时自动显示引用状态、在管理器回收站中永久删除未引用图片
  - `eagle-utils.test.ts`：回链、tags、annotation 文本、文件名与 `folderId`
- 测试中创建条目时使用 `saveTx({ skipSelect: true })`：条目列表默认会选中新条目，笔记编辑器载入后可能在后台再次保存笔记，改变它的 `clientDateModified`。
- 失败用例在终端中只显示 `undefined`（scaffold 序列化错误对象时丢失了 message）。需要查看具体错误时，可以把错误写入 `Zotero.DataDirectory.dir`（也就是 `.scaffold/test/data/`）下的文件。

## 代码风格

- 使用 **Prettier** 格式化（`printWidth: 80`、`tabWidth: 2`、LF 换行），使用 **ESLint** 检查（继承 `@zotero-plugin/eslint-config`）。
- `.prettierignore` 排除了 `src/hooks.ts`、`src/services/annotationExport.ts`、`src/services/annotationImage.ts`、`src/services/eagleClient.ts` 与 `addon/content/preferences.xhtml`，修改这些文件时保持现有格式。
- 提交前运行 `npm run lint:check`。
- Zotero 类型定义由 `zotero-types` 提供。

## 发布流程

1. 确认本地修改已提交，并且 `npm run lint:check` 通过。

2. 更新 `package.json` 与 `package-lock.json` 中的 `version`。

3. 同步更新 `README.md` 和 `doc/README-zhCN.md` 中的当前版本号，新增 `doc/RELEASE-vX.Y.Z.md`。

4. 提交并推送：

   ```bash
   git add package.json package-lock.json README.md doc/README-zhCN.md doc/RELEASE-vX.Y.Z.md
   git commit -m "chore: prepare vX.Y.Z release"
   git push origin main
   ```

5. 创建并推送标签，触发 GitHub Actions 的 Release 工作流：

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z: <简要说明>"
   git push origin vX.Y.Z
   ```

6. 在 [Actions](https://github.com/LuckYang1/zotero2eagle/actions) 查看构建和发布状态。

Release 工作流（`.github/workflows/release.yml`）在 CI 中执行 `npm run build` 与 `npm run release`：生成 XPI，创建 `vX.Y.Z` 的 GitHub Release，并更新 `release` 标签下供插件自动更新使用的 `update.json`。在本地运行 `npm run release` 会由 bumpp 交互式选择版本号，然后自动提交、创建标签并推送到远程；本项目只在 Release 工作流中运行这个命令。

## 常见问题

### `npm start` 启动 Zotero 报错找不到路径

确认 `.env` 中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 路径正确，Windows 路径分隔符需要转义为 `\\`。

### Test Connection 失败

- 确认 Eagle 已经启动
- 确认 `Eagle API URL` 端口号正确（默认 `41595`）
- 确认 `Eagle API Token` 已在 Eagle 设置中生成

### 自动导入不生效

- 确认已勾选 `Automatically import new image annotations into Eagle`
- 确认 Eagle 正在运行，并且 API 连接正常

### 导出提示缓存图片不可用

新建图片标注后，插件最多等待 30 秒让 Zotero 写入缓存 PNG（`waitForAnnotationCachePath()`），超时后导出失败。缓存图片生成之后可以重新手动导出。

### 笔记图片显示“未检查”

引用索引更新失败时，“笔记图片附件”页签的扫描状态栏会显示失败原因。点击“扫描未引用图片”执行完整重新扫描，会重建数据目录下的 `zotero2eagle/note-references.json`。

### `already_exists` 发布错误

GitHub Release 已存在同名 tag，使用 `gh release delete vX.Y.Z --yes` 删除后重新推送 tag。
