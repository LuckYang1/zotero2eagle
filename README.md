# Zotero2Eagle

<p align="center">
  <img src="addon/content/icons/zotero2eagle.png" alt="Zotero2Eagle Logo" width="128"/>
</p>

[![zotero target version](https://img.shields.io/badge/Zotero-8%20or%209-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)

Zotero2Eagle is a Zotero 9 plugin that exports PDF image annotations to Eagle and preserves a backlink to the source PDF.

[简体中文说明](./doc/README-zhCN.md)

## Features

- Export image annotations from Zotero PDFs into Eagle
- Preserve a `zotero://open-pdf/...` backlink in Eagle
- Include title, authors, year, page number, attachment key, and annotation key
- Support automatic import for newly created image annotations
- Support manual export for selected annotations, PDF attachments, or top-level items

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

Current release target: `v0.1.1`

- Release notes: [doc/RELEASE-v0.1.1.md](./doc/RELEASE-v0.1.1.md)
- Tag name: `v0.1.1`

## Notes

- This project uses the Zotero plugin scaffold and runs as a Zotero plugin, not as an Eagle plugin.
- Eagle integration is executed from Zotero through Eagle's local HTTP API. Note that the local HTTP API uses `folderId` for the destination folder, while the Eagle Plugin API uses `folders`.
