import { getAgentBackendManager } from "../../../application/agent/BackendManager";
import { getProviderProfileStore } from "../../../application/providers/ProviderProfileService";
import type { AgentRunResult } from "../../../domain/agent/types";
import { resolveProviderBrand } from "../../../domain/agent/providerBrand";
import type { AgentStreamEvent } from "../../../domain/agent/streaming";
import type { Conversation } from "../../../domain/conversation";
import { createTimestampId } from "../../../runtime/ids/timestampId";
import { getConversationStore } from "../../../runtime/persistence/conversations/ConversationService";
import { getString } from "../../../app/localization";
import { formatBackendError } from "./formatBackendError";
import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarPromptSubmission, SidebarState } from "../ui/types";
import { ZoteroNoteContextResolver } from "../../../integrations/zotero/ZoteroNoteContextResolver";
import {
  RunningTurnStore,
  type RunningTurnApplyResult,
  type RunningTurnHandle,
} from "./RunningTurnStore";
import { StreamRenderScheduler } from "./StreamRenderScheduler";

const logger = createLogger("sidebar.turns");

type TurnCoordinatorOptions = {
  turnStore: RunningTurnStore;
  streamScheduler: StreamRenderScheduler;
  getViewState: () => SidebarState;
  getReadyConversation: () => Promise<Conversation | undefined>;
  getActiveConversationId: () => string | undefined;
  ensurePromptReady: (conversation: Conversation) => Promise<boolean>;
  clearPromptNotice: (conversationId: string) => void;
  setReadyConversation: (conversation: Conversation) => void;
  updateViewState: (patch: Partial<SidebarState>) => void;
  refreshBackendDiagnostic: (error?: unknown) => Promise<void>;
  refreshSessions: () => void;
  areSessionsOpen: () => boolean;
};

class TurnCoordinator {
  private noteContextResolver?: ZoteroNoteContextResolver;

  constructor(private readonly options: TurnCoordinatorOptions) {}

  async submitPrompt(submission: SidebarPromptSubmission): Promise<void> {
    const promptText = submission.text.trim();
    if (!promptText) return;
    const noteContexts = submission.noteContexts || [];

    let conversation = await this.options.getReadyConversation();
    if (!conversation) return;
    if (this.options.turnStore.has(conversation.metadata.id)) return;
    if (!(await this.options.ensurePromptReady(conversation))) return;
    this.options.clearPromptNotice(conversation.metadata.id);

    if (submission.persistNoteContexts) {
      const metadata = await getConversationStore().updateActiveNoteContexts(
        conversation.metadata,
        noteContexts,
      );
      conversation = { ...conversation, metadata };
    }
    conversation = await getConversationStore().addMessage(
      conversation.metadata,
      {
        role: "user",
        text: promptText,
        mentions: submission.mentions,
        noteContexts,
        localAttachments: submission.localAttachments,
      },
    );
    this.options.setReadyConversation(conversation);
    if (this.options.areSessionsOpen()) this.options.refreshSessions();

    const viewState = this.options.getViewState();
    const selectedProfile =
      getProviderProfileStore().getProfile(viewState.selectedProviderId) ||
      getAgentBackendManager().getActiveProfile();
    const conversationId = conversation.metadata.id;
    const runningTurn = this.options.turnStore.create({
      conversationId,
      messageId: createTimestampId("msg"),
      model: viewState.selectedModel,
      reasoningEffort: viewState.selectedReasoningEffort,
      providerProfileId: viewState.selectedProviderId,
      providerBrand: resolveProviderBrand(selectedProfile),
    });
    this.updateRunningState();
    this.options.streamScheduler.publishActive();

    try {
      const resolvedNoteContexts = noteContexts.length
        ? await this.getNoteContextResolver().resolveAll(
            conversation.metadata,
            noteContexts,
            submission.mentions,
          )
        : [];
      const result = await getAgentBackendManager().sendPrompt(
        {
          providerProfileId: runningTurn.providerProfileId,
          conversation,
          prompt: promptText,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
          mentions: submission.mentions,
          resolvedNoteContexts,
          localAttachments: submission.localAttachments,
        },
        {
          onEvent: (event) => this.handleEvent(conversationId, event),
        },
      );
      this.reconcileResult(conversationId, result);
      this.options.updateViewState({
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
      });
      conversation = await this.persistCompletedTurn(
        conversation,
        runningTurn,
        result,
      );
      this.finish(conversationId, conversation);
    } catch (error) {
      logger.error("agent backend sendPrompt failed", error, {
        conversationId,
        workspaceKey: conversation.metadata.workspaceKey,
        ...this.options.turnStore.getRunIdentity(conversationId),
      });
      await this.options.refreshBackendDiagnostic(error);
      this.reconcileFailure(conversationId, error);
      conversation = await this.persistFailedTurn(
        conversation,
        runningTurn,
        error,
      );
      this.finish(conversationId, conversation);
    } finally {
      this.updateRunningState();
    }
  }

