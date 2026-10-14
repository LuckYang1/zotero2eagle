import {
  buildReferenceMap,
  extractEmbeddedImageKeys,
  type NoteImageKeys,
  type ReferenceScan,
} from "./note-images";
import { getContentLibraries } from "./item-loading";

const SNAPSHOT_VERSION = 1;
const READ_CHUNK_SIZE = 200;

export interface NoteStamp {
  id: number;
  libraryID: number;
  key: string;
  clientDateModified: string;
}

export interface NoteReferenceEntry extends NoteImageKeys, NoteStamp {
  // 在读取事务内记录的时间，与 clientDateModified 同为 UTC 秒级 SQL 时间
  scannedAt: string;
}

export interface NoteReferenceRefresh extends ReferenceScan {
  readNotes: number;
}

export interface NoteReferenceRefreshOptions {
  full?: boolean;
  onProgress?: (read: number, total: number) => void;
}

// clientDateModified 只精确到秒：与读取同一秒或更晚的保存可能晚于读取发生，需要重新读取
export function isNoteEntryCurrent(
  entry: NoteReferenceEntry,
  stamp: NoteStamp,
) {
  return (
    entry.libraryID === stamp.libraryID &&
    entry.key === stamp.key &&
    entry.clientDateModified === stamp.clientDateModified &&
    stamp.clientDateModified < entry.scannedAt
  );
}

export function planNoteReferenceRefresh(
  entries: ReadonlyMap<number, NoteReferenceEntry>,
  stamps: NoteStamp[],
) {
  const current: NoteReferenceEntry[] = [];
  const stale: number[] = [];
  for (const stamp of stamps) {
    const entry = entries.get(stamp.id);
    if (entry && isNoteEntryCurrent(entry, stamp)) {
      current.push(entry);
    } else {
      stale.push(stamp.id);
    }
  }
  return { current, stale };
}

