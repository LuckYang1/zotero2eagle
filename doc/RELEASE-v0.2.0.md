# Zotero2Eagle v0.2.0

## Summary

This release adds an image manager inside Zotero for PDF image annotations and embedded note images. It covers the changes since `v0.1.8`.

## Changes

- Browse PDF image annotations by library or collection, filter by color, search by source PDF filename, sort results, and resize thumbnails. Open the source annotation in Zotero Reader.
- Select visible images for batch export to Eagle. Move annotations to the manager trash, restore them, or permanently delete them with their local image caches.
- Manage embedded note image attachments in a separate tab. Search and filter attachments, preview images, scan note references, export attachments to Eagle, and delete only attachments confirmed as unreferenced at deletion time.
- Add a multi-collection selection mode and settings for card metadata, default sort, excluded folders, deletion confirmation, and whether double-clicking a note image opens its note in a Zotero tab or a new window.
- Improve image manager controls, icons, tooltips, and the Preferences About links.
- Refresh dependencies and update the toolkit import and note-item checks for the newer package types.

## Validation

- TypeScript type check
- ESLint
- Unit tests

The `v0.2.0` tag triggers the GitHub Actions release workflow, which builds the extension and publishes the XPI.
