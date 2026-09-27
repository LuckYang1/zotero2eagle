import { assert } from "chai";
import { config, version } from "../package.json";
import {
  collectNoteImages,
  deleteUnreferencedNoteImage,
  scanAttachmentReferences,
  scanNoteReferences,
} from "../src/modules/note-images";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should expose annotation export service", function () {
    assert.exists(Zotero[config.addonInstance].data.annotationExport);
  });

  it("should install the image manager toolbar button", function () {
    assert.exists(
      Zotero.getMainWindow().document.getElementById(
        `${config.addonRef}-image-manager-toolbar-button`,
      ),
    );
  });

  it("should open the image manager window with batch and trash controls", async function () {
    const manager = Zotero[config.addonInstance].api.openOverview() as Window;
    try {
      if (manager.document.readyState !== "complete") {
        await new Promise<void>((resolve) =>
          manager.addEventListener("load", () => resolve(), { once: true }),
        );
      }
      assert.exists(
        manager.document.getElementById(
          `${config.addonRef}-image-manager-grid`,
        ),
      );
      assert.exists(
        manager.document.getElementById(
          `${config.addonRef}-image-manager-save`,
        ),
      );
      assert.exists(
        manager.document.getElementById(
          `${config.addonRef}-image-manager-trash`,
        ),
      );
      assert.exists(
        manager.document.getElementById(`${config.addonRef}-tab-notes`),
      );
      assert.exists(
        manager.document.getElementById(`${config.addonRef}-note-scan`),
      );
      assert.exists(
        manager.document.getElementById(`${config.addonRef}-note-grid`),
      );
      const noteTab = manager.document.getElementById(
        `${config.addonRef}-tab-notes`,
      ) as HTMLElement;
      const noteRoot = manager.document.getElementById(
        `${config.addonRef}-note-manager-root`,
      ) as HTMLElement;
      const figureRoot = manager.document.getElementById(
        `${config.addonRef}-image-manager-root`,
      ) as HTMLElement;
      const figureTop = figureRoot.getBoundingClientRect().top;
      assert.include(
        manager.document.documentElement?.getAttribute("title"),
        `v${version}`,
      );
      assert.equal(manager.getComputedStyle(figureRoot).display, "grid");
      assert.equal(manager.getComputedStyle(noteRoot).display, "none");
      noteTab.dispatchEvent(
        new manager.MouseEvent("mousedown", { button: 0, bubbles: true }),
      );
      assert.isFalse(noteRoot.hidden);
      assert.equal(manager.getComputedStyle(figureRoot).display, "none");
      assert.equal(manager.getComputedStyle(noteRoot).display, "grid");
      assert.equal(noteRoot.getBoundingClientRect().top, figureTop);
      assert.isAbove(
        manager.document
          .getElementById(`${config.addonRef}-note-scan`)
          ?.getBoundingClientRect().width ?? 0,
        0,
      );
      assert.equal(
        manager.document
          .getElementById(`${config.addonRef}-image-manager-colors`)
          ?.getBoundingClientRect().width,
        0,
      );
      (
        manager.document.getElementById(
          `${config.addonRef}-tab-figures`,
        ) as HTMLElement
      ).click();
      assert.isTrue(noteRoot.hidden);
      assert.equal(manager.getComputedStyle(figureRoot).display, "grid");
      assert.equal(manager.getComputedStyle(noteRoot).display, "none");
    } finally {
      manager.close();
    }
  });

  it("should query note attachments and references through Zotero APIs", async function () {
    const images = await collectNoteImages();
    const scan = await scanNoteReferences();
    assert.isArray(images);
    assert.equal(scan.checked, scan.total);
  });

  it("should permanently erase an unreferenced embedded image", async function () {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote("<p>Test note without an image reference</p>");
    await note.saveTx();
    try {
      const png = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==",
        ),
        (char) => char.charCodeAt(0),
      );
      const blob = new Blob([png], { type: "image/png" });
      const attachment = await Zotero.Attachments.importEmbeddedImage({
        blob,
        parentItemID: note.id,
      });
      const record = (await collectNoteImages()).find(
        (item) => item.id === attachment.id,
      );
      assert.exists(record);
      assert.deepEqual(await scanAttachmentReferences(record!), []);
      Zotero.Items.unload(attachment.id);
      await deleteUnreferencedNoteImage(record!, new Map());
      assert.isFalse(await Zotero.Items.getAsync(attachment.id));
    } finally {
      await note.eraseTx();
    }
  });
});
