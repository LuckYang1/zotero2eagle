import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ANNOTATION_TYPE_ID,
  buildImageAnnotationIDQuery,
  clampImageHeightRatio,
  createFigureAnnotationRecord,
  getImageHeightRatio,
  isFigureAnnotationItem,
  sortFigureAnnotationRecords,
  type RuntimeAnnotationItem,
} from "../src/modules/figure-annotations";

function annotation(
  overrides: Partial<RuntimeAnnotationItem> = {},
): RuntimeAnnotationItem {
  const topLevelItem = {
    id: 10,
    getCollections: () => [3, 5],
    getDisplayTitle: () => "Parent paper",
  };
  const parentItem = {
    id: 20,
    key: "ATTACH",
    attachmentFilename: "source.pdf",
    topLevelItem,
    getDisplayTitle: () => "PDF",
  };

  return {
    id: 30,
    key: "ANN",
    libraryID: 1,
    annotationType: "image",
    annotationColor: "#ffd400",
    annotationPageLabel: "7",
    annotationSortIndex: "00007|000001|00000",
    annotationPosition: '{"pageIndex":6,"rects":[[12,34,56,78]]}',
    annotationComment: "interesting figure",
    dateAdded: "2026-04-23 09:00:00",
    dateModified: "2026-04-24 12:00:00",
    parentItemID: 20,
    parentItem,
    isAnnotation: () => true,
    deleted: false,
    ...overrides,
  };
}

test("only image annotations are figure annotations", () => {
  assert.equal(isFigureAnnotationItem(annotation()), true);
  assert.equal(
    isFigureAnnotationItem(annotation({ annotationType: "ink" })),
    false,
  );
  assert.equal(
    isFigureAnnotationItem(annotation({ annotationType: "highlight" })),
    false,
  );
});

test("trashed annotations are excluded", () => {
  assert.equal(isFigureAnnotationItem(annotation({ deleted: true })), false);
});

test("record includes annotation, parent attachment, collections, and image URI", () => {
  const record = createFigureAnnotationRecord(
    annotation(),
    "file:///tmp/cache/ANN.png",
    "/tmp/cache/ANN.png",
  );

  assert.deepEqual(record, {
    id: 30,
    key: "ANN",
    libraryID: 1,
    color: "#ffd400",
    pageLabel: "7",
    sortIndex: "00007|000001|00000",
    comment: "interesting figure",
    dateAdded: "2026-04-23 09:00:00",
    dateModified: "2026-04-24 12:00:00",
    attachmentID: 20,
    attachmentKey: "ATTACH",
    attachmentTitle: "PDF",
    attachmentFilename: "source.pdf",
    topLevelItemID: 10,
    topLevelTitle: "Parent paper",
    collectionIDs: [3, 5],
    position: { pageIndex: 6, rects: [[12, 34, 56, 78]] },
    imageHeightRatio: 1,
    imageURI: "file:///tmp/cache/ANN.png",
    imagePath: "/tmp/cache/ANN.png",
    filePath: null,
  });
});

test("invalid annotation position is ignored", () => {
  const record = createFigureAnnotationRecord(
    annotation({ annotationPosition: "not-json" }),
    null,
    null,
  );

  assert.equal(record.position, null);
  assert.equal(record.imageHeightRatio, null);
});

test("image height ratio is derived from the annotation rectangle", () => {
  assert.equal(
    getImageHeightRatio({ pageIndex: 1, rects: [[10, 10, 210, 110]] }),
    0.5,
  );
  assert.equal(clampImageHeightRatio(0.1), 0.1);
  assert.equal(clampImageHeightRatio(0.01), 0.08);
  assert.equal(clampImageHeightRatio(4), 2.4);
});

test("records sort by document group recency and document position", () => {
  const olderDocument = {
    id: 10,
    getCollections: () => [3],
    getDisplayTitle: () => "Older document",
  };
  const newerDocument = {
    id: 11,
    getCollections: () => [5],
    getDisplayTitle: () => "Newer document",
  };
  const records = [
    createFigureAnnotationRecord(
      annotation({
        key: "OLDER",
        dateAdded: "2026-04-21 12:00:00",
        annotationSortIndex: "00001|000001|00000",
        parentItem: {
          id: 20,
          key: "ATTACH1",
          topLevelItem: olderDocument,
          getDisplayTitle: () => "PDF 1",
        },
      }),
      null,
    ),
    createFigureAnnotationRecord(
      annotation({
        key: "NEWER-LATE",
        dateAdded: "2026-04-24 12:00:00",
        annotationSortIndex: "00009|000001|00000",
        parentItem: {
          id: 21,
          key: "ATTACH2",
          topLevelItem: newerDocument,
          getDisplayTitle: () => "PDF 2",
        },
      }),
      null,
    ),
    createFigureAnnotationRecord(
      annotation({
        key: "NEWER-EARLY",
        dateAdded: "2026-04-23 12:00:00",
        annotationSortIndex: "00002|000001|00000",
        parentItem: {
          id: 21,
          key: "ATTACH2",
          topLevelItem: newerDocument,
          getDisplayTitle: () => "PDF 2",
        },
      }),
      null,
    ),
  ];

  assert.deepEqual(
    sortFigureAnnotationRecords(records).map((item) => item.key),
    ["NEWER-EARLY", "NEWER-LATE", "OLDER"],
  );
});

test("document group recency falls back to dateModified when dateAdded is missing", () => {
  const withDateAddedDocument = {
    id: 10,
    getCollections: () => [],
    getDisplayTitle: () => "Has date added",
  };
  const missingDateAddedDocument = {
    id: 11,
    getCollections: () => [],
    getDisplayTitle: () => "Missing date added",
  };
  const records = [
    createFigureAnnotationRecord(
      annotation({
        key: "HAS-DATE-ADDED",
        dateAdded: "2026-04-22 12:00:00",
        dateModified: "2026-04-22 12:00:00",
        parentItem: {
          id: 20,
          key: "ATTACH1",
          topLevelItem: withDateAddedDocument,
          getDisplayTitle: () => "PDF 1",
        },
      }),
      null,
    ),
    createFigureAnnotationRecord(
      annotation({
        key: "MISSING-DATE-ADDED",
        dateAdded: "",
        dateModified: "2026-04-24 12:00:00",
        parentItem: {
          id: 21,
          key: "ATTACH2",
          topLevelItem: missingDateAddedDocument,
          getDisplayTitle: () => "PDF 2",
        },
      }),
      null,
    ),
  ];

  assert.deepEqual(
    sortFigureAnnotationRecords(records).map((item) => item.key),
    ["MISSING-DATE-ADDED", "HAS-DATE-ADDED"],
  );
});

test("image annotation query targets itemAnnotations instead of scanning all items", () => {
  const query = buildImageAnnotationIDQuery([1, 3], IMAGE_ANNOTATION_TYPE_ID);

  assert.equal(query.params[0], IMAGE_ANNOTATION_TYPE_ID);
  assert.deepEqual(query.params.slice(1), [1, 3]);
  assert.match(query.sql, /FROM itemAnnotations IA/);
  assert.match(query.sql, /IA\.type=\?/);
  assert.match(query.sql, /I\.libraryID IN \(\?,\?\)/);
  assert.match(query.sql, /annotationDeleted\.itemID IS NULL/);
  assert.match(query.sql, /parentDeleted\.itemID IS NULL/);
});
