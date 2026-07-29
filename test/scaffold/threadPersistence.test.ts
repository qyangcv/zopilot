import { assert } from "chai";
import type { Thread } from "../../src/domain/thread";
import {
  MemoryThreadRepository,
  SqliteThreadRepository,
} from "../../src/runtime/persistence/threads/ThreadRepository";
import { ThreadStore } from "../../src/runtime/persistence/threads/ThreadService";

describe("thread persistence integration", function () {
  it("persists a submitted turn in the Gecko add-on sandbox", async function () {
    const repository = new MemoryThreadRepository();
    const store = new ThreadStore("/memory", repository, null);
    const conversation = await store.createWorkspaceConversation({
      workspaceKey: "library:1",
      workspaceType: "library",
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
    });

    const begun = await store.beginTurn(conversation.metadata, {
      assistantMessageId: "assistant-gecko",
      prompt: "Keep this message",
      execution: {
        backendId: "byok-test",
        backendKind: "openai-compatible",
        providerProfileId: "byok-test",
      },
    });

    assert.deepEqual(
      begun.conversation.messages.map((message) => message.text),
      ["Keep this message"],
    );
    assert.equal(
      repository.state.threads.get(conversation.metadata.id)?.turns[0]
        ?.userText,
      "Keep this message",
    );
  });

  it("persists through Gecko SQLite and rolls back a failed transaction", async function () {
    const root = PathUtils.join(
      PathUtils.tempDir,
      `zopilot-thread-test-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    );
    const databasePath = PathUtils.join(root, "threads.sqlite");
    await IOUtils.makeDirectory(root, {
      createAncestors: true,
      ignoreExisting: true,
    });
    const repository = new SqliteThreadRepository(databasePath);
    try {
      await repository.initialize();
      const thread = createThread();
      await repository.insertThread(thread);
      const appendedTurn = {
        ...thread.turns[0]!,
        id: "turn-2",
        sequence: 2,
        userMessageId: "user-2",
        assistantMessageId: "assistant-2",
        userText: "Follow-up question",
        assistantText: "Follow-up answer",
      };
      const appendedMetadata = {
        ...thread.metadata,
        revision: 2,
        updatedAt: "2026-07-29T00:01:00.000Z",
      };
      await repository.insertTurn(appendedMetadata, appendedTurn);
      assert.deepInclude(await repository.getThread(thread.metadata.id), {
        metadata: appendedMetadata,
      });

      const changedMetadata = {
        ...appendedMetadata,
        revision: 99,
        label: "Must roll back",
      };
      let failure: unknown;
      try {
        await repository.insertTurn(changedMetadata, {
          ...thread.turns[0]!,
          id: "duplicate-sequence",
        });
      } catch (error) {
        failure = error;
      }
      assert.exists(failure);

      const stored = await repository.getThread(thread.metadata.id);
      assert.equal(stored?.metadata.revision, appendedMetadata.revision);
      assert.equal(stored?.metadata.label, thread.metadata.label);
      assert.lengthOf(stored?.turns || [], 2);

      await repository.close();
      const reopened = new SqliteThreadRepository(databasePath);
      try {
        assert.equal(
          (await reopened.getThread(thread.metadata.id))?.turns[0]
            ?.assistantText,
          "Answer",
        );
      } finally {
        await reopened.close();
      }
    } finally {
      await repository.close().catch(() => undefined);
      await IOUtils.remove(root, { recursive: true }).catch(() => undefined);
    }
  });
});

function createThread(): Thread {
  const createdAt = "2026-07-29T00:00:00.000Z";
  return {
    metadata: {
      id: "thread-sqlite-test",
      scope: "workspace",
      workspaceKey: "library:1",
      workspaceType: "library",
      workspaceLabel: "Library",
      workspaceTitle: "Library",
      libraryID: 1,
      label: "SQLite test",
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      activeSources: [],
    },
    turns: [
      {
        id: "turn-1",
        threadId: "thread-sqlite-test",
        sequence: 1,
        status: "completed",
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
        userText: "Question",
        assistantText: "Answer",
        createdAt,
        completedAt: createdAt,
        context: {
          sources: [],
          selectedSources: [],
          noteContexts: [],
          localAttachments: [],
        },
        execution: {
          backendId: "byok-a",
          backendKind: "openai-compatible",
          providerProfileId: "byok-a",
        },
      },
    ],
    bindings: [],
  };
}
