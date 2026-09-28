import { recordIdentity } from "./image-manager-trash";

export interface NoteImageRecord {
  id: number;
  key: string;
  libraryID: number;
  noteID: number;
  noteKey: string;
  noteTitle: string;
  filename: string;
  dateAdded?: string;
  dateModified?: string;
  filePath: string | null;
  imageURI: string | null;
  collectionIDs: number[];
}

export interface NoteReference {
  noteID: number;
  noteKey: string;
  title: string;
}

export interface ReferenceScan {
  references: Map<string, NoteReference[]>;
  checked: number;
  total: number;
}

export function extractEmbeddedImageKeys(html: string): string[] {
  const keys: string[] = [];
  for (const tag of html.match(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi) ?? []) {
    const match = tag.match(/\bdata-attachment-key\s*=\s*(["'])([^"']+)\1/i);
    if (match?.[2]) keys.push(match[2]);
  }
  return keys;
}

export function collectReferences(
  notes: Array<{
    id: number;
    key: string;
    libraryID: number;
    title: string;
    html: string;
  }>,
) {
  const references = new Map<string, NoteReference[]>();
  for (const note of notes) {
    for (const key of extractEmbeddedImageKeys(note.html)) {
      const identity = recordIdentity({ libraryID: note.libraryID, key });
      const entries = references.get(identity) ?? [];
      entries.push({ noteID: note.id, noteKey: note.key, title: note.title });
      references.set(identity, entries);
    }
  }
  return references;
}

function getLibraries() {
  return Zotero.Libraries.getAll().filter(
    (library) => library.libraryType !== "feed",
  );
}

async function getNoteRows(libraryIDs: number[], imageKey?: string) {
  if (!libraryIDs.length) return [];
  const placeholders = libraryIDs.map(() => "?").join(",");
  const matchingKey = imageKey ? " AND N.note LIKE ?" : "";
  return ((await Zotero.DB.queryAsync(
    `SELECT N.itemID AS id, I.key AS key, I.libraryID AS libraryID, N.note AS html
     FROM itemNotes N JOIN items I ON I.itemID=N.itemID
     JOIN itemTypes T ON T.itemTypeID=I.itemTypeID
     LEFT JOIN deletedItems D ON D.itemID=N.itemID
     WHERE D.itemID IS NULL AND T.typeName='note'
     AND I.libraryID IN (${placeholders})${matchingKey}`,
    imageKey ? [...libraryIDs, `%${imageKey}%`] : libraryIDs,
  )) ?? []) as Array<{
    id: number;
    key: string;
    libraryID: number;
    html: string | null;
  }>;
}

export async function collectNoteImages(): Promise<NoteImageRecord[]> {
  const libraries = getLibraries();
  await Promise.all(
    libraries.map((library) => library.waitForDataLoad?.("item")),
  );
  const libraryIDs = libraries.map((library) => library.id);
  if (!libraryIDs.length) return [];
  const placeholders = libraryIDs.map(() => "?").join(",");
  const ids = (await Zotero.DB.columnQueryAsync(
    `SELECT A.itemID FROM itemAttachments A JOIN items I ON I.itemID=A.itemID
     JOIN itemNotes N ON N.itemID=A.parentItemID
     LEFT JOIN deletedItems D ON D.itemID=A.itemID
     LEFT JOIN deletedItems PD ON PD.itemID=A.parentItemID
     WHERE D.itemID IS NULL AND PD.itemID IS NULL
     AND I.libraryID IN (${placeholders})`,
    libraryIDs,
  )) as number[];
  const records: NoteImageRecord[] = [];
  for (const id of ids) {
    const item = await Zotero.Items.getAsync(id);
    if (!item || !item.isEmbeddedImageAttachment()) continue;
    await item.loadAllData();
    const note = item.parentItem;
    if (!note?.isNote?.() || note.deleted) continue;
    await note.loadAllData();
    const top = note.parentItem || note;
    const filePath = (await item.getFilePathAsync()) || null;
    records.push({
      id: item.id,
      key: item.key,
      libraryID: item.libraryID,
      noteID: note.id,
      noteKey: note.key,
      noteTitle: note.getDisplayTitle() || note.key,
      filename: item.attachmentFilename || "image.png",
      dateAdded: item.dateAdded || "",
      dateModified: item.dateModified || "",
      filePath,
      imageURI: filePath ? Zotero.File.pathToFileURI(filePath) : null,
      collectionIDs: top.getCollections?.() ?? [],
    });
  }
  return records.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function scanNoteReferences(
  onProgress?: (checked: number, total: number) => void,
): Promise<ReferenceScan> {
  const rows = await getNoteRows(getLibraries().map((library) => library.id));
  const notes: Array<{
    id: number;
    key: string;
    libraryID: number;
    title: string;
    html: string;
  }> = [];
  onProgress?.(0, rows.length);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    let title = row.key;
    if (extractEmbeddedImageKeys(row.html ?? "").length) {
      try {
        const note = await Zotero.Items.getAsync(row.id);
        if (note && note.isNote()) {
          await note.loadAllData();
          title = note.getDisplayTitle() || row.key;
        }
      } catch {
        // Reference detection uses the database HTML even if display data fails.
      }
    }
    notes.push({
      id: row.id,
      key: row.key,
      libraryID: row.libraryID,
      title,
      html: row.html ?? "",
    });
    onProgress?.(index + 1, rows.length);
    if (index % 25 === 24)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return {
    references: collectReferences(notes),
    checked: rows.length,
    total: rows.length,
  };
}

export async function scanAttachmentReferences(record: NoteImageRecord) {
  const rows = await getNoteRows([record.libraryID], record.key);
  const notes = rows.map((row) => ({
    id: row.id,
    key: row.key,
    libraryID: row.libraryID,
    title: row.key,
    html: row.html ?? "",
  }));
  return collectReferences(notes).get(recordIdentity(record)) ?? [];
}

export function filterNoteImages(
  records: NoteImageRecord[],
  options: {
    query: string;
    collectionKeys: Set<string>;
    referenceFilter: "all" | "referenced" | "unreferenced";
    references: Map<string, NoteReference[]> | null;
  },
) {
  const query = options.query.trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (query && !record.filename.toLocaleLowerCase().includes(query))
      return false;
    const keys = record.collectionIDs.length
      ? record.collectionIDs.map((id) => `collection:${id}`)
      : ["uncategorized"];
    if (!keys.some((key) => options.collectionKeys.has(key))) return false;
    if (options.referenceFilter === "all") return true;
    if (!options.references) return false;
    const count = options.references.get(recordIdentity(record))?.length ?? 0;
    return options.referenceFilter === "referenced" ? count > 0 : count === 0;
  });
}

export async function deleteUnreferencedNoteImage(
  record: NoteImageRecord,
  references: Map<string, NoteReference[]>,
) {
  if ((references.get(recordIdentity(record))?.length ?? 0) > 0) {
    throw new Error("Image is referenced by a Zotero note");
  }
  const item = await Zotero.Items.getAsync(record.id);
  if (item) await item.loadAllData();
  if (
    !item ||
    !item.isEmbeddedImageAttachment() ||
    item.key !== record.key ||
    item.libraryID !== record.libraryID ||
    item.parentItemID !== record.noteID
  ) {
    throw new Error("Image attachment no longer matches the manager record");
  }
  if (!item.isEditable("erase"))
    throw new Error("Image attachment is not editable");
  await item.eraseTx();
}

export async function deleteNoteImageBatch(
  records: NoteImageRecord[],
  references: Map<string, NoteReference[]>,
  options: {
    check?: (record: NoteImageRecord) => Promise<NoteReference[]>;
    erase?: (
      record: NoteImageRecord,
      references: Map<string, NoteReference[]>,
    ) => Promise<void>;
    onError?: (error: unknown) => void;
  } = {},
) {
  const check = options.check ?? scanAttachmentReferences;
  const erase = options.erase ?? deleteUnreferencedNoteImage;
  const deleted = new Set<string>();
  let protectedCount = 0;
  const errors: Array<{ record: NoteImageRecord; error: unknown }> = [];
  for (const record of records) {
    try {
      const latest = await check(record);
      references.set(recordIdentity(record), latest);
      if (latest.length) {
        protectedCount++;
        continue;
      }
      await erase(record, references);
      deleted.add(recordIdentity(record));
    } catch (error) {
      errors.push({ record, error });
      options.onError?.(error);
    }
  }
  return { deleted, protectedCount, failed: errors.length, errors };
}
