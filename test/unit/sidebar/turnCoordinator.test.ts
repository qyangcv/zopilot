import { assert } from "chai";
import type { Conversation } from "../../../src/domain/conversation.ts";
import { RunningTurnStore } from "../../../src/features/sidebar/chat/RunningTurnStore.ts";
import { TurnCoordinator } from "../../../src/features/sidebar/chat/TurnCoordinator.ts";
import { createInitialSidebarState } from "../../../src/features/sidebar/state/viewModel.ts";

describe("sidebar turn coordinator", function () {
  it("marks a completed background conversation as unread", function () {
    const turnStore = new RunningTurnStore();
    const conversation = createConversation("conv-background");
    const unreadConversationIds: string[] = [];
    let refreshed = false;
    turnStore.create({
      conversationId: conversation.metadata.id,
      messageId: "assistant-1",
    });
    turnStore.apply(conversation.metadata.id, {
      type: "turn.completed",
      sequence: 1,
      text: "Done",
    });
    const coordinator = new TurnCoordinator({
      turnStore,
      streamScheduler: {
        clear() {},
      } as never,
      getViewState: () => createInitialSidebarState("Paper"),
      getReadyConversation: async () => undefined,
      getActiveConversationId: () => "conv-active",
      ensurePromptReady: async () => true,
      clearPromptNotice() {},
      setReadyConversation() {},
      updateViewState() {},
      refreshBackendDiagnostic: async () => undefined,
      markBackendHealthy() {},
      markConversationUnread: (conversationId) =>
        unreadConversationIds.push(conversationId),
      refreshSessions: () => {
        refreshed = true;
      },
      areSessionsOpen: () => true,
    });

    (
      coordinator as unknown as {
        finish(conversationId: string, value: Conversation): void;
      }
    ).finish(conversation.metadata.id, conversation);

    assert.isFalse(turnStore.has(conversation.metadata.id));
    assert.deepEqual(unreadConversationIds, [conversation.metadata.id]);
    assert.isTrue(refreshed);
  });

  it("does not mark the active conversation as unread", function () {
    const turnStore = new RunningTurnStore();
    const conversation = createConversation("conv-active");
    const unreadConversationIds: string[] = [];
    let selectedConversation: Conversation | undefined;
    turnStore.create({
      conversationId: conversation.metadata.id,
      messageId: "assistant-1",
    });
    turnStore.apply(conversation.metadata.id, {
      type: "turn.completed",
      sequence: 1,
      text: "Done",
    });
    const coordinator = new TurnCoordinator({
      turnStore,
      streamScheduler: {
        clear() {},
      } as never,
      getViewState: () => createInitialSidebarState("Paper"),
      getReadyConversation: async () => conversation,
      getActiveConversationId: () => conversation.metadata.id,
      ensurePromptReady: async () => true,
      clearPromptNotice() {},
      setReadyConversation: (value) => {
        selectedConversation = value;
      },
      updateViewState() {},
      refreshBackendDiagnostic: async () => undefined,
      markBackendHealthy() {},
      markConversationUnread: (conversationId) =>
        unreadConversationIds.push(conversationId),
      refreshSessions() {},
      areSessionsOpen: () => false,
    });

    (
      coordinator as unknown as {
        finish(conversationId: string, value: Conversation): void;
      }
    ).finish(conversation.metadata.id, conversation);

    assert.deepEqual(unreadConversationIds, []);
    assert.equal(selectedConversation, conversation);
  });
});

function createConversation(id: string): Conversation {
  return {
    metadata: {
      id,
      scope: "workspace",
      workspaceKey: "item:1:ITEM",
      workspaceType: "item",
      workspaceLabel: "Paper",
      workspaceTitle: "Paper",
      libraryID: 1,
      itemKey: "ITEM",
      label: "Question",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:01:00.000Z",
    },
    messages: [],
  };
}
