import assert from "node:assert/strict";
import test from "node:test";
import {
  collectReferences,
  collectNoteImages,
  deleteNoteImageBatch,
  deleteUnreferencedNoteImage,
  extractEmbeddedImageKeys,
  filterNoteImages,
  scanAttachmentReferences,
  scanNoteReferences,
  type NoteImageRecord,
} from "../src/modules/note-images";
import {
  readNoteTrashEntries,
  writeNoteTrashEntries,
} from "../src/modules/image-manager-trash";
import { exportNoteImages } from "../src/services/noteImageExport";

const image = (key: string, filename = "image.png") =>
  ({
    id: 5,
    key,
    libraryID: 1,
    noteID: 2,
    filename,
    collectionIDs: [7],
  }) as NoteImageRecord;

test("extracts only image attachment keys, including repeated references", () => {
  assert.deepEqual(
    extractEmbeddedImageKeys(
      '<img src="x" data-attachment-key="ABC12345"><img data-attachment-key="ABC12345"><a data-attachment-key="OTHER">x</a>',
    ),
    ["ABC12345", "ABC12345"],
  );
});

test("a removed image element leaves the attachment unreferenced", () => {
  const notes = [
    {
      id: 2,
      key: "NOTE0001",
      libraryID: 1,
      title: "Note",
      html: "<p>Text</p>",
    },
  ];
  const references = collectReferences(notes);
  assert.equal(references.get("1:IMAGE001"), undefined);
  const visible = filterNoteImages([image("IMAGE001")], {
    query: "IMAGE001",
    collectionKeys: new Set(["collection:7"]),
    referenceFilter: "unreferenced",
    references,
  });
  assert.equal(visible.length, 0); // filename search remains independent of the key
  assert.equal(
    filterNoteImages([image("IMAGE001")], {
      query: "image.png",
      collectionKeys: new Set(["collection:7"]),
      referenceFilter: "unreferenced",
      references,
    }).length,
    1,
  );
});

test("cross-note references are counted and unknown is never unreferenced", () => {
  const references = collectReferences([
    {
      id: 2,
      key: "A",
      libraryID: 1,
      title: "A",
      html: '<img data-attachment-key="IMAGE001">',
    },
    {
      id: 3,
      key: "B",
      libraryID: 1,
      title: "B",
      html: '<img data-attachment-key="IMAGE001">',
    },
  ]);
  assert.equal(references.get("1:IMAGE001")?.length, 2);
  const options = {
    query: "",
    collectionKeys: new Set(["collection:7"]),
    referenceFilter: "unreferenced" as const,
  };
  assert.deepEqual(
    filterNoteImages([image("IMAGE002")], { ...options, references: null }),
    [],
  );
  assert.equal(
    filterNoteImages([image("IMAGE002")], { ...options, references }).length,
    1,
  );
  assert.deepEqual(
    filterNoteImages([image("IMAGE001")], { ...options, references }),
    [],
  );
});

test("note attachment trash uses a separate preference", () => {
  const values = new Map<string, string>();
  (globalThis as any).Zotero = {
    Prefs: {
      get: (key: string) => values.get(key),
      set: (key: string, value: string) => values.set(key, value),
    },
  };
  const entries = [{ libraryID: 1, key: "IMAGE001", deletedAt: 10 }];
  writeNoteTrashEntries(entries);
  assert.deepEqual(readNoteTrashEntries(), entries);
  assert.match([...values.keys()][0], /noteImageManagerTrash$/);
});

test("unavailable display data does not stop scanning note HTML", async () => {
  (globalThis as any).Zotero = {
    Libraries: { getAll: () => [{ id: 1, libraryType: "user" }] },
    DB: {
      queryAsync: async (sql: string) => {
        assert.match(sql, /JOIN itemTypes T/);
        assert.match(sql, /T\.typeName='note'/);
        return [
          {
            id: 2,
            key: "NOTE0001",
            libraryID: 1,
            html: '<p><img data-attachment-key="IMAGE001"></p>',
          },
        ];
      },
    },
    Items: {
      getAsync: async () => {
        throw new Error("display data unavailable");
      },
    },
  };
  const scan = await scanNoteReferences();
  assert.equal(scan.checked, 1);
  assert.equal(scan.references.get("1:IMAGE001")?.[0].noteKey, "NOTE0001");
  assert.equal(scan.references.get("1:IMAGE001")?.[0].title, "NOTE0001");
});

