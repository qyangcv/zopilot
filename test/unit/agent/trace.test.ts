import { assert } from "chai";
import { RunningTurnStore } from "../../../src/features/sidebar/chat/RunningTurnStore.ts";
import { combineFailedTurnText } from "../../../src/features/sidebar/chat/TurnCoordinator.ts";

describe("running turn store", function () {
  it("keeps trace order and stable references for unchanged blocks", function () {
    const store = createStore();
    store.apply("conv-stream", {
      type: "reasoning.append",
      sequence: 1,
      blockId: "reasoning-a",
      kind: "content",
      expectedOffset: 0,
      delta: "Inspecting sources",
    });
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 2,
      blockId: "response-a",
      phase: "candidate",
      expectedOffset: 0,
      delta: "I will read the paper.",
    });
    store.apply(
      "conv-stream",
      {
        type: "tool.started",
        sequence: 3,
        blockId: "call-a",
        name: "paper_read",
      },
      1_000,
    );

    const before = store.getSnapshot("conv-stream")!;
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 4,
      blockId: "response-b",
      phase: "candidate",
      expectedOffset: 0,
      delta: "Final",
    });
    const after = store.getSnapshot("conv-stream")!;

    assert.deepEqual(
      after.traceBlocks.map((block) => block.type),
      ["reasoning", "commentary", "tool"],
    );
    assert.strictEqual(after.traceBlocks[0], before.traceBlocks[0]);
    assert.strictEqual(after.traceBlocks[1], before.traceBlocks[1]);
    assert.strictEqual(after.traceBlocks[2], before.traceBlocks[2]);
    assert.equal(after.answerBlocks[0]?.text, "Final");
  });

  it("waits for a replace after an append sequence or offset gap", function () {
    const store = createStore();
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 1,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 0,
      delta: "Part",
    });
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 3,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 4,
      delta: " stale",
    });
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 4,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 4,
      delta: " ignored",
    });
    assert.equal(store.getProjection("conv-stream").finalText, "Part");

    store.apply("conv-stream", {
      type: "content.replace",
      sequence: 5,
      blockId: "answer",
      phase: "final_answer",
      text: "Complete",
    });
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 6,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 8,
      delta: "!",
    });
    assert.equal(store.getProjection("conv-stream").finalText, "Complete!");
  });

  it("freezes visible content after interruption and interrupts open tools", function () {
    const store = createStore();
    store.apply(
      "conv-stream",
      {
        type: "tool.started",
        sequence: 1,
        blockId: "call-a",
        name: "paper_read",
      },
      1_000,
    );
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 2,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 0,
      delta: "Shown",
    });
    store.requestInterrupt("conv-stream");
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 3,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 5,
      delta: " hidden",
    });
    store.apply(
      "conv-stream",
      {
        type: "turn.completed",
        sequence: 4,
        text: "Shown hidden",
      },
      4_000,
    );

    const snapshot = store.getSnapshot("conv-stream")!;
    assert.equal(snapshot.lifecycle, "interrupted");
    assert.equal(store.getProjection("conv-stream").finalText, "Shown");
    assert.deepInclude(snapshot.traceBlocks[0], {
      type: "tool",
      status: "interrupted",
      durationMs: 3_000,
    });
  });

  it("uses the authoritative completed text for the final answer", function () {
    const store = createStore();
    store.apply("conv-stream", {
      type: "content.append",
      sequence: 1,
      blockId: "answer",
      phase: "final_answer",
      expectedOffset: 0,
      delta: "Part",
    });
    store.apply("conv-stream", {
      type: "turn.completed",
      sequence: 2,
      text: "Complete answer",
    });

    assert.equal(
      store.getProjection("conv-stream").finalText,
      "Complete answer",
    );
  });

  it("reconciles a terminal event with the authoritative AgentRunResult", function () {
    const store = createStore();
    store.apply("conv-stream", {
      type: "turn.completed",
      sequence: 1,
      text: "Stale event text",
    });
    store.reconcileAgentResult("conv-stream", {
      backendId: "codex-cli.default",
      providerProfileId: "codex-cli.default",
      runId: "thread-a",
      turnId: "turn-a",
      text: "Authoritative result",
      status: "completed",
    });

    assert.equal(
      store.getProjection("conv-stream").finalText,
      "Authoritative result",
    );
  });

  it("keeps streamed text when a turn ends with the existing error message", function () {
    const formattedError = "Provider request failed.\n\n```\ntimed out\n```";

    assert.equal(
      combineFailedTurnText("Already streamed", formattedError),
      `Already streamed\n\n${formattedError}`,
    );
    assert.equal(combineFailedTurnText("", formattedError), formattedError);
  });
});

function createStore(): RunningTurnStore {
  const store = new RunningTurnStore();
  store.create({
    conversationId: "conv-stream",
    messageId: "assistant-stream",
  });
  return store;
}
