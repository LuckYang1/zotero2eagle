import { recordIdentity } from "./image-manager-trash";
import {
  getContentLibraries,
  loadItemsWithData,
  uniqueIDs,
} from "./item-loading";

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

export interface NoteImageKeys {
  id: number;
  key: string;
  libraryID: number;
  title: string;
  imageKeys: string[];
}

export function extractEmbeddedImageKeys(html: string): string[] {
  const keys: string[] = [];
  for (const tag of html.match(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi) ?? []) {
    const match = tag.match(/\bdata-attachment-key\s*=\s*(["'])([^"']+)\1/i);
    if (match?.[2]) keys.push(match[2]);
  }
  return keys;
}

export function buildReferenceMap(notes: Iterable<NoteImageKeys>) {
  const references = new Map<string, NoteReference[]>();
  for (const note of notes) {
    for (const key of note.imageKeys) {
      const identity = recordIdentity({ libraryID: note.libraryID, key });
      const entries = references.get(identity) ?? [];
      entries.push({ noteID: note.id, noteKey: note.key, title: note.title });
      references.set(identity, entries);
    }
  }
  return references;
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
  return buildReferenceMap(
    notes.map((note) => ({
      ...note,
      imageKeys: extractEmbeddedImageKeys(note.html),
    })),
  );
}

async function getNoteRows(libraryID: number, imageKey: string) {
  return (await Zotero.DB.queryAsync(
    `SELECT N.itemID AS id, I.key AS key, I.libraryID AS libraryID, N.note AS html
     FROM itemNotes N JOIN items I ON I.itemID=N.itemID
     JOIN itemTypes T ON T.itemTypeID=I.itemTypeID
     LEFT JOIN deletedItems D ON D.itemID=N.itemID
     WHERE D.itemID IS NULL AND T.typeName='note'
     AND I.libraryID=? AND N.note LIKE ?`,
    [libraryID, `%${imageKey}%`],
  )) as Array<{
    id: number;
    key: string;
    libraryID: number;
    html: string | null;
  }>;
}

export async function collectNoteImages(): Promise<NoteImageRecord[]> {
  const libraryIDs = getContentLibraries().map((library) => library.id);
  const placeholders = libraryIDs.map(() => "?").join(",");
  const ids = (await Zotero.DB.columnQueryAsync(
    `SELECT A.itemID FROM itemAttachments A JOIN items I ON I.itemID=A.itemID
     JOIN itemNotes N ON N.itemID=A.parentItemID
     LEFT JOIN deletedItems D ON D.itemID=A.itemID
     LEFT JOIN deletedItems PD ON PD.itemID=A.parentItemID
     WHERE A.linkMode=? AND D.itemID IS NULL AND PD.itemID IS NULL
     AND I.libraryID IN (${placeholders})`,
    [Zotero.Attachments.LINK_MODE_EMBEDDED_IMAGE, ...libraryIDs],
  )) as number[];
  const images = await loadItemsWithData(ids, []);
  const notes = await loadItemsWithData(
    uniqueIDs(images.map((image) => image.parentItemID)),
    ["itemData"],
  );
  await loadItemsWithData(
    uniqueIDs(notes.map((note) => note.parentItemID || note.id)),
    ["collections"],
  );
  // 两次查询之间被删除的笔记不会加载，对应的图片一并跳过
  const loadedImages = images.filter((image) => image.parentItem);
  const filePaths = await Promise.all(
    loadedImages.map((image) => image.getFilePathAsync()),
  );
  const records = loadedImages.map((image, index): NoteImageRecord => {
    const note = image.parentItem!;
    const filePath = filePaths[index] || null;
    return {
      id: image.id,
      key: image.key,
      libraryID: image.libraryID,
      noteID: note.id,
      noteKey: note.key,
      noteTitle: note.getDisplayTitle() || note.key,
      filename: image.attachmentFilename || "image.png",
      dateAdded: image.dateAdded || "",
      dateModified: image.dateModified || "",
      filePath,
      imageURI: filePath ? Zotero.File.pathToFileURI(filePath) : null,
      collectionIDs: note.topLevelItem.getCollections(),
    };
  });
  return records.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function scanAttachmentReferences(record: NoteImageRecord) {
  const rows = await getNoteRows(record.libraryID, record.key);
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
