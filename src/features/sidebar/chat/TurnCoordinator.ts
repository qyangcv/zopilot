import { getAgentBackendManager } from "../../../application/agent/BackendManager";
import { getProviderProfileStore } from "../../../application/providers/ProviderProfileService";
import type { AgentRunResult } from "../../../domain/agent/types";
import {
  resolveProviderBrand,
  type ProviderBrand,
} from "../../../domain/agent/providerBrand";
import {
  createAgentTurnTraceState,
  projectAgentTurnTrace,
  reduceAgentTraceEvent,
  type AgentTurnTraceState,
} from "../../../domain/agent/trace";
import type { Conversation } from "../../../domain/conversation";
import { getConversationStore } from "../../../runtime/persistence/conversations/ConversationService";
import { getString } from "../../../app/localization";
import { formatBackendError } from "./formatBackendError";
import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarPromptSubmission, SidebarState } from "../ui/types";

const logger = createLogger("sidebar.turns");

type RunningTurn = {
  conversation: Conversation;
  traceState: AgentTurnTraceState;
  model?: string;
  reasoningEffort?: string;
  backendId?: string;
  providerProfileId?: string;
  providerBrand: ProviderBrand;
  runId?: string;
  turnId?: string;
  legacy?: AgentRunResult["legacy"];
  interrupting: boolean;
  interrupted: boolean;
};

type TurnCoordinatorOptions = {
  runningTurns: Map<string, RunningTurn>;
  getViewState: () => SidebarState;
  getReadyConversation: () => Promise<Conversation | undefined>;
  getActiveConversationId: () => string | undefined;
  ensurePromptReady: (conversation: Conversation) => Promise<boolean>;
  clearPromptNotice: (conversationId: string) => void;
  setReadyConversation: (conversation: Conversation) => void;
  updateViewState: (patch: Partial<SidebarState>) => void;
  renderDisplayState: () => void;
  refreshBackendDiagnostic: (error?: unknown) => Promise<void>;
  refreshSessions: () => void;
  areSessionsOpen: () => boolean;
};

class TurnCoordinator {
  constructor(private readonly options: TurnCoordinatorOptions) {}

