import { getString } from "../../../app/localization";
import type { RunningTurn } from "../chat/TurnCoordinator";
import type { SidebarMessageView, SidebarState } from "../ui/types";
import { loadPromptViews } from "../prompts/promptStore";
import { createConversationMessages, createSessionView } from "./viewModel";
import type { SidebarDisplayState } from "../workspace/WorkspaceCoordinator";
import { projectAgentTurnTrace } from "../../../domain/agent/trace";

type SidebarStateProjectionInput = {
  displayState: SidebarDisplayState;
  viewState: SidebarState;
  runningTurns: ReadonlyMap<string, RunningTurn>;
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
    const runningTurn = input.runningTurns.get(state.conversation.metadata.id);
    const runningTrace = runningTurn
      ? projectAgentTurnTrace(runningTurn.traceState)
      : undefined;
    const source = state.workspace.defaultSource;
    const messages = createConversationMessages(
      state.conversation,
      runningTurn && runningTrace
        ? {
            text: runningTrace.finalText,
            trace: runningTrace.trace,
            finalStarted: runningTrace.finalStarted,
            interrupted: runningTurn.interrupted,
            running: !runningTurn.interrupted,
            model: runningTurn.model,
            providerBrand: runningTurn.providerBrand,
          }
        : undefined,
    );
    const pdfHelperNotice =
      input.pdfHelperNotice?.conversationId === state.conversation.metadata.id
        ? input.pdfHelperNotice.message
        : undefined;
    return {
      title: `${state.conversation.metadata.workspaceTitle} / ${state.conversation.metadata.label}`,
      context: {
        label: state.workspace.workspaceLabel,
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
      busy: Boolean(runningTurn),
      prompts: loadPromptViews(),
      sessions: input.viewState.sessions.map((session) =>
        createSessionView(session.conversation, state.conversation.metadata.id),
      ),
    };
  }

  const label = state.kind === "closed" ? input.getClosedLabel() : state.label;
  const message =
    state.kind === "loading"
      ? getString("sidebar-loading-conversation")
      : state.kind === "error"
        ? state.message
        : getString("sidebar-unavailable-message");
  return {
    title: label,
    context: { label },
    composerEnabled: false,
    busy: false,
    sessionsOpen: false,
    sessions: [],
    sourceCandidates: [],
    collectionOptions: [],
    prompts: loadPromptViews(),
    messages: [
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
