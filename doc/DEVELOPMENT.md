# Zotero2Eagle 开发指南

Zotero2Eagle 是一个 Zotero 9 和 10 插件，将 Zotero PDF 中的图片标注导出到 Eagle，并保留 `zotero://open-pdf/...` 回链。

## 环境要求

- **Node.js** ≥ 18
- **Zotero** 9.x 或 10.0.x
- **Eagle**（本地运行，HTTP API 默认端口 `41595`）

## 项目结构

```
zotero2eagle/
├── addon/                     # 插件静态资源（Zotero 加载入口）
│   ├── bootstrap.js           # 插件引导脚本，注册 chrome handle 并加载 bundle
│   ├── manifest.json           # 插件清单（version/buildTime 由构建时注入）
│   ├── content/
│   │   ├── preferences.xhtml   # 偏好设置页面
│   │   ├── zoteroPane.css      # 样式
│   │   └── icons/              # 插件图标
│   └── locale/                 # i18n 字符串（en-US / zh-CN）
├── src/                        # TypeScript 源码
│   ├── index.ts                # 入口：创建插件全局实例
│   ├── addon.ts                # Addon 类：持有 data/hooks/api 并初始化服务
│   ├── hooks.ts                # Zotero 生命周期钩子（startup/shutdown/窗口/右键菜单）
│   ├── services/
│   │   ├── eagleClient.ts      # Eagle 本地 HTTP API 封装（连接测试、导入条目）
│   │   ├── annotationExport.ts # 标注导出服务（自动/手动导出、批次汇总）
│   │   └── annotationImage.ts  # 标注缓存图片查找与 page 提取
│   ├── modules/
│   │   └── preferenceScript.ts # 偏好设置页面交互逻辑
│   └── utils/
│       ├── ztoolkit.ts         # ZToolkit 实例创建
│       ├── prefs.ts            # Zotero.Prefs 封装（带插件前缀）
│       ├── locale.ts           # i18n 字符串获取
│       ├── window.ts           # 窗口工具
│       ├── zoteroLink.ts       # zotero://open-pdf/... 回链生成
│       └── logger.ts           # 带 tag 前缀的日志
├── test/                       # 单元测试（mocha + chai）
│   ├── startup.test.ts         # 插件启动验证
│   └── eagle-utils.test.ts     # Eagle 工具函数测试
├── doc/
│   ├── README-zhCN.md          # 中文文档
│   └── data/                   # 演示用 GIF / 截图
├── .env                        # 本地开发环境变量（已 gitignore）
├── zotero-plugin.config.ts     # Zotero Plugin Scaffold 配置
├── eslint.config.mjs           # ESLint 配置（继承 @zotero-plugin/eslint-config）
└── package.json                # 依赖与脚本
```

## 架构概述

### 插件生命周期

```
Zotero 启动
    │
    └─ bootstrap.js :: startup()
        ├─ 注册 chrome manifest（content/ 资源访问）
        ├─ 加载构建产物 scripts/{addonRef}.js
        └─ 调用 hooks.onStartup()
              ├─ 等待 Zotero 初始化完成
              ├─ initLocale() 加载本地化字符串
              ├─ registerPreferencePane() 注册偏好面板
              ├─ AnnotationExportService.init() 初始化自动导入观察者
              └─ registerReaderAnnotationMenu() 注册 PDF 右键菜单
```

### 数据流（标注导出）

```
用户创建/选择图片标注
    │
    ├─ 自动模式：Zotero.Notifier 监听 "add"("item") 事件
    └─ 手动模式：右键菜单调用 exportSelected / exportAnnotationIDs

    ▼
AnnotationExportService.buildJob()
    ├─ getCreators() / getYear()  从父条目提取元数据
    ├─ getPageNumber()            从 annotationPosition 提取页码
    ├─ waitForAnnotationCachePath()  等待缓存 PNG 写入稳定
    └─ buildOpenPdfLink()         生成 zotero:// 回链

    ▼
eagleClient.addItemFromPath(cachePath, options)
    ├─ POST /api/item/addFromPath  → Eagle 本地 HTTP API
    └─ 携带 annotation / tags / website / folderId
```

### 关键依赖

| 依赖                     | 作用                                            |
| ------------------------ | ----------------------------------------------- |
| `zotero-plugin-scaffold` | 提供 dev server / build / release 流程          |
| `zotero-plugin-toolkit`  | 提供 ZToolkit API（ProgressWindow、全局工具等） |
| `mocha` + `chai`         | 单元测试框架                                    |

