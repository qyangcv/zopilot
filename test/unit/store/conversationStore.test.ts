import { assert } from "chai";
import { createCapabilities } from "../../../src/domain/agent/capabilities.ts";
import {
  createItemWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
  type PaperIdentity,
  type SourceMention,
} from "../../../src/domain/conversation.ts";
import {
  CODEX_ADAPTER_KEY,
  ThreadStore,
} from "../../../src/runtime/persistence/threads/ThreadService.ts";
import { MemoryThreadRepository } from "../../../src/runtime/persistence/threads/ThreadRepository.ts";
import { createSourceId } from "../../../src/domain/sourceIdentity.ts";
import { cloneThread } from "../../../src/domain/thread.ts";

describe("ThreadStore", function () {
  it("creates one latest thread when two windows open a workspace together", async function () {
    const repository = new MemoryThreadRepository();
    const store = createStore(repository);
    const workspace = createLibraryWorkspaceIdentity({ libraryID: 1 });

    const [left, right] = await Promise.all([
      store.getOrCreateLatestWorkspaceConversation(workspace),
      store.getOrCreateLatestWorkspaceConversation(workspace),
    ]);

    assert.equal(left.metadata.id, right.metadata.id);
    assert.equal(repository.state.threads.size, 1);
  });

  it("clones thread state without relying on structuredClone", function () {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "structuredClone",
    );
    try {
      Object.defineProperty(globalThis, "structuredClone", {
        configurable: true,
        value: undefined,
      });
      const source = { nested: { values: ["a", "b"] } };
      const cloned = cloneThread(source);
      cloned.nested.values.push("c");
      assert.deepEqual(source.nested.values, ["a", "b"]);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "structuredClone", descriptor);
      } else {
        delete (globalThis as { structuredClone?: unknown }).structuredClone;
      }
    }
  });

  it("inherits accumulated paper context when a later turn has no mention", async function () {
    const store = createStore();
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1, label: "Library" }),
    );
    const paperA = createMention("PDF-A", "Paper A");
    const paperB = createMention("PDF-B", "Paper B");

    const first = await begin(store, conversation, {
      prompt: "Compare these",
      mentions: [paperA, paperB],
      availableSourceIds: [paperA.sourceId, paperB.sourceId],
    });
    await store.completeTurn(conversation.metadata.id, first.turn.id, {
      status: "completed",
      text: "First answer",
    });
    const latest = await store.getConversation(conversation.metadata.id);
    const second = await begin(store, latest!, {
      prompt: "What about the method?",
      availableSourceIds: [paperA.sourceId, paperB.sourceId],
    });

    assert.deepEqual(
      second.runInput.context.sources.map((source) => source.sourceId),
      [paperA.sourceId, paperB.sourceId],
    );
    assert.equal(second.runInput.context.primarySourceId, paperB.sourceId);
    assert.deepEqual(second.runInput.history, [
      {
        sequence: 1,
        userText: "Compare these",
        assistantText: "First answer",
        status: "completed",
      },
    ]);
  });

  it("deduplicates selections and switches the primary source", async function () {
    const store = createStore();
    const workspace = createItemWorkspaceIdentity(createPaper("PDF-A", "A"));
    const conversation = await store.createWorkspaceConversation(workspace);
    const paperA = createMention("PDF-A", "A");
    const paperB = createMention("PDF-B", "B");

    const first = await begin(store, conversation, {
      prompt: "Add both",
      mentions: [paperB, paperA, paperB],
      availableSourceIds: [paperA.sourceId, paperB.sourceId],
    });
    assert.deepEqual(
      first.conversation.metadata.activeSources.map(
        (source) => source.sourceId,
      ),
      [paperB.sourceId, paperA.sourceId],
    );
    assert.equal(first.conversation.metadata.primarySourceId, paperB.sourceId);
    const stopped = await store.failTurn(
      conversation.metadata.id,
      first.turn.id,
      {
        text: "Stopped",
        interrupted: true,
        errorCode: "interrupted",
        errorMessage: "Stopped",
      },
    );
    const second = await begin(store, stopped, {
      prompt: "Focus A",
      mentions: [paperA],
      availableSourceIds: [paperA.sourceId, paperB.sourceId],
    });
    assert.deepEqual(
      second.conversation.metadata.activeSources.map(
        (source) => source.sourceId,
      ),
      [paperB.sourceId, paperA.sourceId],
    );
    assert.equal(second.conversation.metadata.primarySourceId, paperA.sourceId);
    await store.failTurn(conversation.metadata.id, second.turn.id, {
      text: "Stopped",
      interrupted: true,
      errorCode: "interrupted",
      errorMessage: "Stopped",
    });
  });

  it("retains unavailable sources in the thread but excludes them from a turn", async function () {
    const store = createStore();
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const available = createMention("PDF-A", "Available");
    const missing = createMention("PDF-B", "Missing");
    const begun = await begin(store, conversation, {
      prompt: "Inspect both",
      mentions: [available, missing],
      availableSourceIds: [available.sourceId],
    });

    assert.deepEqual(
      begun.conversation.metadata.activeSources.map((source) => [
        source.sourceId,
        source.availability,
      ]),
      [
        [available.sourceId, "available"],
        [missing.sourceId, "unavailable"],
      ],
    );
    assert.deepEqual(
      begun.runInput.context.sources.map((source) => source.sourceId),
      [available.sourceId],
    );
  });

  it("rejects two active turns in one thread while allowing other threads", async function () {
    const store = createStore();
    const workspace = createLibraryWorkspaceIdentity({ libraryID: 1 });
    const firstThread = await store.createWorkspaceConversation(workspace);
    const secondThread = await store.createWorkspaceConversation(workspace);

    const sameThread = await Promise.allSettled([
      begin(store, firstThread, { prompt: "One" }),
      begin(store, firstThread, { prompt: "Two" }),
    ]);
    assert.equal(
      sameThread.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      sameThread.filter((result) => result.status === "rejected").length,
      1,
    );
    const other = await begin(store, secondThread, { prompt: "Other" });
    assert.equal(other.turn.status, "pending");
  });

  it("preserves canonical history and Codex checkpoint across provider switches", async function () {
    const store = createStore();
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const codex = await begin(store, conversation, {
      prompt: "Codex question",
      backendKind: "codex-cli",
      providerProfileId: "codex-cli.default",
    });
    await store.completeTurn(conversation.metadata.id, codex.turn.id, {
      status: "completed",
      text: "Codex answer",
      checkpoint: {
        adapterKey: CODEX_ADAPTER_KEY,
        externalThreadId: "codex-thread",
        syncedThroughSequence: 1,
        state: "clean",
      },
    });

    const afterCodex = await store.getConversation(conversation.metadata.id);
    const byok = await begin(store, afterCodex!, {
      prompt: "BYOK question",
      providerProfileId: "byok-a",
    });
    assert.isUndefined(byok.runInput.binding);
    assert.deepEqual(
      byok.runInput.history.map((item) => item.userText),
      ["Codex question"],
    );
    await store.completeTurn(conversation.metadata.id, byok.turn.id, {
      status: "completed",
      text: "BYOK answer",
    });

    const afterByok = await store.getConversation(conversation.metadata.id);
    const resumed = await begin(store, afterByok!, {
      prompt: "Back to Codex",
      backendKind: "codex-cli",
      providerProfileId: "codex-cli.default",
    });
    assert.equal(resumed.runInput.binding?.externalThreadId, "codex-thread");
    assert.deepEqual(
      resumed.runInput.history.map((item) => item.sequence),
      [1, 2],
    );
  });

  it("trims BYOK history by complete turns without dropping active papers", async function () {
    const store = createStore();
    let conversation = await store.createWorkspaceConversation(
      createItemWorkspaceIdentity(createPaper("PDF-A", "Paper A")),
    );
    for (let index = 1; index <= 2; index += 1) {
      const begun = await begin(store, conversation, {
        prompt: `Question ${index} ${"x".repeat(120)}`,
      });
      conversation = await store.completeTurn(
        conversation.metadata.id,
        begun.turn.id,
        {
          status: "completed",
          text: `Answer ${index} ${"y".repeat(120)}`,
        },
      );
    }

    const trimmed = await begin(store, conversation, {
      prompt: "Current",
      contextLength: 80,
    });
    assert.deepEqual(trimmed.runInput.history, []);
    assert.lengthOf(trimmed.runInput.context.sources, 1);
    assert.equal(trimmed.runInput.context.sources[0]?.attachmentKey, "PDF-A");
  });

  it("recovers pending and running BYOK turns without resending them", async function () {
    const repository = new MemoryThreadRepository();
    const store = createStore(repository);
    const first = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const pending = await begin(store, first, { prompt: "Pending" });
    const second = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const running = await begin(store, second, { prompt: "Running" });
    await store.markTurnRunning(
      second.metadata.id,
      running.turn.id,
      "byok-run",
    );
    await store.persistTurnSnapshot(
      second.metadata.id,
      running.turn.id,
      "Partial",
    );

    const restarted = createStore(repository);
    await restarted.recoverInFlightTurns();
    const recoveredPending = repository.state.threads
      .get(first.metadata.id)!
      .turns.find((turn) => turn.id === pending.turn.id)!;
    const recoveredRunning = repository.state.threads
      .get(second.metadata.id)!
      .turns.find((turn) => turn.id === running.turn.id)!;
    assert.equal(recoveredPending.status, "failed");
    assert.equal(recoveredPending.error?.code, "provider_not_started");
    assert.equal(recoveredRunning.status, "interrupted");
    assert.equal(recoveredRunning.assistantText, "Partial");
  });

  it("reconciles a completed Codex turn after restart", async function () {
    const repository = new MemoryThreadRepository();
    const store = createStore(repository);
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const begun = await begin(store, conversation, {
      prompt: "Remote question",
      backendKind: "codex-cli",
      providerProfileId: "codex-cli.default",
    });
    await store.saveCheckpoint(conversation.metadata.id, {
      adapterKey: CODEX_ADAPTER_KEY,
      externalThreadId: "codex-thread",
      syncedThroughSequence: 0,
      state: "clean",
    });
    await store.markTurnRunning(
      conversation.metadata.id,
      begun.turn.id,
      "codex-thread",
      "codex-turn",
    );

    const restarted = createStore(repository);
    await restarted.recoverInFlightTurns({
      readCodexTurn: async (binding, turn) => {
        assert.equal(binding.externalThreadId, "codex-thread");
        assert.equal(turn.execution.providerTurnId, "codex-turn");
        return { status: "completed", text: "Recovered answer" };
      },
    });

    const thread = repository.state.threads.get(conversation.metadata.id)!;
    assert.equal(thread.turns[0]?.status, "completed");
    assert.equal(thread.turns[0]?.assistantText, "Recovered answer");
    assert.equal(thread.bindings[0]?.syncedThroughSequence, 1);
    assert.equal(thread.bindings[0]?.state, "clean");
  });

  it("interrupts an unverifiable Codex turn and dirties its binding", async function () {
    const repository = new MemoryThreadRepository();
    const store = createStore(repository);
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const begun = await begin(store, conversation, {
      prompt: "Unknown remote state",
      backendKind: "codex-cli",
      providerProfileId: "codex-cli.default",
    });
    await store.saveCheckpoint(conversation.metadata.id, {
      adapterKey: CODEX_ADAPTER_KEY,
      externalThreadId: "codex-thread",
      syncedThroughSequence: 0,
      state: "clean",
    });
    await store.markTurnRunning(
      conversation.metadata.id,
      begun.turn.id,
      "codex-thread",
      "codex-turn",
    );
    await store.persistTurnSnapshot(
      conversation.metadata.id,
      begun.turn.id,
      "Partial answer",
    );

    const restarted = createStore(repository);
    await restarted.recoverInFlightTurns({
      readCodexTurn: async () => ({ status: "unknown" }),
    });

    const thread = repository.state.threads.get(conversation.metadata.id)!;
    assert.equal(thread.turns[0]?.status, "interrupted");
    assert.equal(thread.turns[0]?.assistantText, "Partial answer");
    assert.equal(thread.bindings[0]?.state, "dirty");
    assert.equal(thread.bindings[0]?.syncedThroughSequence, 0);
  });

  it("projects completed history when switching between BYOK providers", async function () {
    const store = createStore();
    const conversation = await store.createWorkspaceConversation(
      createLibraryWorkspaceIdentity({ libraryID: 1 }),
    );
    const first = await begin(store, conversation, {
      prompt: "Question for A",
      providerProfileId: "byok-a",
    });
    const completed = await store.completeTurn(
      conversation.metadata.id,
      first.turn.id,
      {
        status: "completed",
        text: "Answer from A",
      },
    );

    const second = await begin(store, completed, {
      prompt: "Question for B",
      providerProfileId: "byok-b",
    });

    assert.equal(second.runInput.providerProfileId, "byok-b");
    assert.deepEqual(second.runInput.history, [
      {
        sequence: 1,
        userText: "Question for A",
        assistantText: "Answer from A",
        status: "completed",
      },
    ]);
  });

  it("imports legacy messages idempotently and retains an incomplete user turn", async function () {
    const repository = new MemoryThreadRepository();
    const metadata = {
      id: "legacy-thread",
      scope: "workspace" as const,
      workspaceKey: "library:1",
      workspaceType: "library" as const,
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
      label: "Legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      codexThreadId: "legacy-codex",
    };
    const reader = {
      readAll: async () => [
        {
          key: "legacy.json",
          status: "ready" as const,
          conversation: {
            metadata,
            messages: [
              {
                ...legacyMessage("user-1", "user", "Question"),
                mentions: [
                  {
                    ...createMention("PDF-A", "Paper A"),
                    sourceId: "legacy-root-item-id",
                  },
                ],
              },
              legacyMessage("assistant-1", "assistant", "Answer"),
              {
                ...legacyMessage("user-2", "user", "Orphan"),
                mentions: [createMention("PDF-B", "Paper B")],
              },
            ],
          },
        },
      ],
    };

    const store = new ThreadStore("/memory", repository, reader);
    await store.initialize();
    const thread = repository.state.threads.get(metadata.id)!;
    assert.deepEqual(
      thread.turns.map((turn) => turn.status),
      ["completed", "failed"],
    );
    assert.equal(thread.turns[1]?.error?.code, "legacy_incomplete_turn");
    assert.equal(thread.bindings[0]?.externalThreadId, "legacy-codex");
    assert.equal(thread.bindings[0]?.state, "dirty");
    assert.deepEqual(
      thread.metadata.activeSources.map((source) => source.sourceId),
      ["1-PDF-A", "1-PDF-B"],
    );
    assert.equal(thread.metadata.primarySourceId, "1-PDF-B");

    const restarted = new ThreadStore("/memory", repository, reader);
    await restarted.initialize();
    assert.equal(repository.state.threads.size, 1);
    assert.equal(repository.state.threads.get(metadata.id)?.turns.length, 2);
  });

  it("isolates a corrupt legacy conversation from valid imports", async function () {
    const repository = new MemoryThreadRepository();
    const metadata = {
      id: "legacy-valid",
      scope: "workspace" as const,
      workspaceKey: "library:1",
      workspaceType: "library" as const,
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
      label: "Legacy",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const reader = {
      readAll: async () => [
        {
          key: "corrupt.json",
          status: "failed" as const,
          error: new Error("invalid JSON"),
        },
        {
          key: "valid.json",
          status: "ready" as const,
          conversation: {
            metadata,
            messages: [
              legacyMessage("user-1", "user", "Question"),
              legacyMessage("assistant-1", "assistant", "Answer"),
            ],
          },
        },
      ],
    };

    const store = new ThreadStore("/memory", repository, reader);
    await store.initialize();

    assert.isTrue(repository.state.threads.has(metadata.id));
    assert.equal(
      await repository.getLegacyImportStatus("corrupt.json"),
      "failed",
    );
    assert.equal(
      await repository.getLegacyImportStatus("valid.json"),
      "imported",
    );
  });

  it("retries a failed legacy import after the cause is fixed", async function () {
    const repository = new MemoryThreadRepository();
    const metadata = {
      id: "legacy-retry",
      scope: "workspace" as const,
      workspaceKey: "library:1",
      workspaceType: "library" as const,
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
      label: "Retry",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    let ready = false;
    const reader = {
      readAll: async () => [
        ready
          ? {
              key: "retry.json",
              status: "ready" as const,
              conversation: {
                metadata,
                messages: [
                  legacyMessage("user-1", "user", "Question"),
                  legacyMessage("assistant-1", "assistant", "Answer"),
                ],
              },
            }
          : {
              key: "retry.json",
              status: "failed" as const,
              error: new Error("temporary migration failure"),
            },
      ],
    };

    await new ThreadStore("/memory", repository, reader).initialize();
    assert.equal(
      await repository.getLegacyImportStatus("retry.json"),
      "failed",
    );
    assert.isFalse(repository.state.threads.has(metadata.id));

    ready = true;
    await new ThreadStore("/memory", repository, reader).initialize();
    assert.equal(
      await repository.getLegacyImportStatus("retry.json"),
      "imported",
    );
    assert.equal(repository.state.threads.get(metadata.id)?.turns.length, 1);
  });
});

