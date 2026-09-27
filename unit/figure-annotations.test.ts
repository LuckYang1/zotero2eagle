import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_ANNOTATION_TYPE_ID,
  buildImageAnnotationIDQuery,
  clearFigureAnnotationCache,
  clampImageHeightRatio,
  collectFigureAnnotations,
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
  });
});

test("invalid annotation position is ignored", () => {
  const record = createFigureAnnotationRecord(
    annotation({ annotationPosition: "not-json" }),
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

test("collectFigureAnnotations returns session cached records without querying Zotero again", async () => {
  clearFigureAnnotationCache();
  const state = installZoteroMock([
    [collectableAnnotation({ id: 101, key: "FIRST" })],
  ]);

  const first = await collectFigureAnnotations();
  const second = await collectFigureAnnotations();

  assert.equal(state.dbCalls, 1);
  assert.equal(state.itemCalls, 1);
  assert.notEqual(second, first);
  assert.deepEqual(
    second.map((record) => record.key),
    ["FIRST"],
  );
});

test("collectFigureAnnotations force refresh reloads and replaces the session cache", async () => {
  clearFigureAnnotationCache();
  const state = installZoteroMock([
    [collectableAnnotation({ id: 101, key: "FIRST" })],
    [collectableAnnotation({ id: 102, key: "REFRESHED" })],
  ]);

  const first = await collectFigureAnnotations();
  const refreshed = await collectFigureAnnotations({ forceRefresh: true });
  const cached = await collectFigureAnnotations();

  assert.equal(state.dbCalls, 2);
  assert.equal(state.itemCalls, 2);
  assert.deepEqual(
    first.map((record) => record.key),
    ["FIRST"],
  );
  assert.deepEqual(
    refreshed.map((record) => record.key),
    ["REFRESHED"],
  );
  assert.deepEqual(
    cached.map((record) => record.key),
    ["REFRESHED"],
  );
});

test("concurrent collectFigureAnnotations calls share the in-flight load", async () => {
  clearFigureAnnotationCache();
  const columnGate = deferred<void>();
  const state = installZoteroMock(
    [[collectableAnnotation({ id: 101, key: "FIRST" })]],
    { columnDelay: columnGate.promise },
  );

  const firstPromise = collectFigureAnnotations();
  const secondPromise = collectFigureAnnotations();
  await flushPromises();

  assert.equal(state.dbCalls, 1);
  columnGate.resolve();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(state.itemCalls, 1);
  assert.notEqual(second, first);
  assert.deepEqual(
    first.map((record) => record.key),
    ["FIRST"],
  );
  assert.deepEqual(
    second.map((record) => record.key),
    ["FIRST"],
  );
});

test("failed force refresh keeps the previous session cache", async () => {
  clearFigureAnnotationCache();
  const state = installZoteroMock(
    [[collectableAnnotation({ id: 101, key: "FIRST" })]],
    { failOnColumnCall: 2 },
  );

  await collectFigureAnnotations();
  await assert.rejects(
    () => collectFigureAnnotations({ forceRefresh: true }),
    /DB unavailable/,
  );
  const cached = await collectFigureAnnotations();

  assert.equal(state.dbCalls, 2);
  assert.equal(state.itemCalls, 1);
  assert.deepEqual(
    cached.map((record) => record.key),
    ["FIRST"],
  );
});

test("older in-flight loads do not replace a newer force refresh cache", async () => {
  clearFigureAnnotationCache();
  const firstLoadGate = deferred<void>();
  const state = installZoteroMock(
    [
      [collectableAnnotation({ id: 101, key: "FIRST" })],
      [collectableAnnotation({ id: 102, key: "REFRESHED" })],
    ],
    { columnDelays: [firstLoadGate.promise] },
  );

  const firstPromise = collectFigureAnnotations();
  await flushPromises();
  const refreshed = await collectFigureAnnotations({ forceRefresh: true });

  firstLoadGate.resolve();
  await firstPromise;
  const cached = await collectFigureAnnotations();

  assert.equal(state.dbCalls, 2);
  assert.equal(state.itemCalls, 2);
  assert.deepEqual(
    refreshed.map((record) => record.key),
    ["REFRESHED"],
  );
  assert.deepEqual(
    cached.map((record) => record.key),
    ["REFRESHED"],
  );
});

interface ZoteroMockState {
  dbCalls: number;
  itemCalls: number;
}

interface ZoteroMockOptions {
  columnDelay?: Promise<void>;
  columnDelays?: Array<Promise<void> | undefined>;
  failOnColumnCall?: number;
}

function collectableAnnotation({ id, key }: { id: number; key: string }) {
  const topLevelItem = {
    id: id + 1000,
    getCollections: () => [3],
    getDisplayTitle: () => `Paper ${key}`,
    loadAllData: async () => {},
  };
  const parentItem = {
    id: id + 2000,
    key: `ATTACH-${key}`,
    topLevelItem,
    getDisplayTitle: () => `PDF ${key}`,
    isFileAttachment: () => true,
    attachmentReaderType: "pdf",
    getAnnotations: () => [],
    loadAllData: async () => {},
  };

  return {
    ...annotation({
      id,
      key,
      parentItemID: parentItem.id,
      parentItem,
      annotationSortIndex: `00001|${id}|00000`,
    }),
    loadAllData: async () => {},
  };
}

function installZoteroMock(
  batches: ReturnType<typeof collectableAnnotation>[][],
  options: ZoteroMockOptions = {},
) {
  const state: ZoteroMockState = {
    dbCalls: 0,
    itemCalls: 0,
  };
  const annotationsByID = new Map<
    number,
    ReturnType<typeof collectableAnnotation>
  >();

  (globalThis as typeof globalThis & { Zotero: unknown }).Zotero = {
    Libraries: {
      getAll: () => [
        {
          id: 1,
          libraryType: "user",
          name: "My Library",
          waitForDataLoad: async () => {},
        },
      ],
    },
    Annotations: {
      ANNOTATION_TYPE_IMAGE: IMAGE_ANNOTATION_TYPE_ID,
      getCacheImagePath: (item: { key: string }) =>
        `/tmp/cache/${item.key}.png`,
    },
    DB: {
      columnQueryAsync: async () => {
        state.dbCalls += 1;
        const callIndex = state.dbCalls;
        if (options.failOnColumnCall === callIndex) {
          throw new Error("DB unavailable");
        }
        await (options.columnDelays?.[callIndex - 1] ?? options.columnDelay);
        const batch =
          batches[Math.min(callIndex - 1, batches.length - 1)] ?? [];
        for (const item of batch) {
          annotationsByID.set(item.id, item);
        }
        return batch.map((item) => item.id);
      },
    },
    Items: {
      getAsync: async (ids: number[]) => {
        state.itemCalls += 1;
        return ids.map((id) => annotationsByID.get(id));
      },
    },
    File: {
      pathToFileURI: (path: string) => `file://${path}`,
    },
    logError: () => {},
  };

  return state;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