export function parseNoteReferenceSnapshot(
  value: unknown,
): NoteReferenceEntry[] | null {
  if (!isObject(value) || typeof value.version !== "number") {
    throw new Error("Invalid note reference index: missing version");
  }
  if (value.version !== SNAPSHOT_VERSION) {
    return null;
  }
  if (!Array.isArray(value.notes)) {
    throw new Error("Invalid note reference index: notes must be an array");
  }
  return value.notes.map((note: unknown) => {
    if (
      !isObject(note) ||
      !Number.isInteger(note.id) ||
      !Number.isInteger(note.libraryID) ||
      typeof note.key !== "string" ||
      typeof note.title !== "string" ||
      typeof note.clientDateModified !== "string" ||
      typeof note.scannedAt !== "string" ||
      !Array.isArray(note.imageKeys) ||
      !note.imageKeys.every((key: unknown) => typeof key === "string")
    ) {
      throw new Error(
        `Invalid note reference index entry: ${JSON.stringify(note)}`,
      );
    }
    return {
      id: note.id as number,
      libraryID: note.libraryID as number,
      key: note.key,
      title: note.title,
      clientDateModified: note.clientDateModified,
      scannedAt: note.scannedAt,
      imageKeys: note.imageKeys as string[],
    };
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function queryNoteStamps(libraryIDs: number[]) {
  const placeholders = libraryIDs.map(() => "?").join(",");
  return (await Zotero.DB.queryAsync(
    `SELECT N.itemID AS id, I.libraryID AS libraryID, I.key AS key,
     I.clientDateModified AS clientDateModified
     FROM itemNotes N JOIN items I ON I.itemID=N.itemID
     JOIN itemTypes T ON T.itemTypeID=I.itemTypeID
     LEFT JOIN deletedItems D ON D.itemID=N.itemID
     WHERE D.itemID IS NULL AND T.typeName='note'
     AND I.libraryID IN (${placeholders})`,
    libraryIDs,
  )) as NoteStamp[];
}

// 每批在独立事务中读取：Zotero 的事务串行执行，读到的修改时间与笔记内容来自同一次已提交的保存
async function readNoteEntries(
  ids: number[],
  onProgress?: (read: number, total: number) => void,
) {
  const entries: NoteReferenceEntry[] = [];
  if (!ids.length) return entries;
  onProgress?.(0, ids.length);
  for (let start = 0; start < ids.length; start += READ_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + READ_CHUNK_SIZE);
    await Zotero.DB.executeTransaction(async () => {
      const scannedAt = Zotero.Date.dateToSQL(new Date(), true);
      const rows = (await Zotero.DB.queryAsync(
        `SELECT N.itemID AS id, I.libraryID AS libraryID, I.key AS key,
         I.clientDateModified AS clientDateModified, N.note AS html, N.title AS title
         FROM itemNotes N JOIN items I ON I.itemID=N.itemID
         LEFT JOIN deletedItems D ON D.itemID=N.itemID
         WHERE D.itemID IS NULL AND N.itemID IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      )) as Array<NoteStamp & { html: string | null; title: string | null }>;
      for (const row of rows) {
        entries.push({
          id: row.id,
          libraryID: row.libraryID,
          key: row.key,
          title: row.title || row.key,
          clientDateModified: row.clientDateModified,
          scannedAt,
          imageKeys: extractEmbeddedImageKeys(row.html ?? ""),
        });
      }
    });
    onProgress?.(Math.min(start + READ_CHUNK_SIZE, ids.length), ids.length);
  }
  return entries;
}

export class NoteReferenceIndex {
  private readonly directory: string;
  private entries: Map<number, NoteReferenceEntry> | null = null;
  private running = false;

  constructor(private readonly filePath: string) {
    const directory = PathUtils.parent(filePath);
    if (!directory) {
      throw new Error(`Invalid note reference index path: ${filePath}`);
    }
    this.directory = directory;
  }

  async refresh(
    options: NoteReferenceRefreshOptions = {},
  ): Promise<NoteReferenceRefresh> {
    if (this.running) {
      throw new Error("Note reference refresh is already running");
    }
    this.running = true;
    try {
      // null 表示没有可用的已知状态：完整重新扫描、索引文件不存在或格式版本不同
      const previous = options.full
        ? null
        : (this.entries ?? (await this.readSnapshot()));
      const known = previous ?? new Map<number, NoteReferenceEntry>();
      const stamps = await queryNoteStamps(
        getContentLibraries().map((library) => library.id),
      );
      const { current, stale } = planNoteReferenceRefresh(known, stamps);
      const fresh = await readNoteEntries(stale, options.onProgress);
      const entries = new Map(
        [...current, ...fresh].map((entry) => [entry.id, entry]),
      );
      if (!previous || stale.length || current.length !== known.size) {
        await this.writeSnapshot(entries);
      }
      this.entries = entries;
      return {
        references: buildReferenceMap(entries.values()),
        checked: entries.size,
        total: entries.size,
        readNotes: stale.length,
      };
    } finally {
      this.running = false;
    }
  }

  private async readSnapshot() {
    if (!(await IOUtils.exists(this.filePath))) {
      return null;
    }
    const entries = parseNoteReferenceSnapshot(
      await IOUtils.readJSON(this.filePath),
    );
    return entries && new Map(entries.map((entry) => [entry.id, entry]));
  }

  private async writeSnapshot(entries: Map<number, NoteReferenceEntry>) {
    await IOUtils.makeDirectory(this.directory, { ignoreExisting: true });
    await IOUtils.writeJSON(
      this.filePath,
      { version: SNAPSHOT_VERSION, notes: [...entries.values()] },
      { tmpPath: `${this.filePath}.tmp` },
    );
  }
}

let sessionIndex: NoteReferenceIndex | null = null;

export function getNoteReferenceIndex() {
  sessionIndex ??= new NoteReferenceIndex(
    PathUtils.join(
      Zotero.DataDirectory.dir,
      "zotero2eagle",
      "note-references.json",
    ),
  );
  return sessionIndex;
}
