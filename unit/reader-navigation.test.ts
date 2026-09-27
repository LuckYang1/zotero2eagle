import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReaderLocation,
  openFigureInReader,
  type FigureAnnotationRecord,
  type ReaderOpenLike,
} from "../src/modules/reader-navigation";

const record: FigureAnnotationRecord = {
  id: 1,
  key: "ANNKEY",
  libraryID: 1,
  color: "#ffd400",
  pageLabel: "1",
  sortIndex: "00001|000001|00000",
  comment: "",
  dateAdded: "2026-04-23 09:00:00",
  dateModified: "2026-04-24 12:00:00",
  attachmentID: 42,
  attachmentKey: "ATTACH",
  attachmentTitle: "PDF",
  topLevelItemID: 3,
  topLevelTitle: "Paper",
  collectionIDs: [],
  position: { pageIndex: 6, rects: [[12, 34, 56, 78]] },
  imageHeightRatio: 1,
  imageURI: null,
};

test("reader location uses annotation position for accurate initial navigation", () => {
  assert.deepEqual(buildReaderLocation(record), {
    position: { pageIndex: 6, rects: [[12, 34, 56, 78]] },
  });
});

test("reader location falls back to annotationID when position is missing", () => {
  assert.deepEqual(buildReaderLocation({ ...record, position: null }), {
    annotationID: "ANNKEY",
  });
});

test("double click opens Zotero Reader without duplicate tabs", async () => {
  const calls: unknown[][] = [];
  const reader: ReaderOpenLike = {
    async open(...args: unknown[]) {
      calls.push(args);
    },
  };

  await openFigureInReader(record, reader);

  assert.deepEqual(calls, [
    [
      42,
      { position: { pageIndex: 6, rects: [[12, 34, 56, 78]] } },
      { allowDuplicate: false },
    ],
  ]);
});
