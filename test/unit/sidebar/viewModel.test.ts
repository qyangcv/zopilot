import { assert } from "chai";
import {
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
} from "../../../src/features/sidebar/state/viewModel.ts";
import type { Conversation } from "../../../src/domain/conversation.ts";

describe("sidebar view model", function () {
  before(function () {
    installLocaleMock();
  });

  it("creates the initial disabled sidebar state", function () {
    const state = createInitialSidebarState("Paper");

    assert.equal(state.title, "Paper");
    assert.equal(state.backendStatus, "idle");
    assert.isFalse(state.composerEnabled);
    assert.equal(state.sessionsMode, "history");
    assert.deepEqual(state.messages, []);
    assert.deepEqual(state.models, []);
    assert.equal(state.selectedModel, "");
  });

  it("keeps empty conversations message-free for the UI empty state", function () {
    const messages = createConversationMessages({
      ...createConversation(),
      messages: [],
    });

    assert.deepEqual(messages, []);
  });

  it("formats saved messages without appending transient stream state", function () {
    const messages = createConversationMessages(createConversation());

    assert.deepEqual(
      messages.map((message) => message.id),
      ["msg-user", "msg-assistant"],
    );
    assert.equal(messages[1].completedAt, "2026-06-13 15:30");
    assert.equal(messages[1].responseDuration, "30min 0s");
  });

  it("uses the model catalog display name for saved answers", function () {
    const conversation = createConversation();
    conversation.messages[1].providerProfileId = "codex-cli.default";
    const models = [
      {
        slug: "gpt-5.3-codex",
        displayName: "GPT-5.3-Codex",
        providerProfileId: "codex-cli.default",
        providerLabel: "Codex CLI",
        supportedReasoningEfforts: [],
      },
    ];

    const messages = createConversationMessages(conversation, models);

    assert.equal(messages[1].model, "GPT-5.3-Codex");
  });

  it("formats response durations in minutes and seconds", function () {
    const conversation = createConversation();
    conversation.messages[1].completedAt = "2026-06-13T07:03:27.000Z";

    const messages = createConversationMessages(conversation);

    assert.equal(messages[1].responseDuration, "3min 27s");
  });

  it("formats responses shorter than one minute in seconds", function () {
    const conversation = createConversation();
    conversation.messages[1].completedAt = "2026-06-13T07:00:57.000Z";

    const messages = createConversationMessages(conversation);

    assert.equal(messages[1].responseDuration, "57s");
  });

  it("omits a response duration when the saved timestamps are invalid", function () {
    const conversation = createConversation();
    conversation.messages[1].completedAt = "not-a-timestamp";

    const messages = createConversationMessages(conversation);

    assert.isUndefined(messages[1].responseDuration);
  });

  it("keeps local attachments on user message views", function () {
    const messages = createConversationMessages(createConversation());

    assert.deepEqual(messages[0].localAttachments, [
      {
        id: "local-figure",
        path: "/tmp/figure.png",
        filename: "figure.png",
        kind: "image",
        mimeType: "image/png",
      },
    ]);
  });

  it("keeps source mentions on user message views", function () {
    const messages = createConversationMessages(createConversation());

    assert.deepEqual(messages[0].mentions, [
      {
        id: "mention-paper",
        sourceId: "source-paper",
        paperKey: "1:AAA",
        libraryID: 1,
        parentItemID: 10,
        parentItemKey: "AAA",
        attachmentItemID: 11,
        attachmentKey: "PDF",
        title: "CodeV: Code with Images",
      },
    ]);
  });

  it("creates compact session rows with active state", function () {
    const view = createSessionView(createConversation(), "conv-a");

    assert.equal(view.id, "conv-a");
    assert.equal(view.title, "Summarize the method section in two paragraphs.");
    assert.equal(view.meta, "2026-06-13T07:00:00.000Z");
    assert.isTrue(view.active);
  });

  it("omits paper mentions and attachments from session titles", function () {
    const conversation = createConversation();
    conversation.messages[0].text =
      "@CodeV: Code with Images @figure.png Compare their evidence.";

    const view = createSessionView(conversation);

    assert.equal(view.title, "Compare their evidence.");
  });

  it("does not restore a context-only mention from the metadata label", function () {
    const conversation = createConversation();
    conversation.messages[0].text = "@CodeV: Code with Images";
    conversation.metadata.label = "@CodeV: Code with Images";

    const view = createSessionView(conversation);

    assert.equal(view.title, "Use the selected context.");
  });

  it("uses the latest user message timestamp for session metadata", function () {
    const conversation = createConversation();
    conversation.messages.push({
      id: "msg-user-latest",
      conversationId: "conv-a",
      role: "user",
      text: "Follow up",
      createdAt: "2026-06-13T08:31:42.000Z",
      status: "complete",
    });

    const view = createSessionView(conversation);

    assert.equal(view.meta, "2026-06-13T08:31:42.000Z");
  });
});

function createConversation(): Conversation {
  return {
    metadata: {
      id: "conv-a",
      scope: "paper",
      paperKey: "1:AAA",
      libraryID: 1,
      parentItemKey: "AAA",
      attachmentItemID: 10,
      attachmentKey: "PDF",
      title: "Paper",
      label: "Session",
      createdAt: "2026-06-13T07:00:00.000Z",
      updatedAt: "2026-06-13T07:31:00.000Z",
      latestPreview: "A concise assistant preview",
    },
    messages: [
      {
        id: "msg-user",
        conversationId: "conv-a",
        role: "user",
        text: "Summarize the method section in two paragraphs.",
        createdAt: "2026-06-13T07:00:00.000Z",
        status: "complete",
        mentions: [
          {
            id: "mention-paper",
            sourceId: "source-paper",
            paperKey: "1:AAA",
            libraryID: 1,
            parentItemID: 10,
            parentItemKey: "AAA",
            attachmentItemID: 11,
            attachmentKey: "PDF",
            title: "CodeV: Code with Images",
          },
        ],
        localAttachments: [
          {
            id: "local-figure",
            path: "/tmp/figure.png",
            filename: "figure.png",
            kind: "image",
            mimeType: "image/png",
          },
        ],
      },
      {
        id: "msg-assistant",
        conversationId: "conv-a",
        role: "assistant",
        text: "Done",
        createdAt: "2026-06-13T07:29:00.000Z",
        completedAt: "2026-06-13T07:30:00.000Z",
        status: "complete",
        backendKind: "codex-cli",
        model: "gpt-5.3-codex",
      },
    ],
  };
}

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                messages: Array<{ id: string }>,
              ) => Array<{ value: string }>;
            };
          };
        };
      };
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}
