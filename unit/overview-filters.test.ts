import assert from "node:assert/strict";
import test from "node:test";
import {
  COLLECTION_KEY_PREFIX,
  UNCATEGORIZED_COLLECTION_KEY,
  createDefaultOverviewFilters,
  getAvailableColors,
  getRecordCollectionKeys,
  matchesFigureFilenameSearch,
  recordMatchesOverviewFilters,
  setThumbnailSizeStyle,
  type FigureAnnotationRecord,
} from "../src/modules/overview-filters";

function record(
  overrides: Partial<FigureAnnotationRecord> = {},
): FigureAnnotationRecord {
  return {
    id: 1,
    key: "A",
    libraryID: 1,
    color: "#ffd400",
    pageLabel: "1",
    sortIndex: "00001|000001|00000",
    comment: "",
    dateAdded: "2026-04-23 09:00:00",
    dateModified: "2026-04-24 12:00:00",
    attachmentID: 2,
    attachmentKey: "ATTACH",
    attachmentTitle: "PDF",
    attachmentFilename: "source-paper.pdf",
    topLevelItemID: 3,
    topLevelTitle: "Paper",
    collectionIDs: [5],
    position: null,
    imageHeightRatio: null,
    imageURI: "file:///tmp/A.png",
    ...overrides,
  };
}

test("available colors are unique and stable", () => {
  assert.deepEqual(
    getAvailableColors([
      record({ color: "#2ea8e5" }),
      record({ color: "#ffd400" }),
      record({ color: "#2ea8e5" }),
    ]),
    ["#2ea8e5", "#ffd400"],
  );
});

test("PDF image search uses the source PDF filename", () => {
  assert.equal(matchesFigureFilenameSearch(record(), "PAPER.PDF"), true);
  assert.equal(matchesFigureFilenameSearch(record(), "other.pdf"), false);
});

test("collection keys use Zotero collection ids or uncategorized fallback", () => {
  assert.deepEqual(getRecordCollectionKeys(record({ collectionIDs: [5, 8] })), [
    `${COLLECTION_KEY_PREFIX}5`,
    `${COLLECTION_KEY_PREFIX}8`,
  ]);
  assert.deepEqual(getRecordCollectionKeys(record({ collectionIDs: [] })), [
    UNCATEGORIZED_COLLECTION_KEY,
  ]);
});

test("default filters select every visible color and collection", () => {
  const filters = createDefaultOverviewFilters([
    record({ color: "#ffd400", collectionIDs: [5] }),
    record({ color: "#2ea8e5", collectionIDs: [] }),
  ]);

  assert.deepEqual([...filters.selectedColors], ["#ffd400", "#2ea8e5"]);
  assert.deepEqual(
    [...filters.selectedCollectionKeys],
    [`${COLLECTION_KEY_PREFIX}5`, UNCATEGORIZED_COLLECTION_KEY],
  );
  assert.equal(filters.thumbnailSize, 220);
});

test("record matches when color and any collection are selected", () => {
  const filters = createDefaultOverviewFilters([
    record({ color: "#ffd400", collectionIDs: [5, 8] }),
  ]);
  filters.selectedCollectionKeys = new Set([`${COLLECTION_KEY_PREFIX}8`]);

  assert.equal(
    recordMatchesOverviewFilters(record({ collectionIDs: [5, 8] }), filters),
    true,
  );

  filters.selectedColors = new Set(["#2ea8e5"]);
  assert.equal(
    recordMatchesOverviewFilters(record({ color: "#ffd400" }), filters),
    false,
  );
});

test("thumbnail slider writes card width and image height css variables", () => {
  const style = new Map<string, string>();
  const element = {
    style: {
      setProperty(name: string, value: string) {
        style.set(name, value);
      },
    },
  } as unknown as HTMLElement;

  setThumbnailSizeStyle(element, 260);
  assert.equal(style.get("--figure-card-width"), "260px");
  assert.equal(style.get("--figure-image-height"), "187px");
});