## 开发环境搭建

### 1. 克隆与安装

```bash
git clone https://github.com/LuckYang1/zotero2eagle.git
cd zotero2eagle
npm ci
```

### 2. 配置 .env

复制 `.env` 文件（已存在），填写开发用 Zotero 路径和 profile：

```env
ZOTERO_PLUGIN_ZOTERO_BIN_PATH = C:\\Program Files\\Zotero\\zotero.exe
ZOTERO_PLUGIN_PROFILE_PATH = C:\\Users\\<用户名>\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\<开发profile>
```

> 建议使用专用开发 profile，通过 `zotero.exe -p` 创建独立的 profile。

### 3. 启动开发模式

```bash
npm start
```

此命令启动 Zotero 并挂载插件，文件修改后自动热重载。

### 4. 配置 Eagle 连接

在 Zotero 中打开 `Preferences -> Zotero2Eagle`：

- **Eagle API URL**：默认 `http://localhost:41595`
- **Eagle API Token**：Eagle 设置中生成的 token
- **Eagle Folder ID**：可选，指定导入目标文件夹
- 点击 **Test Connection** 确认连通

## 开发命令

| 命令                 | 说明                                          |
| -------------------- | --------------------------------------------- |
| `npm start`          | 启动开发模式（热重载）                        |
| `npm run build`      | 构建插件到 `.scaffold/build`                  |
| `npm test`           | 运行单元测试                                  |
| `npm run lint:check` | Prettier + ESLint 检查                        |
| `npm run lint:fix`   | Prettier + ESLint 自动修复                    |
| `npm run release`    | 发布插件（生成 XPI 并上传到 GitHub Releases） |

## 测试

测试使用 **mocha** + **chai**，通过 `zotero-plugin test` 在 Zotero 环境中运行。

```bash
npm run build   # 先构建
npm test        # 在 Zotero 测试环境中运行
```

测试文件：

- [startup.test.ts](../test/startup.test.ts) — 验证插件实例和 `AnnotationExportService` 创建成功
- [eagle-utils.test.ts](../test/eagle-utils.test.ts) — 验证 `buildOpenPdfLink` / `buildEagleTags` / `buildEagleAnnotation` / `buildEagleFilename` / `buildEagleOptions` 输出正确

## 代码风格

- 使用 **Prettier** 格式化，`printWidth: 80`，`tabWidth: 2`
- 使用 **ESLint** 检查（配置继承 `@zotero-plugin/eslint-config`）
- 提交前运行 `npm run lint:fix` 确保格式正确
- Zotero 类型定义由 `zotero-types` 提供

## 发布流程

1. 确保本地修改已提交且 `npm run lint:check` 通过
2. 更新 `package.json` 中的 `version`
3. 同步更新 `README.md` 和 `doc/README-zhCN.md` 中的版本号
4. 提交并推送：
   ```bash
   git add package.json README.md doc/README-zhCN.md
   git commit -m "chore: bump version to X.Y.Z"
   git push origin main
   ```
5. 打 tag 并推送，触发 GitHub Actions Release：
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z: <简要说明>"
   git push origin vX.Y.Z
   ```
6. 在 [Actions](https://github.com/LuckYang1/zotero2eagle/actions) 查看构建和发布状态

Release 工作流（`.github/workflows/release.yml`）会在 tag 推送时自动：

- 执行 `npm run build` 构建插件
- 执行 `npm run release` 生成 XPI 并上传

## 常见问题

**Q: `npm start` 启动 Zotero 报错找不到路径**

确认 `.env` 中的 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH` 路径正确，Windows 路径分隔符需转义为 `\\`。

**Q: Test Connection 失败**

- 确认 Eagle 已经启动
- 确认 `Eagle API URL` 端口号正确（默认 `41595`）
- 确认 `Eagle API Token` 已在 Eagle 设置中生成

**Q: 自动导入不生效**

- 确认已勾选 `Automatically import new image annotations into Eagle`
- 确认 Eagle 正在运行且 API 连通

**Q: 图片标注导入了但没有回链**

检查 Zotero 数据目录中的缓存文件是否完整（`waitForAnnotationCachePath` 等待超时默认 30s）。

**Q: `already_exists` 发布错误**

GitHub Release 已存在同名 tag，使用 `gh release delete vX.Y.Z --yes` 删除后重新推送 tag。
