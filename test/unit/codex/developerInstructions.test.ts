import { assert } from "chai";
import { buildCodexDeveloperInstructions } from "../../../src/codex/developerInstructions.ts";

describe("buildCodexDeveloperInstructions", function () {
  it("keeps paper_read routing in developer instructions", function () {
    const instructions = buildCodexDeveloperInstructions();

    assert.strictEqual(
      instructions,
      [
        "You are running inside Zopilot, attached to the current Zotero PDF reader.",
        "When the user asks about paper, use `paper_read` before answering.",
        "`paper_read` will read the current PDF in Zotero and extract information from it, which you can then use to answer the user's question.",
        "Do not describe MCP tools, tool calls, or internal workflow.",
      ].join("\n"),
    );
  });
});
