import { assert } from "chai";
import { SidebarStreamSnapshotStore } from "../../../src/features/sidebar/ui/SidebarStreamSnapshotStore.ts";
import type { SidebarStreamingSnapshot } from "../../../src/features/sidebar/ui/types.ts";

describe("sidebar stream snapshot store", function () {
  it("reuses unchanged block objects by id and revision", function () {
    const store = new SidebarStreamSnapshotStore();
    const first = createSnapshot(1, 1, "A");
    store.publish(first);
    const firstPublished = store.getSnapshot()!;

    store.publish(createSnapshot(2, 1, "A"));
    const clockOnly = store.getSnapshot()!;
    assert.strictEqual(
      clockOnly.answerBlocks[0],
      firstPublished.answerBlocks[0],
    );
    assert.strictEqual(clockOnly.traceBlocks, firstPublished.traceBlocks);

    store.publish(createSnapshot(3, 2, "AB"));
    const changed = store.getSnapshot()!;
    assert.notStrictEqual(changed.answerBlocks[0], clockOnly.answerBlocks[0]);
    assert.strictEqual(changed.traceBlocks, clockOnly.traceBlocks);
  });
});

function createSnapshot(
  publicationVersion: number,
  revision: number,
  text: string,
): SidebarStreamingSnapshot {
  return {
    conversationId: "conv-a",
    messageId: "assistant-a",
    lifecycle: "running",
    stateVersion: revision,
    sequence: revision,
    publicationVersion,
    publishedAt: publicationVersion * 50,
    finalStarted: true,
    answerBlocks: [
      {
        id: "answer",
        type: "content",
        phase: "final_answer",
        text,
        revision,
      },
    ],
    traceBlocks: [],
    hasRunningTools: false,
  };
}