  async submitPrompt(submission: SidebarPromptSubmission): Promise<void> {
    const promptText = submission.text.trim();
    if (!promptText) {
      return;
    }

    let conversation = await this.options.getReadyConversation();
    if (!conversation) {
      return;
    }
    if (this.options.runningTurns.has(conversation.metadata.id)) {
      return;
    }
    if (!(await this.options.ensurePromptReady(conversation))) {
      return;
    }
    this.options.clearPromptNotice(conversation.metadata.id);

    conversation = await getConversationStore().addMessage(
      conversation.metadata,
      {
        role: "user",
        text: promptText,
        mentions: submission.mentions,
        localAttachments: submission.localAttachments,
      },
    );
    this.options.setReadyConversation(conversation);
    const viewState = this.options.getViewState();
    const selectedProfile =
      getProviderProfileStore().getProfile(viewState.selectedProviderId) ||
      getAgentBackendManager().getActiveProfile();
    const runningTurn: RunningTurn = {
      conversation,
      traceState: createAgentTurnTraceState(),
      model: viewState.selectedModel,
      reasoningEffort: viewState.selectedReasoningEffort,
      providerProfileId: viewState.selectedProviderId,
      providerBrand: resolveProviderBrand(selectedProfile),
      interrupting: false,
      interrupted: false,
    };
    this.options.runningTurns.set(conversation.metadata.id, runningTurn);
    this.options.renderDisplayState();

    try {
      const result = await getAgentBackendManager().sendPrompt(
        {
          providerProfileId: runningTurn.providerProfileId,
          conversation,
          prompt: promptText,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
          mentions: submission.mentions,
          localAttachments: submission.localAttachments,
        },
        {
          onRunStarted: (event) => {
            runningTurn.backendId = event.backendId;
            runningTurn.providerProfileId = event.providerProfileId;
            runningTurn.runId = event.runId;
            runningTurn.turnId = event.turnId;
            runningTurn.legacy = event.legacy;
            if (runningTurn.interrupting) {
              this.interrupt(runningTurn);
            }
          },
          onTraceEvent: (event) => {
            if (runningTurn.interrupted) {
              return;
            }
            runningTurn.traceState = reduceAgentTraceEvent(
              runningTurn.traceState,
              event,
            );
            this.refreshView(runningTurn);
          },
        },
      );
      runningTurn.backendId = result.backendId;
      runningTurn.providerProfileId = result.providerProfileId;
      runningTurn.runId = result.runId;
      runningTurn.turnId = result.turnId;
      runningTurn.legacy = result.legacy;
      this.options.updateViewState({
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
      });
      let traceView = projectAgentTurnTrace(runningTurn.traceState);
      if (!traceView.finalText && result.text) {
        runningTurn.traceState = reduceAgentTraceEvent(runningTurn.traceState, {
          type: "content.completed",
          itemId: "backend-final-response",
          phase: "candidate",
          text: result.text,
        });
        traceView = projectAgentTurnTrace(runningTurn.traceState);
      }
      const finalText =
        traceView.finalText || getString("sidebar-backend-empty-response");
      const metadata = await getConversationStore().updateBackendMetadata(
        conversation.metadata,
        {
          backendId: result.backendId,
          providerProfileId: result.providerProfileId,
          codexThreadId: result.legacy?.codexThreadId,
        },
      );
      const completedProfile =
        getProviderProfileStore().getProfile(result.providerProfileId) ||
        getAgentBackendManager().getActiveProfile();
      conversation = await getConversationStore().addMessage(metadata, {
        role: "assistant",
        text: finalText,
        status:
          result.status === "interrupted" || runningTurn.interrupted
            ? "interrupted"
            : "complete",
        completedAt: new Date().toISOString(),
        codexThreadId: result.legacy?.codexThreadId,
        codexTurnId: result.legacy?.codexTurnId,
        backendId: result.backendId,
        backendKind: completedProfile.kind,
        providerProfileId: result.providerProfileId,
        providerBrand: resolveProviderBrand(completedProfile),
        backendRunId: result.runId,
        backendTurnId: result.turnId,
        capabilitySnapshot: completedProfile.capabilities,
        model: runningTurn.model,
        reasoningEffort: runningTurn.reasoningEffort,
        trace: traceView.trace.length ? traceView.trace : undefined,
      });
      this.finish(runningTurn, conversation);
    } catch (error) {
      logger.error("agent backend sendPrompt failed", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
        runId: runningTurn.runId,
        turnId: runningTurn.turnId,
      });
      await this.options.refreshBackendDiagnostic(error);
      const errorText = formatBackendError(error);
      const traceView = projectAgentTurnTrace(runningTurn.traceState);
      const text = runningTurn.interrupted
        ? traceView.finalText || getString("sidebar-status-interrupted")
        : errorText;
      const failedProfile = runningTurn.providerProfileId
        ? getProviderProfileStore().getProfile(runningTurn.providerProfileId)
        : undefined;
      conversation = await getConversationStore().addMessage(
        conversation.metadata,
        {
          role: "assistant",
          text,
          status: runningTurn.interrupted ? "interrupted" : "error",
          completedAt: new Date().toISOString(),
          backendId: runningTurn.backendId,
          backendKind:
            failedProfile?.kind ||
            getAgentBackendManager().getActiveProfile().kind,
          providerProfileId: runningTurn.providerProfileId,
          providerBrand: resolveProviderBrand(
            failedProfile || getAgentBackendManager().getActiveProfile(),
          ),
          backendRunId: runningTurn.runId,
          backendTurnId: runningTurn.turnId,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
          trace: traceView.trace.length ? traceView.trace : undefined,
        },
      );
      this.finish(runningTurn, conversation);
    } finally {
      this.updateRunningState();
    }
  }

  refreshView(runningTurn: RunningTurn): void {
    if (
      this.options.getActiveConversationId() !==
      runningTurn.conversation.metadata.id
    ) {
      return;
    }
    this.options.renderDisplayState();
  }

  interruptActive(): void {
    const conversationId = this.options.getActiveConversationId();
    const runningTurn = conversationId
      ? this.options.runningTurns.get(conversationId)
      : undefined;
    if (runningTurn) {
      this.interrupt(runningTurn);
    }
  }

  interrupt(runningTurn: RunningTurn): void {
    runningTurn.interrupting = true;
    runningTurn.interrupted = true;
    this.refreshView(runningTurn);
    this.updateRunningState();
    const { runId, turnId, legacy } = runningTurn;
    if (!runId && !legacy?.codexThreadId) {
      return;
    }
    void getAgentBackendManager()
      .cancelTurn({
        conversationId: runningTurn.conversation.metadata.id,
        providerProfileId: runningTurn.providerProfileId,
        runId,
        turnId,
        legacy,
      })
      .catch((error) => {
        logger.error("agent backend cancel failed", error, {
          runId,
          turnId,
          conversationId: runningTurn.conversation.metadata.id,
        });
      });
  }

  updateRunningState(): void {
    const conversationId = this.options.getActiveConversationId();
    this.options.updateViewState({
      busy: Boolean(
        conversationId && this.options.runningTurns.get(conversationId),
      ),
    });
  }

  private finish(runningTurn: RunningTurn, conversation: Conversation): void {
    const conversationId = runningTurn.conversation.metadata.id;
    this.options.runningTurns.delete(conversationId);
    if (this.options.getActiveConversationId() === conversationId) {
      this.options.setReadyConversation(conversation);
    }
    if (this.options.areSessionsOpen()) {
      this.options.refreshSessions();
    }
  }
}

export { TurnCoordinator };
export type { RunningTurn, TurnCoordinatorOptions };
