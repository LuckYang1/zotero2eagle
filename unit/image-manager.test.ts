import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTrashEntries,
  readTrashEntries,
  reconcileTrashEntries,
  recordIdentity,
  writeTrashEntries,
} from "../src/modules/image-manager-trash";
import {
  pruneSelection,
  selectedVisibleRecords,
} from "../src/modules/image-manager-selection";
import { deleteRecordBatch } from "../src/modules/image-manager-operations";
import type { FigureAnnotationRecord } from "../src/modules/figure-annotations";

const record = (id: number, libraryID = 1) =>
  ({
    id,
    key: `KEY${id}`,
    libraryID,
  }) as FigureAnnotationRecord;

test("selection only operates on visible records", () => {
  const a = record(1);
  const b = record(2);
  const selected = new Set([recordIdentity(a), recordIdentity(b)]);
  assert.deepEqual(
    selectedVisibleRecords(selected, [a]).map((item) => item.id),
    [1],
  );
  assert.deepEqual([...pruneSelection(selected, [a])], [recordIdentity(a)]);
});

test("trash persists under the Zotero2Eagle preference namespace and survives reload", () => {
  const values = new Map<string, string>();
  (globalThis as any).Zotero = {
    Prefs: {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
    },
  };
  const entries = [{ libraryID: 1, key: "KEY1", deletedAt: 100 }];
  writeTrashEntries(entries);
  assert.match([...values.keys()][0], /zotero2eagle\.imageManagerTrash$/);
  assert.deepEqual(readTrashEntries(), entries);
  assert.deepEqual(reconcileTrashEntries(readTrashEntries(), [record(2)]), []);
});

test("trash parser rejects corrupt entries and deduplicates keys", () => {
  assert.deepEqual(parseTrashEntries("bad json"), []);
  assert.deepEqual(
    parseTrashEntries(
      JSON.stringify([
        { libraryID: 1, key: "A", deletedAt: 1 },
        { libraryID: 1, key: "A", deletedAt: 2 },
        { libraryID: -1, key: "B", deletedAt: 3 },
      ]),
    ),
    [{ libraryID: 1, key: "A", deletedAt: 2 }],
  );
});

test("batch permanent deletion retains failures for retry", async () => {
  const errors: unknown[] = [];
  const result = await deleteRecordBatch(
    [record(1), record(2), record(3)],
    async (item) => {
      if (item.id === 2) throw new Error("read only");
    },
    (error) => errors.push(error),
  );
  assert.deepEqual([...result.deleted], ["1:KEY1", "1:KEY3"]);
  assert.equal(result.failed, 1);
  assert.equal(result.cleanupFailed, 0);
  assert.equal(errors.length, 1);
});

test("batch records image cleanup failures separately from item deletion", async () => {
  const result = await deleteRecordBatch(
    [record(1)],
    async () => ({ imageCleanupError: new Error("cache locked") }),
    () => {},
  );
  assert.deepEqual([...result.deleted], ["1:KEY1"]);
  assert.equal(result.failed, 0);
  assert.equal(result.cleanupFailed, 1);
});
