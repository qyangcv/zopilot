import { assert } from "chai";
import { buildCodexSubprocessEnvironment } from "../../../src/codex/subprocessEnvironment.ts";

describe("Codex subprocess environment", function () {
  it("prepends supported Codex binary directories when PATH is missing", function () {
    const environment = buildCodexSubprocessEnvironment({});

    assert.equal(environment.PATH, "/opt/homebrew/bin:/usr/local/bin");
  });

  it("keeps existing PATH entries after the supported defaults", function () {
    const environment = buildCodexSubprocessEnvironment({
      PATH: "/custom/bin:/another/bin",
    });

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/custom/bin:/another/bin",
    );
  });

  it("does not duplicate supported PATH entries", function () {
    const environment = buildCodexSubprocessEnvironment({
      PATH: "/usr/bin:/opt/homebrew/bin:/custom/bin",
    });

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/custom/bin",
    );
  });
});
