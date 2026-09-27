# Zotero2Eagle

<p align="center">
  <img src="addon/content/icons/zotero2eagle.png" alt="Zotero2Eagle Logo" width="128"/>
</p>

[![zotero target version](https://img.shields.io/badge/Zotero-9%20or%2010-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org) [![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

Zotero2Eagle is a Zotero 9 and 10 plugin that exports PDF image annotations to Eagle and preserves a backlink to the source PDF.

[简体中文说明](./doc/README-zhCN.md)

本项目基于 [yueneiqi/zotero2eagle](https://github.com/yueneiqi/zotero2eagle) 开发，感谢原作者的杰出工作。

The image manager is adapted from [heimi98/zotero-figure-overview](https://github.com/heimi98/zotero-figure-overview), licensed under AGPL-3.0-or-later.
Its updated image management layout takes inspiration from [AlbusGuo/albus-imagine](https://github.com/AlbusGuo/albus-imagine), licensed under AGPL-3.0; the Zotero implementation uses its own controls and data model.

## Features

- Export image annotations from Zotero PDFs into Eagle
- Preserve a `zotero://open-pdf/...` backlink in Eagle
- Include title, authors, year, page number, attachment key, and annotation key
- Support automatic import for newly created image annotations
- Support manual export for selected annotations, PDF attachments, or top-level items
- Browse image annotations in an image manager with collection and color filters, preview, and Reader navigation
- Select visible images with checkboxes and save them to Eagle in a batch
- Move images to the manager trash, restore them, or permanently delete their Zotero annotations
- Search PDF annotations by source PDF filename and manage embedded note images in a separate tab
- Scan Zotero notes for image references and find orphaned note image attachments

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

## Image Manager

Click the image icon in Zotero's top tab bar. Filter by collection or color, resize thumbnails, and double-click an image to open its source annotation. Right-click an image to save it to Eagle or move it to the manager trash. Use the card checkboxes and toolbar to act on multiple visible images.

The manager trash persists across restarts. Moving an image there hides it from the manager but leaves the Zotero annotation intact. Restore it from the Trash view, or permanently delete selected images or empty the trash after confirmation. Permanent deletion removes the Zotero annotation and its local image cache. Notes, embedded image attachments, and the source PDF are preserved. Manual saves use the existing Eagle export behavior and can create another Eagle item when repeated.

The Note Image Attachments tab lists images embedded in Zotero notes. Search by image filename, filter by Zotero collection, and run **Scan unreferenced images** to count image references across notes. Unscanned or failed scans are marked **Unchecked**. Open an image preview in the manager or open its source note in Zotero. Save selected attachment files to Eagle. Its trash is separate from the PDF annotation trash; only attachments verified as unreferenced at deletion time can be permanently deleted. Scanning never deletes images automatically.

## Development

```bash
npm ci
npm run build
npm test
```

## Release

Current version: `v0.1.14`

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