test("failed database scan rejects instead of assigning zero references", async () => {
  (globalThis as any).Zotero = {
    Libraries: { getAll: () => [{ id: 1, libraryType: "user" }] },
    DB: {
      queryAsync: async () => {
        throw new Error("database unavailable");
      },
    },
  };
  await assert.rejects(() => scanNoteReferences(), /database unavailable/);
});

test("delete-time reference check reads current note HTML", async () => {
  (globalThis as any).Zotero = {
    DB: {
      queryAsync: async () => [
        {
          id: 3,
          key: "NOTE0002",
          libraryID: 1,
          html: '<img data-attachment-key="IMAGE001">',
        },
      ],
    },
  };
  const references = await scanAttachmentReferences(image("IMAGE001"));
  assert.equal(references.length, 1);
  assert.equal(references[0].noteID, 3);
});

test("collector includes only embedded images under notes", async () => {
  const note = {
    id: 2,
    key: "NOTE0001",
    isNote: () => true,
    loadAllData: async () => {},
    getDisplayTitle: () => "Source note",
    getCollections: () => [7],
  };
  (globalThis as any).Zotero = {
    Libraries: {
      getAll: () => [
        { id: 1, libraryType: "user", waitForDataLoad: async () => {} },
      ],
    },
    DB: { columnQueryAsync: async () => [5, 6] },
    Items: {
      getAsync: async (id: number) => ({
        id,
        key: id === 5 ? "IMAGE001" : "OTHER",
        libraryID: 1,
        parentItem: note,
        isEmbeddedImageAttachment: () => id === 5,
        loadAllData: async () => {},
        getFilePathAsync: async () =>
          "C:\\Zotero\\storage\\IMAGE001\\image.png",
        attachmentFilename: "image.png",
      }),
    },
    File: { pathToFileURI: () => "file:///image.png" },
  };
  const records = await collectNoteImages();
  assert.equal(records.length, 1);
  assert.equal(records[0].key, "IMAGE001");
  assert.deepEqual(records[0].collectionIDs, [7]);
});

test("permanent deletion refuses a referenced image before erasing it", async () => {
  let erased = 0;
  (globalThis as any).Zotero = {
    Items: {
      getAsync: async () => ({
        key: "IMAGE001",
        libraryID: 1,
        parentItemID: 2,
        isEmbeddedImageAttachment: () => true,
        loadAllData: async () => {},
        isEditable: () => true,
        eraseTx: async () => {
          erased++;
        },
      }),
    },
  };
  await assert.rejects(
    () =>
      deleteUnreferencedNoteImage(
        image("IMAGE001"),
        new Map([["1:IMAGE001", [{ noteID: 2, noteKey: "N", title: "N" }]]]),
      ),
    /referenced/,
  );
  assert.equal(erased, 0);
  await deleteUnreferencedNoteImage(image("IMAGE001"), new Map());
  assert.equal(erased, 1);
});

test("note image export sends the attachment file path to Eagle", async () => {
  let requestBody: Record<string, unknown> | null = null;
  (globalThis as any).Zotero = {
    Libraries: { get: () => ({ libraryType: "user" }) },
    Prefs: { get: () => "" },
    HTTP: {
      request: async (
        _method: string,
        _url: string,
        options: { body: string },
      ) => {
        requestBody = JSON.parse(options.body);
        return { response: { status: "success", data: { id: "EAGLE1" } } };
      },
    },
  };
  const record = {
    ...image("IMAGE001", "image.png"),
    noteKey: "NOTE0001",
    noteTitle: "Source note",
    filePath: "C:\\Zotero\\storage\\IMAGE001\\image.png",
  };
  const results = await exportNoteImages([record]);
  assert.equal(results[0].success, true);
  assert.equal(requestBody?.path, record.filePath);
  assert.equal(requestBody?.name, "image.png");
  assert.match(String(requestBody?.website), /NOTE0001/);
});

test("batch deletion keeps referenced and failed attachments for retry", async () => {
  const errors: unknown[] = [];
  const deleted: string[] = [];
  const result = await deleteNoteImageBatch(
    [image("A"), image("B"), image("C")],
    new Map(),
    {
      check: async (record) =>
        record.key === "B" ? [{ noteID: 2, noteKey: "N", title: "N" }] : [],
      erase: async (record) => {
        if (record.key === "C") throw new Error("read only");
        deleted.push(record.key);
      },
      onError: (error) => errors.push(error),
    },
  );
  assert.deepEqual(deleted, ["A"]);
  assert.deepEqual([...result.deleted], ["1:A"]);
  assert.equal(result.protectedCount, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.errors[0].record.key, "C");
  assert.equal(errors.length, 1);
});
