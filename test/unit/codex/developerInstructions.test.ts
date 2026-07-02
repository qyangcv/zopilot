import { assert } from "chai";
import { buildCodexDeveloperInstructions } from "../../../src/codex/developerInstructions.ts";

describe("buildCodexDeveloperInstructions", function () {
  it("keeps paper_read routing in developer instructions", function () {
    const instructions = buildCodexDeveloperInstructions();

    assert.strictEqual(
      instructions,
      [
        "You are running inside Zopilot, attached to a Zotero paper conversation.",
        "When the user asks about paper, use `paper_read` before answering.",
        "`paper_read` will read the Zotero PDF bound to this Zopilot conversation and extract information from it, which you can then use to answer the user's question.",
        "If the user prompt includes Zopilot selected sources from @ mentions, call `paper_read` with the listed `sourceIds` exactly.",
        "Do not send progress updates before or between paper_read calls; wait until you have enough evidence, then produce the final answer.",
        "Do not describe MCP tools, tool calls, extraction quality, local files, page image paths, context truncation, or internal workflow.",
        "If the available evidence is incomplete, answer conservatively from the evidence instead of narrating retrieval limitations.",
      ].join("\n"),
    );
  });
});
