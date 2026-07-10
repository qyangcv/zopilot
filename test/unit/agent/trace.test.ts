import { assert } from "chai";
import {
  createAgentTurnTraceState,
  projectAgentTurnTrace,
  reduceAgentTraceEvent,
} from "../../../src/domain/agent/trace.ts";

describe("agent turn trace", function () {
  it("keeps reasoning and tools separate from the final answer", function () {
    let state = createAgentTurnTraceState();
    state = reduceAgentTraceEvent(state, {
      type: "reasoning.delta",
      itemId: "reasoning-a",
      kind: "content",
      delta: "Inspecting sources",
    });
    state = reduceAgentTraceEvent(state, {
      type: "content.delta",
      itemId: "response-a",
      phase: "candidate",
      delta: "I will read the paper.",
    });
    state = reduceAgentTraceEvent(state, {
      type: "tool.started",
      toolCallId: "call-a",
      name: "paper_read",
      arguments: '{"question":"method"}',
    });
    state = reduceAgentTraceEvent(state, {
      type: "tool.completed",
      toolCallId: "call-a",
      name: "paper_read",
      result: "Evidence",
    });
    state = reduceAgentTraceEvent(state, {
      type: "content.delta",
      itemId: "response-b",
      phase: "candidate",
      delta: "Final answer",
    });

    const view = projectAgentTurnTrace(state);
    assert.isTrue(view.finalStarted);
    assert.equal(view.finalText, "Final answer");
    assert.deepEqual(
      view.trace.map((item) => item.type),
      ["reasoning", "commentary", "tool"],
    );
    assert.deepInclude(view.trace[2], {
      id: "call-a",
      type: "tool",
      status: "completed",
      result: "Evidence",
    });
  });

  it("uses authoritative completed snapshots", function () {
    let state = createAgentTurnTraceState();
    state = reduceAgentTraceEvent(state, {
      type: "content.delta",
      itemId: "answer",
      phase: "final_answer",
      delta: "Part",
    });
    state = reduceAgentTraceEvent(state, {
      type: "content.completed",
      itemId: "answer",
      phase: "final_answer",
      text: "Complete answer",
    });

    assert.equal(projectAgentTurnTrace(state).finalText, "Complete answer");
  });
});
