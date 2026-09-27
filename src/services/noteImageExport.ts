import { addItemFromPath } from "./eagleClient";
import { getPref } from "../utils/prefs";
import type { NoteImageRecord } from "../modules/note-images";

export async function exportNoteImages(records: NoteImageRecord[]) {
  const results: Array<{ key: string; success: boolean; message: string }> = [];
  for (const record of records) {
    if (!record.filePath) {
      results.push({
        key: record.key,
        success: false,
        message: "Image file missing",
      });
      continue;
    }
    const library = Zotero.Libraries.get(record.libraryID) as any;
    const location =
      library?.libraryType === "group" && library.groupID
        ? `groups/${library.groupID}`
        : "library";
    const response = await addItemFromPath(record.filePath, {
      name: record.filename,
      annotation: `Note: ${record.noteTitle} | Note Key: ${record.noteKey} | Image Key: ${record.key}`,
      folderId: getPref("eagleFolderId") || undefined,
      tags: ["Zotero"],
      website: `zotero://select/${location}/items/${record.noteKey}`,
    });
    results.push({
      key: record.key,
      success: response.success,
      message: response.message,
    });
  }
  return results;
}