  interruptActive(): void {
    const conversationId = this.options.getActiveConversationId();
    if (conversationId) this.interruptConversation(conversationId);
  }

  interruptConversation(conversationId: string): void {
    const result = this.options.turnStore.requestInterrupt(conversationId);
    if (!result.changed) return;
    this.scheduleAppliedChange(conversationId, result);
    this.requestBackendCancel(conversationId);
  }

  updateRunningState(): void {
    const conversationId = this.options.getActiveConversationId();
    const busy = this.options.turnStore.has(conversationId);
    if (this.options.getViewState().busy !== busy) {
      this.options.updateViewState({ busy });
    }
  }

  private requestBackendCancel(conversationId: string): void {
    const identity = this.options.turnStore.getRunIdentity(conversationId);
    if (!identity.runId && !identity.legacy?.codexThreadId) return;
    void getAgentBackendManager()
      .cancelTurn({
        conversationId,
        providerProfileId: identity.providerProfileId,
        runId: identity.runId,
        turnId: identity.turnId,
        legacy: identity.legacy,
      })
      .catch((error) => {
        logger.error("agent backend cancel failed", error, {
          conversationId,
          runId: identity.runId,
          turnId: identity.turnId,
        });
      });
  }

  private handleEvent(conversationId: string, event: AgentStreamEvent): void {
    const result = this.options.turnStore.apply(conversationId, event);
    this.scheduleAppliedChange(conversationId, result);
    if (
      event.type === "turn.started" &&
      this.options.turnStore.getLifecycle(conversationId) === "interrupting"
    ) {
      this.requestBackendCancel(conversationId);
    }
  }

  private scheduleAppliedChange(
    conversationId: string,
    result: RunningTurnApplyResult,
  ): void {
    if (!result.changed) return;
    this.options.streamScheduler.markDirty(conversationId, {
      immediate: result.immediate,
    });
  }

  private reconcileResult(
    conversationId: string,
    result: AgentRunResult,
  ): void {
    const identity = this.options.turnStore.getRunIdentity(conversationId);
    if (!identity.runId) {
      this.handleEvent(conversationId, {
        type: "turn.started",
        sequence: this.nextSequence(conversationId),
        backendId: result.backendId,
        providerProfileId: result.providerProfileId,
        runId: result.runId,
        turnId: result.turnId,
        legacy: result.legacy,
      });
    }
    const lifecycle = this.options.turnStore.getLifecycle(conversationId);
    if (lifecycle === "running" || lifecycle === "interrupting") {
      this.handleEvent(conversationId, {
        type:
          result.status === "interrupted" || lifecycle === "interrupting"
            ? "turn.interrupted"
            : "turn.completed",
        sequence: this.nextSequence(conversationId),
        text: result.text,
      });
    }
    this.scheduleAppliedChange(
      conversationId,
      this.options.turnStore.reconcileAgentResult(conversationId, result),
    );
  }

