import { assert } from "chai";
import { config } from "../package.json";
import { collectFigureAnnotations } from "../src/modules/figure-annotations";
import { collectNoteImages } from "../src/modules/note-images";
import { NoteReferenceIndex } from "../src/modules/note-reference-index";
import { closeOverviewWindow, waitForOverviewReady } from "./overview-helpers";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==";
// skipSelect 避免条目列表选中新条目后由笔记编辑器在后台再次保存
const SAVE_OPTIONS = { skipSelect: true };

function pngBlob() {
  return new Blob(
    [Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))],
    { type: "image/png" },
  );
}

async function createPdfAttachment(title: string, collectionID?: number) {
  const parent = new Zotero.Item("journalArticle");
  parent.libraryID = Zotero.Libraries.userLibraryID;
  parent.setField("title", title);
  parent.setCreators([
    { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
  ]);
  if (collectionID) parent.setCollections([collectionID]);
  await parent.saveTx(SAVE_OPTIONS);
  const attachment = new Zotero.Item("attachment");
  attachment.libraryID = parent.libraryID;
  attachment.parentID = parent.id;
  attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
  attachment.attachmentContentType = "application/pdf";
  attachment.attachmentPath = "storage:figures.pdf";
  attachment.setField("title", `${title} PDF`);
  await attachment.saveTx(SAVE_OPTIONS);
  return { parent, attachment };
}

async function createImageAnnotation(
  attachment: Zotero.Item,
  { color, comment, page }: { color: string; comment: string; page: number },
) {
  const annotation = new Zotero.Item("annotation") as any;
  annotation.libraryID = attachment.libraryID;
  annotation.parentID = attachment.id;
  annotation.annotationType = "image";
  annotation.annotationColor = color;
  annotation.annotationComment = comment;
  annotation.annotationPageLabel = String(page);
  annotation.annotationSortIndex = `${String(page).padStart(5, "0")}|000000|00000`;
  annotation.annotationPosition = JSON.stringify({
    pageIndex: page - 1,
    rects: [[10, 20, 210, 120]],
  });
  await annotation.saveTx(SAVE_OPTIONS);
  return annotation as Zotero.Item;
}

async function createNote(html: string, collectionID?: number) {
  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Libraries.userLibraryID;
  note.setNote(html);
  if (collectionID) note.setCollections([collectionID]);
  await note.saveTx(SAVE_OPTIONS);
  return note;
}

async function attachImage(note: Zotero.Item) {
  return Zotero.Attachments.importEmbeddedImage({
    blob: pngBlob(),
    parentItemID: note.id,
    saveOptions: SAVE_OPTIONS,
  });
}

async function createImageNote(title: string, collectionID?: number) {
  const note = await createNote(`<h1>${title}</h1>`, collectionID);
  const image = await attachImage(note);
  note.setNote(
    `<h1>${title}</h1><p><img data-attachment-key="${image.key}"></p>`,
  );
  await note.saveTx(SAVE_OPTIONS);
  return { note, image };
}

async function createCollection(name: string) {
  const collection = new Zotero.Collection();
  collection.libraryID = Zotero.Libraries.userLibraryID;
  collection.name = name;
  await collection.saveTx(SAVE_OPTIONS);
  return collection;
}

// clientDateModified 精确到秒，等到下一秒再读取，读取时间才会晚于此前所有保存
async function waitForNextSecond() {
  const second = Math.floor(Date.now() / 1000);
  while (Math.floor(Date.now() / 1000) === second) {
    await Zotero.Promise.delay(20);
  }
}

function indexPath(name: string) {
  return PathUtils.join(
    Zotero.DataDirectory.dir,
    "reference-index-test",
    `${name}.json`,
  );
}

function identity(item: Zotero.Item) {
  return `${item.libraryID}:${item.key}`;
}

async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("image manager data", function () {
  this.timeout(60_000);

  it("builds figure records from bulk-loaded item data and reloads changes immediately", async function () {
    const collection = await createCollection("Figure records");
    const { parent, attachment } = await createPdfAttachment(
      "Figure source paper",
      collection.id,
    );
    const first = await createImageAnnotation(attachment, {
      color: "#ff6666",
      comment: "first figure",
      page: 3,
    });
    try {
      const record = (await collectFigureAnnotations()).find(
        (item) => item.key === first.key,
      );
      assert.exists(record);
      assert.equal(record!.color, "#ff6666");
      assert.equal(record!.comment, "first figure");
      assert.equal(record!.pageLabel, "3");
      assert.deepEqual(record!.position, {
        pageIndex: 2,
        rects: [[10, 20, 210, 120]],
      });
      assert.equal(record!.attachmentID, attachment.id);
      assert.equal(record!.attachmentKey, attachment.key);
      assert.equal(record!.attachmentTitle, attachment.getDisplayTitle());
      assert.equal(record!.attachmentFilename, "figures.pdf");
      assert.equal(record!.filePath, attachment.getFilePath());
      assert.equal(record!.topLevelItemID, parent.id);
      assert.equal(record!.topLevelTitle, "Figure source paper");
      assert.deepEqual(record!.collectionIDs, [collection.id]);
      assert.equal(
        record!.imagePath,
        Zotero.Annotations.getCacheImagePath(first),
      );
      assert.equal(
        record!.imageURI,
        Zotero.File.pathToFileURI(record!.imagePath!),
      );

      const second = await createImageAnnotation(attachment, {
        color: "#5fb236",
        comment: "second figure",
        page: 4,
      });
      first.deleted = true;
      await first.saveTx(SAVE_OPTIONS);
      const keys = (await collectFigureAnnotations()).map((item) => item.key);
      assert.include(keys, second.key);
      assert.notInclude(keys, first.key);
    } finally {
      await parent.eraseTx();
      await collection.eraseTx();
    }
  });

  it("collects note images with note titles and collections", async function () {
    const collection = await createCollection("Note images");
    const { note, image } = await createImageNote(
      "Collected image note",
      collection.id,
    );
    try {
      const record = (await collectNoteImages()).find(
        (item) => item.id === image.id,
      );
      assert.exists(record);
      assert.equal(record!.noteID, note.id);
      assert.equal(record!.noteKey, note.key);
      assert.equal(record!.noteTitle, "Collected image note");
      assert.deepEqual(record!.collectionIDs, [collection.id]);
      assert.equal(record!.filePath, await image.getFilePathAsync());
      assert.equal(
        record!.imageURI,
        Zotero.File.pathToFileURI(record!.filePath!),
      );
    } finally {
      await note.eraseTx();
      await collection.eraseTx();
    }
  });

  it("persists note references and rereads only changed notes", async function () {
    const path = indexPath("incremental");
    const first = await createImageNote("Referencing note A");
    const second = await createImageNote("Referencing note B");
    const textNote = await createNote("<p>Plain text note</p>");
    try {
      await waitForNextSecond();
      const index = new NoteReferenceIndex(path);
      const built = await index.refresh();
      assert.equal(built.readNotes, built.checked);
      assert.deepEqual(built.references.get(identity(first.image)), [
        {
          noteID: first.note.id,
          noteKey: first.note.key,
          title: "Referencing note A",
        },
      ]);
      assert.lengthOf(built.references.get(identity(second.image))!, 1);
      const snapshot = await IOUtils.readJSON(path);
      assert.equal(snapshot.version, 1);
      assert.lengthOf(snapshot.notes, built.checked);

      const unchanged = await index.refresh();
      assert.equal(unchanged.readNotes, 0);

      const restarted = new NoteReferenceIndex(path);
      const restored = await restarted.refresh();
      assert.equal(restored.readNotes, 0);
      assert.equal(restored.checked, built.checked);
      assert.lengthOf(restored.references.get(identity(first.image))!, 1);

      first.note.setNote("<h1>Referencing note A</h1><p>image removed</p>");
      await first.note.saveTx(SAVE_OPTIONS);
      const edited = await restarted.refresh();
      assert.equal(edited.readNotes, 1);
      assert.isUndefined(edited.references.get(identity(first.image)));
      assert.lengthOf(edited.references.get(identity(second.image))!, 1);

      second.note.deleted = true;
      await second.note.saveTx(SAVE_OPTIONS);
      const trashed = await restarted.refresh();
      assert.equal(trashed.checked, built.checked - 1);
      assert.isUndefined(trashed.references.get(identity(second.image)));

      second.note.deleted = false;
      await second.note.saveTx(SAVE_OPTIONS);
      const untrashed = await restarted.refresh();
      assert.equal(untrashed.checked, built.checked);
      assert.lengthOf(untrashed.references.get(identity(second.image))!, 1);

      const full = await restarted.refresh({ full: true });
      assert.equal(full.readNotes, full.checked);
      assert.deepEqual(
        [...full.references.entries()].sort(),
        [...untrashed.references.entries()].sort(),
      );
    } finally {
      await first.note.eraseTx();
      await second.note.eraseTx();
      await textNote.eraseTx();
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  });

  it("rereads a note edited in the same second as the previous read", async function () {
    const path = indexPath("same-second");
    const { note, image } = await createImageNote("Quickly edited note");
    try {
      const index = new NoteReferenceIndex(path);
      const built = await index.refresh();
      assert.lengthOf(built.references.get(identity(image))!, 1);
      note.setNote("<h1>Quickly edited note</h1>");
      await note.saveTx(SAVE_OPTIONS);
      const edited = await index.refresh();
      assert.isAtLeast(edited.readNotes, 1);
      assert.isUndefined(edited.references.get(identity(image)));
    } finally {
      await note.eraseTx();
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  });

  it("rejects a corrupt index file until a full rescan rewrites it", async function () {
    const path = indexPath("corrupt");
    await IOUtils.makeDirectory(PathUtils.parent(path)!, {
      ignoreExisting: true,
    });
    await IOUtils.writeUTF8(path, '{"version":1,"notes":{}}');
    try {
      const error = await rejectionOf(new NoteReferenceIndex(path).refresh());
      assert.match(String(error), /notes must be an array/);
      const rebuilt = await new NoteReferenceIndex(path).refresh({
        full: true,
      });
      assert.equal(rebuilt.readNotes, rebuilt.checked);
      const snapshot = await IOUtils.readJSON(path);
      assert.equal(snapshot.version, 1);
      assert.lengthOf(snapshot.notes, rebuilt.checked);
      const reopened = await new NoteReferenceIndex(path).refresh();
      assert.equal(reopened.checked, rebuilt.checked);
    } finally {
      await IOUtils.remove(path, { ignoreAbsent: true });
    }
  });

  it("shows note reference status when the note tab opens without a manual scan", async function () {
    const referencedTitle = "Window referenced note";
    const orphanTitle = "Window orphan note";
    const referenced = await createImageNote("Window referenced note");
    const orphanNote = await createNote("<h1>Window orphan note</h1>");
    await attachImage(orphanNote);
    const manager = Zotero[config.addonInstance].api.openOverview() as Window;
    try {
      await showNoteTab(manager);
      const { unchecked, unreferenced } = noteBadgeLabels();
      const badges = await waitForNoteBadges(manager, [
        referencedTitle,
        orphanTitle,
      ]);
      assert.notEqual(badges.get(referencedTitle), unchecked);
      assert.equal(badges.get(orphanTitle), unreferenced);
      assert.isTrue(
        await IOUtils.exists(
          PathUtils.join(
            Zotero.DataDirectory.dir,
            "zotero2eagle",
            "note-references.json",
          ),
        ),
      );
    } finally {
      await closeOverviewWindow(manager);
      await referenced.note.eraseTx();
      await orphanNote.eraseTx();
    }
  });

  it("permanently deletes an unreferenced note image from the manager trash", async function () {
    const confirmPref = `${config.prefsPrefix}.confirmDelete`;
    Zotero.Prefs.set(confirmPref, false, true);
    const orphanTitle = "Deletion orphan note";
    const referenced = await createImageNote("Deletion referenced note");
    const orphanNote = await createNote("<h1>Deletion orphan note</h1>");
    const orphan = await attachImage(orphanNote);
    const manager = Zotero[config.addonInstance].api.openOverview() as Window;
    try {
      await showNoteTab(manager);
      await waitForNoteBadges(manager, [orphanTitle]);
      const orphanCard = (await waitForNoteCard(manager, orphanTitle))!;
      (
        orphanCard.querySelector(".figure-select-checkbox") as HTMLInputElement
      ).click();
      noteElement(manager, "move-trash").click();
      noteElement(manager, "trash").click();
      const trashedOrphan = (await waitForNoteCard(manager, orphanTitle))!;
      (
        trashedOrphan.querySelector(
          ".figure-select-checkbox",
        ) as HTMLInputElement
      ).click();
      noteElement(manager, "delete-forever").click();
      const startedAt = Date.now();
      while (
        (await Zotero.Items.getAsync(orphan.id)) &&
        Date.now() - startedAt < 20_000
      ) {
        await Zotero.Promise.delay(50);
      }
      assert.isFalse(await Zotero.Items.getAsync(orphan.id));
      assert.exists(await Zotero.Items.getAsync(referenced.image.id));
    } finally {
      Zotero.Prefs.set(confirmPref, true, true);
      await closeOverviewWindow(manager);
      await referenced.note.eraseTx();
      await orphanNote.eraseTx();
    }
  });
});

async function showNoteTab(manager: Window) {
  await waitForOverviewReady(manager);
  (
    manager.document.getElementById(
      `${config.addonRef}-tab-notes`,
    ) as HTMLElement
  ).click();
}

function noteElement(manager: Window, name: string) {
  return manager.document.getElementById(
    `${config.addonRef}-note-${name}`,
  ) as HTMLElement;
}

function noteBadgeLabels() {
  const [unchecked, unreferenced] = Zotero[
    config.addonInstance
  ].data.locale.current
    .formatMessagesSync([
      { id: `${config.addonRef}-note-unchecked` },
      { id: `${config.addonRef}-note-unreferenced` },
    ])
    .map((message: { value: string }) => message.value);
  return { unchecked, unreferenced };
}

function noteCards(manager: Window) {
  return [...noteElement(manager, "grid").querySelectorAll(".figure-card")];
}

function noteCardTitle(card: Element) {
  return card.querySelector(".figure-note-meta")?.textContent?.trim() || "";
}

async function waitForNoteCard(manager: Window, noteTitle: string) {
  const startedAt = Date.now();
  let matched: Element | null = null;
  while (Date.now() - startedAt < 20_000) {
    matched =
      noteCards(manager).find((card) => noteCardTitle(card) === noteTitle) ||
      null;
    if (matched) break;
    await Zotero.Promise.delay(50);
  }
  assert.exists(matched);
  return matched;
}

// 等待笔记页签中指定笔记都渲染出卡片，并且这些卡片都已有引用状态
async function waitForNoteBadges(manager: Window, noteTitles: string[]) {
  const { unchecked } = noteBadgeLabels();
  const startedAt = Date.now();
  const badges = new Map<string, string>();
  while (Date.now() - startedAt < 20_000) {
    badges.clear();
    for (const card of noteCards(manager)) {
      const title = noteCardTitle(card);
      if (!noteTitles.includes(title)) continue;
      badges.set(
        title,
        card.querySelector(".figure-ref-badge")?.textContent?.trim() || "",
      );
    }
    if (
      noteTitles.every(
        (title) => badges.has(title) && badges.get(title) !== unchecked,
      )
    ) {
      break;
    }
    await Zotero.Promise.delay(50);
  }
  assert.sameMembers([...badges.keys()], noteTitles);
  return badges;
}
