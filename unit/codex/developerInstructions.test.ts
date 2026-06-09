import { assert } from "chai";
import { buildCodexDeveloperInstructions } from "../../src/codex/developerInstructions.ts";

describe("buildCodexDeveloperInstructions", function () {
  it("keeps fixed behavior and tool routing out of the user prompt", function () {
    const instructions = buildCodexDeveloperInstructions();

    assert.strictEqual(
      instructions,
      "Use `paper_read` when you need information from the paper.",
    );
  });
});
