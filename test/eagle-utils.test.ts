import { assert } from "chai";
import {
  buildEagleAnnotation,
  buildEagleFilename,
  buildEagleOptions,
  buildEagleTags,
  MetadataSummary,
} from "../src/services/eagleClient";
import { buildOpenPdfLink } from "../src/utils/zoteroLink";

const sampleMetadata: MetadataSummary = {
  annotationKey: "ANN12345",
  attachmentKey: "ATTACH99",
  authors: ["Ada Lovelace", "Grace Hopper"],
  page: 7,
  title: "A Study on Annotated Images",
  year: "2026",
};

describe("eagle export helpers", function () {
  it("should build a zotero open-pdf link", function () {
    const link = buildOpenPdfLink({
      annotationKey: sampleMetadata.annotationKey,
      attachmentKey: sampleMetadata.attachmentKey,
      page: sampleMetadata.page,
    });

    assert.equal(
      link,
      "zotero://open-pdf/library/items/ATTACH99?page=7&annotation=ANN12345",
    );
  });

  it("should build stable eagle tags", function () {
    assert.deepEqual(buildEagleTags(sampleMetadata), ["Zotero", "Lovelace"]);
  });

  it("should build eagle annotation text", function () {
    const annotation = buildEagleAnnotation(sampleMetadata);

    assert.include(annotation, "Title: A Study on Annotated Images");
    assert.include(annotation, "Authors: Ada Lovelace, Grace Hopper");
    assert.include(annotation, "Year: 2026");
    assert.include(annotation, "Page: 7");
    assert.include(annotation, "Attachment Key: ATTACH99");
    assert.include(annotation, "Annotation Key: ANN12345");
  });

  it("should sanitize file names for eagle", function () {
    const filename = buildEagleFilename({
      ...sampleMetadata,
      title: "Unsafe:/Name*?",
    });

    assert.equal(filename, "Unsafe_Name_ATTACH99_p7.png");
  });

  it("should map folder id for the local Eagle HTTP API", function () {
    const options = buildEagleOptions(
      sampleMetadata,
      "zotero://open-pdf/library/items/ATTACH99?page=7&annotation=ANN12345",
      "FOLDER123",
    );

    assert.equal(options.folderId, "FOLDER123");
  });
});
