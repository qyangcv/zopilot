import { getString } from "../../../app/localization";
import type { SidebarMessageView, SidebarState } from "../ui/types";
import { loadPromptViews } from "../prompts/promptStore";
import { createConversationMessages, createSessionView } from "./viewModel";
import type { SidebarDisplayState } from "../workspace/WorkspaceCoordinator";

type SidebarStateProjectionInput = {
  displayState: SidebarDisplayState;
  viewState: SidebarState;
  busy: boolean;
  pdfHelperNotice?: {
    conversationId: string;
    message: SidebarMessageView;
  };
  getClosedLabel: () => string;
};

function projectSidebarState(
  input: SidebarStateProjectionInput,
): Partial<SidebarState> {
  const state = input.displayState;
  if (state.kind === "ready") {
    const source = state.currentSource || state.workspace.defaultSource;
    const messages = createConversationMessages(
      state.conversation,
      input.viewState.models,
    );
    const pdfHelperNotice =
      input.pdfHelperNotice?.conversationId === state.conversation.metadata.id
        ? input.pdfHelperNotice.message
        : undefined;
    return {
      conversationId: state.conversation.metadata.id,
      title: `${state.conversation.metadata.workspaceTitle} / ${state.conversation.metadata.label}`,
      context: {
        label: state.workspace.workspaceLabel,
        hostContextKind: state.hostContext?.kind,
        workspaceKey: state.workspace.workspaceKey,
        workspaceType: state.workspace.workspaceType,
        collectionKey: state.workspace.collectionKey,
        itemKey: state.workspace.itemKey,
        paperTitle: source?.title,
        paperKey: source?.paperKey,
        parentItemKey: source?.parentItemKey,
        attachmentKey: source?.attachmentKey,
      },
      composerEnabled: true,
      messages: pdfHelperNotice ? [...messages, pdfHelperNotice] : messages,
      busy: input.busy,
      prompts: loadPromptViews(),
      activeNoteContexts:
        state.hostContext?.kind === "reader" &&
        state.workspace.workspaceType === "item"
          ? state.conversation.metadata.activeNoteContexts || []
          : [],
      sessions: input.viewState.sessions.map((session) =>
        createSessionView(session.conversation, state.conversation.metadata.id),
      ),
    };
  }

  const label = state.kind === "closed" ? input.getClosedLabel() : state.label;
  const message =
    state.kind === "error"
      ? state.message
      : getString("sidebar-unavailable-message");
  return {
    conversationId: undefined,
    title: label,
    context: { label },
    composerEnabled: false,
    busy: false,
    sessionsOpen: false,
    sessions: [],
    sourceCandidates: [],
    itemContextTree: undefined,
    activeNoteContexts: [],
    libraryItemCount: 0,
    collectionOptions: [],
    prompts: loadPromptViews(),
    messages:
      state.kind === "loading"
        ? []
        : [
            {
              id: `zp-status-${state.token}`,
              role: "assistant",
              text: message,
              status: "complete",
              transient: true,
            },
          ],
  };
}

export { projectSidebarState };
export type { SidebarStateProjectionInput };
