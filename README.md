# Zotero2Eagle

<p align="center">
  <img src="addon/content/icons/zotero2eagle.png" alt="Zotero2Eagle Logo" width="128"/>
</p>

[![zotero target version](https://img.shields.io/badge/Zotero-8%20or%209-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org) [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero2Eagle is a Zotero 9 plugin that exports PDF image annotations to Eagle and preserves a backlink to the source PDF.

[简体中文说明](./doc/README-zhCN.md)

本项目基于 [yueneiqi/zotero2eagle](https://github.com/yueneiqi/zotero2eagle) 开发，感谢原作者的杰出工作。

## Features

- Export image annotations from Zotero PDFs into Eagle
- Preserve a `zotero://open-pdf/...` backlink in Eagle
- Include title, authors, year, page number, attachment key, and annotation key
- Support automatic import for newly created image annotations
- Support manual export for selected annotations, PDF attachments, or top-level items

## Demo

### Auto Import

![Auto Import](<doc/data/自动导入%20(1).gif>)

Create a new image annotation in Zotero PDF — it will be automatically imported into Eagle.

### Manual Export

![Manual Export](doc/data/手动导入.gif)

Select one or more image annotations, right-click, and export to Eagle.

### Backlinks & Auto Tags

![Backlinks & Auto Tags](doc/data/双向链接已经自动标签.gif)

Each imported item in Eagle includes a `zotero://` backlink and auto-generated tags (title, authors, year, page number, etc.).

## Configuration

Open `Preferences -> Zotero2Eagle` and configure:

- `Automatically import new image annotations into Eagle`
- `Eagle API URL`
- `Eagle API Token`
- `Eagle Folder ID` (optional)

## Manual Export

Use the PDF reader annotation context menu:

- Right-click one or more image annotations in the PDF reader
- Choose `Export Selected Image Annotations to Eagle`

## Development

```bash
npm ci
npm run build
npm test
```

## Release

Current version: `v0.1.7`

- Release notes: [GitHub Releases](https://github.com/LuckYang1/zotero2eagle/releases)

## Notes

- This project uses the Zotero plugin scaffold and runs as a Zotero plugin, not as an Eagle plugin.
- Eagle integration is executed from Zotero through Eagle's local HTTP API. Note that the local HTTP API uses `folderId` for the destination folder, while the Eagle Plugin API uses `folders`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes following the coding guidelines in [DEVELOPMENT.md](doc/DEVELOPMENT.md)
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the AGPL License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with the [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) by [@windingwind](https://github.com/windingwind).

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
