import { assert } from "chai";
import type {
  ProviderCheckpoint,
  ThreadRunInput,
} from "../../../src/domain/thread.ts";
import { CodexThreadManager } from "../../../src/integrations/codex/CodexThreadManager.ts";
import type { JsonValue } from "../../../src/runtime/json/types.ts";

describe("CodexThreadManager", function () {
  it("resumes a clean binding and injects only unsynchronized turns", async function () {
    const requests: Array<{ method: string; params?: JsonValue }> = [];
    const checkpoints: ProviderCheckpoint[] = [];
    const manager = createManager(async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/resume") {
        return { thread: { id: "external-a" } };
      }
      return {};
    });

    const opened = await manager.ensure(
      createRun({
        binding: {
          threadId: "thread-a",
          adapterKey: "codex-cli",
          externalThreadId: "external-a",
          syncedThroughSequence: 1,
          state: "clean",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      async (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    );

    assert.deepEqual(
      requests.map((request) => request.method),
      ["thread/resume", "thread/inject_items"],
    );
    assert.deepNestedInclude(requests[1]?.params as object, {
      threadId: "external-a",
    });
    assert.deepEqual((requests[1]?.params as { items: unknown[] }).items, [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Question 2" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Answer 2" }],
      },
    ]);
    assert.equal(opened.checkpoint.syncedThroughSequence, 2);
    assert.deepEqual(
      checkpoints.map((checkpoint) => checkpoint.syncedThroughSequence),
      [2],
    );
  });

  it("persists a replacement id before rebuilding all canonical history", async function () {
    const requests: Array<{ method: string; params?: JsonValue }> = [];
    const checkpoints: ProviderCheckpoint[] = [];
    const manager = createManager(async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/resume") throw new Error("thread missing");
      if (method === "thread/start") {
        return { thread: { id: "replacement-a" } };
      }
      return {};
    });

    const opened = await manager.ensure(
      createRun({
        binding: {
          threadId: "thread-a",
          adapterKey: "codex-cli",
          externalThreadId: "lost-thread",
          syncedThroughSequence: 1,
          state: "clean",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      async (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    );

    assert.deepEqual(
      requests.map((request) => request.method),
      ["thread/resume", "thread/start", "thread/inject_items"],
    );
    assert.deepEqual(
      checkpoints.map((checkpoint) => [
        checkpoint.externalThreadId,
        checkpoint.syncedThroughSequence,
      ]),
      [
        ["replacement-a", 0],
        ["replacement-a", 2],
      ],
    );
    assert.equal(opened.threadId, "replacement-a");
  });

  it("does not advance the synchronization cursor when injection fails", async function () {
    const checkpoints: ProviderCheckpoint[] = [];
    const manager = createManager(async (method) => {
      if (method === "thread/start") {
        return { thread: { id: "replacement-a" } };
      }
      if (method === "thread/inject_items") {
        throw new Error("inject failed");
      }
      return {};
    });

    let error: unknown;
    try {
      await manager.ensure(createRun(), async (checkpoint) => {
        checkpoints.push(checkpoint);
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal((error as Error | undefined)?.message, "inject failed");
    assert.deepEqual(
      checkpoints.map((checkpoint) => checkpoint.syncedThroughSequence),
      [0],
    );
  });
});

function createManager(
  request: (
    method: string,
    params?: JsonValue,
  ) => Promise<JsonValue | undefined>,
): CodexThreadManager {
  return new CodexThreadManager({
    start: async () => undefined,
    request,
    getCwd: () => undefined,
    buildMcpServersConfig: async () => ({}),
  });
}

function createRun(
  overrides: Partial<Pick<ThreadRunInput, "binding">> = {},
): ThreadRunInput {
  return {
    threadId: "thread-a",
    turnId: "turn-3",
    sequence: 3,
    prompt: "Question 3",
    history: [
      {
        sequence: 1,
        userText: "Question 1",
        assistantText: "Answer 1",
        status: "completed",
      },
      {
        sequence: 2,
        userText: "Question 2",
        assistantText: "Answer 2",
        status: "completed",
      },
    ],
    context: {
      sources: [],
      selectedSources: [],
      noteContexts: [],
      localAttachments: [],
    },
    workspace: {
      id: "thread-a",
      workspaceKey: "library:1",
      workspaceType: "library",
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
    },
    providerProfileId: "codex-cli.default",
    ...overrides,
  };
}