  private reconcileFailure(conversationId: string, error: unknown): void {
    const lifecycle = this.options.turnStore.getLifecycle(conversationId);
    if (lifecycle === "interrupting") {
      this.handleEvent(conversationId, {
        type: "turn.interrupted",
        sequence: this.nextSequence(conversationId),
        text: this.options.turnStore.getProjection(conversationId).finalText,
      });
      return;
    }
    if (lifecycle === "running") {
      this.handleEvent(conversationId, {
        type: "turn.failed",
        sequence: this.nextSequence(conversationId),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistCompletedTurn(
    conversation: Conversation,
    runningTurn: RunningTurnHandle,
    result: AgentRunResult,
  ): Promise<Conversation> {
    const conversationId = conversation.metadata.id;
    const projection = this.options.turnStore.getProjection(conversationId);
    const finalText = projection.finalText;
    const identity = this.options.turnStore.getRunIdentity(conversationId);
    const metadata = await getConversationStore().updateBackendMetadata(
      conversation.metadata,
      {
        backendId: result.backendId,
        providerProfileId: result.providerProfileId,
        codexThreadId: result.legacy?.codexThreadId,
      },
    );
    const profile =
      getProviderProfileStore().getProfile(result.providerProfileId) ||
      getAgentBackendManager().getActiveProfile();
    const lifecycle = this.options.turnStore.getLifecycle(conversationId);
    return getConversationStore().addMessage(metadata, {
      id: runningTurn.messageId,
      role: "assistant",
      text: finalText,
      status:
        lifecycle === "interrupted" || result.status === "interrupted"
          ? "interrupted"
          : "complete",
      completedAt: new Date().toISOString(),
      codexThreadId: result.legacy?.codexThreadId,
      codexTurnId: result.legacy?.codexTurnId,
      backendId: result.backendId,
      backendKind: profile.kind,
      providerProfileId: result.providerProfileId,
      providerBrand: resolveProviderBrand(profile),
      backendRunId: result.runId || identity.runId,
      backendTurnId: result.turnId || identity.turnId,
      capabilitySnapshot: profile.capabilities,
      model: runningTurn.model,
      reasoningEffort: runningTurn.reasoningEffort,
      trace: projection.trace.length ? projection.trace : undefined,
    });
  }

  private async persistFailedTurn(
    conversation: Conversation,
    runningTurn: RunningTurnHandle,
    error: unknown,
  ): Promise<Conversation> {
    const conversationId = conversation.metadata.id;
    const projection = this.options.turnStore.getProjection(conversationId);
    const lifecycle = this.options.turnStore.getLifecycle(conversationId);
    const interrupted = lifecycle === "interrupted";
    const identity = this.options.turnStore.getRunIdentity(conversationId);
    const profile = identity.providerProfileId
      ? getProviderProfileStore().getProfile(identity.providerProfileId)
      : undefined;
    return getConversationStore().addMessage(conversation.metadata, {
      id: runningTurn.messageId,
      role: "assistant",
      text: interrupted
        ? projection.finalText || getString("sidebar-status-interrupted")
        : formatBackendError(error),
      status: interrupted ? "interrupted" : "error",
      completedAt: new Date().toISOString(),
      backendId: identity.backendId,
      backendKind:
        profile?.kind || getAgentBackendManager().getActiveProfile().kind,
      providerProfileId: identity.providerProfileId,
      providerBrand: resolveProviderBrand(
        profile || getAgentBackendManager().getActiveProfile(),
      ),
      backendRunId: identity.runId,
      backendTurnId: identity.turnId,
      model: runningTurn.model,
      reasoningEffort: runningTurn.reasoningEffort,
      trace: projection.trace.length ? projection.trace : undefined,
    });
  }

  private finish(conversationId: string, conversation: Conversation): void {
    const active = this.options.getActiveConversationId() === conversationId;
    this.options.turnStore.remove(conversationId);
    if (active) {
      this.options.streamScheduler.clear();
      this.options.setReadyConversation(conversation);
    }
    if (this.options.areSessionsOpen()) this.options.refreshSessions();
  }

  private nextSequence(conversationId: string): number {
    return this.options.turnStore.getNextSequence(conversationId);
  }

  private getNoteContextResolver(): ZoteroNoteContextResolver {
    this.noteContextResolver ??= new ZoteroNoteContextResolver();
    return this.noteContextResolver;
  }
}

export { TurnCoordinator };
