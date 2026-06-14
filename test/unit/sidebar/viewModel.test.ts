import { assert } from "chai";
import {
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
} from "../../../src/modules/sidebar/viewModel.ts";
import type { Conversation } from "../../../src/shared/conversation.ts";

describe("sidebar view model", function () {
  before(function () {
    installLocaleMock();
  });

  it("creates the initial disabled sidebar state", function () {
    const state = createInitialSidebarState("Paper");

    assert.equal(state.title, "Paper");
    assert.equal(state.codexStatus, "checking");
    assert.isFalse(state.composerEnabled);
    assert.deepEqual(
      state.messages.map((message) => message.id),
      ["zp-welcome-message"],
    );
  });

  it("formats saved messages and appends the active streaming message", function () {
    const messages = createConversationMessages(createConversation(), {
      text: "Partial",
      interrupted: false,
      running: true,
    });

    assert.deepEqual(
      messages.map((message) => message.id),
      ["msg-user", "msg-assistant", "zp-streaming-assistant-conv-a"],
    );
    assert.equal(messages[1].completedAt, "2026-06-13 15:30");
    assert.deepInclude(messages[2], {
      role: "assistant",
      text: "Partial",
      status: "complete",
      transient: true,
      running: true,
    });
  });

  it("creates compact session rows with active state", function () {
    const view = createSessionView(createConversation(), "conv-a");

    assert.equal(view.id, "conv-a");
    assert.equal(view.title, "Summarize the method section in two paragraphs.");
    assert.equal(view.meta, "A concise assistant preview");
    assert.isTrue(view.active);
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
      },
      {
        id: "msg-assistant",
        conversationId: "conv-a",
        role: "assistant",
        text: "Done",
        createdAt: "2026-06-13T07:29:00.000Z",
        completedAt: "2026-06-13T07:30:00.000Z",
        status: "complete",
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
