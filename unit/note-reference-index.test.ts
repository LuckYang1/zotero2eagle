import assert from "node:assert/strict";
import test from "node:test";
import { buildReferenceMap } from "../src/modules/note-images";
import {
  isNoteEntryCurrent,
  parseNoteReferenceSnapshot,
  planNoteReferenceRefresh,
  type NoteReferenceEntry,
  type NoteStamp,
} from "../src/modules/note-reference-index";

const entry = (
  overrides: Partial<NoteReferenceEntry> = {},
): NoteReferenceEntry => ({
  id: 2,
  libraryID: 1,
  key: "NOTE0002",
  title: "Note",
  clientDateModified: "2026-10-14 08:00:00",
  scannedAt: "2026-10-14 08:00:05",
  imageKeys: ["IMAGE001"],
  ...overrides,
});

const stamp = (overrides: Partial<NoteStamp> = {}): NoteStamp => ({
  id: 2,
  libraryID: 1,
  key: "NOTE0002",
  clientDateModified: "2026-10-14 08:00:00",
  ...overrides,
});

test("an entry read after the last save of its note stays current", () => {
  assert.equal(isNoteEntryCurrent(entry(), stamp()), true);
});

test("a save in the same second as the read forces a reread", () => {
  const sameSecond = "2026-10-14 08:00:05";
  assert.equal(
    isNoteEntryCurrent(
      entry({ clientDateModified: sameSecond }),
      stamp({ clientDateModified: sameSecond }),
    ),
    false,
  );
});

test("a changed modification time or identity forces a reread", () => {
  assert.equal(
    isNoteEntryCurrent(
      entry(),
      stamp({ clientDateModified: "2026-10-14 08:00:03" }),
    ),
    false,
  );
  assert.equal(isNoteEntryCurrent(entry(), stamp({ key: "OTHER" })), false);
  assert.equal(isNoteEntryCurrent(entry(), stamp({ libraryID: 2 })), false);
});

test("refresh plan rereads new and changed notes and drops removed notes", () => {
  const entries = new Map([
    [2, entry()],
    [3, entry({ id: 3, key: "NOTE0003" })],
    [4, entry({ id: 4, key: "NOTE0004" })],
  ]);
  const plan = planNoteReferenceRefresh(entries, [
    stamp(),
    stamp({
      id: 3,
      key: "NOTE0003",
      clientDateModified: "2026-10-14 09:00:00",
    }),
    stamp({ id: 5, key: "NOTE0005" }),
  ]);
  assert.deepEqual(
    plan.current.map((item) => item.id),
    [2],
  );
  assert.deepEqual(plan.stale, [3, 5]);
});

test("snapshot parser accepts entries of the current version", () => {
  assert.deepEqual(
    parseNoteReferenceSnapshot({ version: 1, notes: [entry()] }),
    [entry()],
  );
});

test("snapshot of another format version is discarded", () => {
  assert.equal(
    parseNoteReferenceSnapshot({ version: 0, notes: "old format" }),
    null,
  );
});

test("corrupt snapshots are rejected", () => {
  assert.throws(
    () => parseNoteReferenceSnapshot({ notes: [] }),
    /missing version/,
  );
  assert.throws(
    () => parseNoteReferenceSnapshot({ version: 1, notes: {} }),
    /notes must be an array/,
  );
  assert.throws(
    () =>
      parseNoteReferenceSnapshot({
        version: 1,
        notes: [{ ...entry(), imageKeys: [1] }],
      }),
    /Invalid note reference index entry/,
  );
});

test("reference map counts repeated, cross-note and per-library references", () => {
  const references = buildReferenceMap([
    entry({ imageKeys: ["IMAGE001", "IMAGE001"] }),
    entry({
      id: 3,
      key: "NOTE0003",
      title: "Other",
      imageKeys: ["IMAGE001", "IMAGE002"],
    }),
    entry({ id: 4, key: "NOTE0004", libraryID: 2, imageKeys: ["IMAGE001"] }),
  ]);
  assert.equal(references.get("1:IMAGE001")?.length, 3);
  assert.deepEqual(references.get("1:IMAGE002"), [
    { noteID: 3, noteKey: "NOTE0003", title: "Other" },
  ]);
  assert.equal(references.get("2:IMAGE001")?.length, 1);
});