function createStore(repository = new MemoryThreadRepository()): ThreadStore {
  return new ThreadStore("/memory", repository, null);
}

async function begin(
  store: ThreadStore,
  conversation: Awaited<ReturnType<ThreadStore["getConversation"]>> & {},
  overrides: {
    prompt: string;
    mentions?: SourceMention[];
    availableSourceIds?: string[];
    backendKind?: "codex-cli" | "openai-compatible";
    providerProfileId?: string;
    contextLength?: number;
  },
) {
  const backendKind = overrides.backendKind || "openai-compatible";
  const providerProfileId = overrides.providerProfileId || "byok-a";
  return store.beginTurn(conversation.metadata, {
    assistantMessageId: `assistant-${overrides.prompt}`,
    prompt: overrides.prompt,
    mentions: overrides.mentions,
    availableSourceIds: overrides.availableSourceIds,
    execution: {
      backendId: providerProfileId,
      backendKind,
      providerProfileId,
      capabilitySnapshot: createCapabilities(
        backendKind === "codex-cli" ? "codex" : "openai",
      ),
    },
    contextLength: overrides.contextLength,
  });
}

function createPaper(attachmentKey: string, title: string): PaperIdentity {
  return {
    paperKey: `1:${attachmentKey}`,
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: `ITEM-${attachmentKey}`,
    attachmentItemID: attachmentKey === "PDF-A" ? 11 : 12,
    attachmentKey,
    title,
  };
}

function createMention(attachmentKey: string, title: string): SourceMention {
  const paper = createPaper(attachmentKey, title);
  return {
    id: `mention-${attachmentKey}`,
    sourceId: createSourceId(1, attachmentKey),
    ...paper,
  };
}

function legacyMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    conversationId: "legacy-thread",
    role,
    text,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "complete" as const,
    backendKind: "codex-cli" as const,
  };
}
