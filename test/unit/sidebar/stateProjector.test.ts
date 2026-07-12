import { assert } from "chai";
import type { Conversation } from "../../../src/domain/conversation.ts";
import { createInitialSidebarState } from "../../../src/features/sidebar/state/viewModel.ts";
import { projectSidebarState } from "../../../src/features/sidebar/state/projectSidebarState.ts";
import {
  createAgentTurnTraceState,
  reduceAgentTraceEvent,
} from "../../../src/domain/agent/trace.ts";

describe("sidebar state projector", function () {
  before(function () {
    installLocaleMock();
    (globalThis as typeof globalThis & { Zotero: unknown }).Zotero = {
      Prefs: { get: () => "[]" },
    };
  });

  it("projects a ready conversation and its running turn without host mutation", function () {
    const conversation = createConversation();
    const viewState = createInitialSidebarState("Paper");
    const traceState = reduceAgentTraceEvent(createAgentTurnTraceState(), {
      type: "content.delta",
      itemId: "answer",
      phase: "candidate",
      delta: "Partial answer",
    });
    const runningTurn = {
      conversation,
      traceState,
      interrupting: false,
      interrupted: false,
    };
    const patch = projectSidebarState({
      displayState: {
        kind: "ready",
        token: 1,
        hostContext: { kind: "reader", tabID: "tab-1", itemID: 11 },
        reader: { itemID: 11 } as _ZoteroTypes.ReaderInstance<"pdf">,
        workspace: conversation.metadata,
        conversation,
      },
      viewState,
      runningTurns: new Map([[conversation.metadata.id, runningTurn]]),
      getClosedLabel: () => "Unused",
    });

    assert.equal(patch.title, "Paper / Question");
    assert.equal(patch.context?.workspaceKey, "item:1:ITEM");
    assert.equal(patch.context?.hostContextKind, "reader");
    assert.isTrue(patch.busy);
    assert.equal(patch.messages?.at(-1)?.text, "Partial answer");
  });
});

function createConversation(): Conversation {
  const metadata = {
    id: "conv-projector",
    scope: "workspace" as const,
    workspaceKey: "item:1:ITEM",
    workspaceType: "item" as const,
    workspaceLabel: "Paper",
    workspaceTitle: "Paper",
    libraryID: 1,
    itemKey: "ITEM",
    defaultSource: {
      paperKey: "1:ITEM",
      libraryID: 1,
      parentItemID: 10,
      parentItemKey: "ITEM",
      attachmentItemID: 11,
      attachmentKey: "PDF",
      title: "Paper",
    },
    label: "Question",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
  return { metadata, messages: [] };
}

function installLocaleMock(): void {
  (globalThis as typeof globalThis & { addon: unknown }).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages: Array<{ id: string }>) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}
