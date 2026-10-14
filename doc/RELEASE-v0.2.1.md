# Zotero2Eagle v0.2.1

## Summary

This release makes the image manager open quickly after Zotero restarts and keeps the reference status of note images without a manual scan. It covers the changes since `v0.2.0`.

## Changes

- Load PDF image annotations and note image attachments with bulk item loading. In a test library with 300 image annotations, loading the image manager took about 0.15 seconds, down from about 5.9 seconds.
- Reload image records from the database each time the manager opens or refreshes, so newly created image annotations appear right away.
- Count image references in notes automatically when the Note image attachments tab opens. The result is saved in `zotero2eagle/note-references.json` in the Zotero data directory, and later checks, including after restarting Zotero, only reread notes modified since the previous check. **Scan unreferenced images** rereads every note.
- Update the reference index before permanently deleting note images. Each image is still checked again right before it is deleted.
- Align the English README with the Chinese README, correct the auto import setting name, installation steps, and test instructions, update the development guide, and add CLAUDE.md.

## Validation

- TypeScript type check
- ESLint and Prettier
- Unit tests
- Zotero integration tests

The `v0.2.1` tag triggers the GitHub Actions release workflow, which builds the extension and publishes the XPI.
