import { assert } from "chai";
import { SidebarSessionCoordinator } from "../../../src/modules/sidebar/sessionCoordinator.ts";
import { createItemWorkspaceIdentity } from "../../../src/shared/conversation.ts";
import type { Conversation } from "../../../src/shared/conversation.ts";
import type {
  SidebarReadyDisplayState,
  SidebarSessionCoordinatorOptions,
} from "../../../src/modules/sidebar/sessionCoordinator.ts";
import type { SidebarState } from "../../../src/modules/sidebar/app/types.ts";
import { createInitialSidebarState } from "../../../src/modules/sidebar/viewModel.ts";

describe("sidebar session coordinator", function () {
  before(function () {
    installLocaleMock();
  });

  it("shows workspace sessions with the active conversation marked", async function () {
    const active = createConversation("conv-a", "Question A");
    const inactive = createConversation("conv-b", "Question B");
    const harness = createHarness({
      readyConversation: active,
      conversations: [active, inactive],
    });

    await harness.coordinator.showPopover();

    assert.isTrue(harness.state.sessionsOpen);
    assert.equal(harness.state.sessionsMode, "history");
    assert.deepEqual(
      harness.state.sessions.map((session) => ({
        id: session.id,
        active: session.active,
      })),
      [
        { id: "conv-a", active: true },
        { id: "conv-b", active: false },
      ],
    );
  });

  it("archives the active session, selects the next conversation, and refreshes history", async function () {
    const active = createConversation("conv-a", "Question A");
    const next = createConversation("conv-b", "Question B");
    const archivedIds: string[] = [];
    const harness = createHarness({
      readyConversation: active,
      conversations: [next],
      latestConversation: next,
      onArchive(conversation) {
        archivedIds.push(conversation.metadata.id);
      },
    });

    await harness.coordinator.archiveSession(active);

    assert.deepEqual(harness.interruptedConversationIds, ["conv-a"]);
    assert.deepEqual(archivedIds, ["conv-a"]);
    assert.equal(harness.ready?.conversation.metadata.id, "conv-b");
    assert.isTrue(harness.state.sessionsOpen);
    assert.deepEqual(
      harness.state.sessions.map((session) => ({
        id: session.id,
        active: session.active,
      })),
      [{ id: "conv-b", active: true }],
    );
  });
});

function createHarness({
  readyConversation,
  conversations = [],
  archivedConversations = [],
  latestConversation = null,
  onArchive,
}: {
  readyConversation: Conversation;
  conversations?: Conversation[];
  archivedConversations?: Conversation[];
  latestConversation?: Conversation | null;
  onArchive?: (conversation: Conversation) => void;
}) {
  let state: SidebarState = createInitialSidebarState("Paper");
  let ready: SidebarReadyDisplayState | undefined = {
    kind: "ready",
    token: 1,
    reader: {
      itemID: 11,
      tabID: "tab-a",
      type: "pdf",
    } as _ZoteroTypes.ReaderInstance<"pdf">,
    workspace: createWorkspace(),
    conversation: readyConversation,
  };
  const interruptedConversationIds: string[] = [];
  const store: NonNullable<SidebarSessionCoordinatorOptions["store"]> = {
    async listWorkspaceConversations() {
      return conversations;
    },
    async listArchivedWorkspaceConversations() {
      return archivedConversations;
    },
    async createWorkspaceConversation(workspace) {
      return createConversation("conv-created", workspace.workspaceLabel);
    },
    async activateWorkspaceConversation(metadata) {
      return conversations.find((item) => item.metadata.id === metadata.id)!;
    },
    async archiveWorkspaceConversation(metadata) {
      onArchive?.(createConversation(metadata.id, metadata.label));
    },
    async restoreWorkspaceConversation(metadata) {
      return {
        ...metadata,
        archivedAt: undefined,
      };
    },
    async getLatestWorkspaceConversation() {
      return latestConversation;
    },
  };
  const coordinator = new SidebarSessionCoordinator({
    getReadyDisplayState: () => ready,
    getReadyStateForSelectedReader: async () => ready,
    getViewState: () => state,
    updateViewState(patch) {
      state = {
        ...state,
        ...patch,
      };
    },
    setReadyConversation(conversation) {
      if (ready) {
        ready = {
          ...ready,
          conversation,
        };
      }
    },
    focusComposer() {
      state = {
        ...state,
        focusToken: state.focusToken + 1,
      };
    },
    interruptConversationTurn(conversationId) {
      interruptedConversationIds.push(conversationId);
    },
    isDestroyed: () => false,
    isOpen: () => true,
    store,
  });

  return {
    coordinator,
    interruptedConversationIds,
    get ready() {
      return ready;
    },
    get state() {
      return state;
    },
  };
}

function createWorkspace() {
  return createItemWorkspaceIdentity({
    paperKey: "1:AAA",
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: "AAA",
    attachmentItemID: 11,
    attachmentKey: "PDF",
    title: "Paper",
  });
}

function createConversation(id: string, label: string): Conversation {
  const workspace = createWorkspace();
  return {
    metadata: {
      ...workspace,
      id,
      scope: "workspace",
      label,
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:01:00.000Z",
    },
    messages: [
      {
        id: `${id}-user`,
        conversationId: id,
        role: "user",
        text: label,
        createdAt: "2026-06-16T00:00:01.000Z",
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
