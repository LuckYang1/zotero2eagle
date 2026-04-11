import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should expose annotation export service", function () {
    assert.exists(Zotero[config.addonInstance].data.annotationExport);
  });
});
