# Zotero2Eagle v0.1.1

## Summary

Patch release for the first Zotero 9-compatible version of Zotero2Eagle.

## Changes

- Fix Eagle destination folder mapping by using `folderId` with the local HTTP API
- Move manual export to the PDF reader annotation context menu
- Simplify default Eagle tags to `Zotero` and the first author's last name
- Keep Zotero backlink, annotation metadata text, and image export behavior unchanged

## Validation

- `npm run build`
- `npm test`
- Manual verification in Zotero 9 with Eagle running:
  - open a PDF
  - create an image annotation
  - confirm automatic import when enabled
  - right-click an image annotation and run manual export
  - confirm the item appears in the configured Eagle folder
  - click the backlink and return to Zotero

## Release Checklist

- [x] Build passes locally
- [x] Tests pass locally
- [x] Manual verification completed in Zotero 9 with Eagle
- [x] Version updated to `0.1.1`
- [x] Tag prepared: `v0.1.1`
