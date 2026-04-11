# Zotero2Eagle v0.1.0

## Summary

First functional release of Zotero2Eagle for Zotero 9.

## Included

- Export PDF image annotations from Zotero to Eagle
- Preserve a Zotero `open-pdf` backlink in Eagle
- Include title, authors, year, page number, attachment key, and annotation key
- Automatic import toggle in plugin preferences
- Manual export entry from item context menu and Tools menu
- Basic test coverage for export helper logic and plugin startup

## Validation

- `npm run build`
- `npm test`
- Manual verification in Zotero 9 with Eagle running:
  - open PDF
  - create image annotation
  - confirm Eagle import
  - click backlink back to Zotero

## Release Checklist

- [x] Build passes
- [x] Tests pass
- [x] Zotero 9 manual verification completed
- [x] Tag prepared: `v0.1.0`
