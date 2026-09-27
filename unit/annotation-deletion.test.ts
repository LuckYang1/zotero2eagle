import assert from "node:assert/strict";
import test from "node:test";
import { deleteFigureAnnotation } from "../src/modules/annotation-deletion";
import type { FigureAnnotationRecord } from "../src/modules/figure-annotations";

const record = {
  id: 42,
  key: "IMAGEKEY",
  libraryID: 1,
  attachmentID: 7,
} as FigureAnnotationRecord;

function annotation(overrides: Record<string, unknown> = {}) {
  let erased = 0;
  return {
    item: {
      id: 42,
      key: "IMAGEKEY",
      libraryID: 1,
      parentItemID: 7,
      annotationType: "image",
      isAnnotation: () => true,
      isEditable: () => true,
      eraseTx: async () => {
        erased += 1;
      },
      ...overrides,
    },
    get erased() {
      return erased;
    },
  };
}

test("deletes only the matching annotation and its cache", async () => {
  const calls: string[] = [];
  const target = annotation({
    eraseTx: async () => {
      calls.push("annotation");
    },
  });
  await deleteFigureAnnotation(record, {
    lookup: async (id) => {
      assert.equal(id, record.id);
      return target.item;
    },
    removeCacheImage: async () => {
      calls.push("cache");
    },
  });
  assert.deepEqual(calls, ["annotation", "cache"]);
});

test("reports cache cleanup failure after the annotation is erased", async () => {
  const target = annotation();
  const result = await deleteFigureAnnotation(record, {
    lookup: async () => target.item,
    removeCacheImage: async () => {
      throw new Error("cache locked");
    },
  });
  assert.equal(target.erased, 1);
  assert.match(String(result.imageCleanupError), /cache locked/);
});

test("rejects a stale record before deleting another annotation", async () => {
  const target = annotation({ key: "OTHERKEY" });
  await assert.rejects(
    () => deleteFigureAnnotation(record, { lookup: async () => target.item }),
    /no longer matches/,
  );
  assert.equal(target.erased, 0);
});

test("does not delete an annotation in a read-only library", async () => {
  const target = annotation({ isEditable: () => false });
  await assert.rejects(
    () => deleteFigureAnnotation(record, { lookup: async () => target.item }),
    /not editable/,
  );
  assert.equal(target.erased, 0);
});
