import { assert } from "chai";
import { config } from "../../package.json";

describe("startup", function () {
  it("has the plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });
});
