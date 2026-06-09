import { assert } from "chai";
import { buildPaperQuestionPrompt } from "../../src/codex/promptBuilder.ts";

describe("buildPaperQuestionPrompt", function () {
  it("keeps the visible turn input to the user prompt only", function () {
    const question = "Summarize the method section.";

    assert.strictEqual(buildPaperQuestionPrompt(question), question);
  });
});
