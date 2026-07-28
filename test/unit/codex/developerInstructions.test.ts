import { assert } from "chai";
import { buildCodexDeveloperInstructions } from "../../../src/application/agent/prompt/developerInstructions.ts";

describe("buildCodexDeveloperInstructions", function () {
  it("routes paper questions through the multi-tool evidence chain", function () {
    const instructions = buildCodexDeveloperInstructions();

    assert.include(instructions, "Use `get_outline`");
    assert.include(instructions, "Use `search` directly");
    assert.include(instructions, "Use `search`");
    assert.include(instructions, "returned by `get_outline` or `search`");
    assert.include(instructions, "Use `read`");
    assert.include(instructions, "Use `view_page`");
    assert.include(instructions, "never invent or edit a locator");
    assert.notInclude(instructions, "paper_read");
  });
});
