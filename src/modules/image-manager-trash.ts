import { getPref, setPref } from "../utils/prefs";
import type { FigureAnnotationRecord } from "./figure-annotations";

export interface TrashEntry {
  libraryID: number;
  key: string;
  deletedAt: number;
}

export function recordIdentity(
  record: Pick<FigureAnnotationRecord, "libraryID" | "key">,
) {
  return `${record.libraryID}:${record.key}`;
}

export function parseTrashEntries(raw: string): TrashEntry[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const entries = new Map<string, TrashEntry>();
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        Number.isInteger(item.libraryID) &&
        item.libraryID > 0 &&
        typeof item.key === "string" &&
        item.key.length > 0 &&
        typeof item.deletedAt === "number" &&
        Number.isFinite(item.deletedAt)
      ) {
        entries.set(recordIdentity(item), {
          libraryID: item.libraryID,
          key: item.key,
          deletedAt: item.deletedAt,
        });
      }
    }
    return [...entries.values()];
  } catch {
    return [];
  }
}

export function reconcileTrashEntries<
  T extends { libraryID: number; key: string },
>(entries: TrashEntry[], records: T[]) {
  const live = new Set(records.map(recordIdentity));
  return entries.filter((entry) => live.has(recordIdentity(entry)));
}

export function readTrashEntries() {
  return parseTrashEntries(getPref("imageManagerTrash") || "[]");
}

export function writeTrashEntries(entries: TrashEntry[]) {
  setPref("imageManagerTrash", JSON.stringify(entries));
}

export function readNoteTrashEntries() {
  return parseTrashEntries(getPref("noteImageManagerTrash") || "[]");
}

export function writeNoteTrashEntries(entries: TrashEntry[]) {
  setPref("noteImageManagerTrash", JSON.stringify(entries));
}
