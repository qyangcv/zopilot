import { getString } from "../../../app/localization";
import { getAgentBackendManager } from "../../../application/agent/BackendManager";
import { getProviderProfileStore } from "../../../application/providers/ProviderProfileService";
import { resolveProviderBrand } from "../../../domain/agent/providerBrand";
import type { AgentStreamEvent } from "../../../domain/agent/streaming";
import type { AgentRunResult } from "../../../domain/agent/types";
import type { Conversation } from "../../../domain/conversation";
import { sourceToMention } from "../../../domain/thread";
import { ZoteroNoteContextResolver } from "../../../integrations/zotero/ZoteroNoteContextResolver";
import { ZoteroSourceUniverse } from "../../../integrations/zotero/ZoteroWorkspaceService";
import { createTimestampId } from "../../../runtime/ids/timestampId";
import { createLogger } from "../../../runtime/logging/logger";
import { getThreadStore } from "../../../runtime/persistence/threads/ThreadService";
import type { SidebarPromptSubmission, SidebarState } from "../ui/types";
import { formatBackendError } from "./formatBackendError";
import {
  RunningTurnStore,
  type RunningTurnApplyResult,
  type RunningTurnHandle,
} from "./RunningTurnStore";
import { StreamRenderScheduler } from "./StreamRenderScheduler";

const logger = createLogger("sidebar.turns");
const STREAM_PERSIST_INTERVAL_MS = 500;

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
  refreshBackendDiagnostic: (
    error?: unknown,
    providerProfileId?: string,
    model?: string,
  ) => Promise<void>;
  markBackendHealthy: (providerProfileId?: string, model?: string) => void;
  markConversationUnread: (conversationId: string) => void;
  refreshSessions: () => void;
  areSessionsOpen: () => boolean;
};

type ActiveTurnExecution = {
  conversationId: string;
  threadTurnId: string;
  runningTurn: RunningTurnHandle;
  finalization?: Promise<void>;
};

class TurnCoordinator {
  private noteContextResolver?: ZoteroNoteContextResolver;
  private sourceUniverse?: ZoteroSourceUniverse;
  private readonly activeExecutions = new Map<string, ActiveTurnExecution>();
  private readonly snapshotTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private shutdownPromise?: Promise<void>;
  private shuttingDown = false;

  constructor(private readonly options: TurnCoordinatorOptions) {}

  async submitPrompt(submission: SidebarPromptSubmission): Promise<boolean> {
    if (this.shuttingDown) return false;
    const promptText = submission.text.trim();
    if (!promptText) return false;

    const currentConversation = await this.options.getReadyConversation();
    if (!currentConversation) return false;
    const conversationId = currentConversation.metadata.id;
    if (this.options.turnStore.has(conversationId)) return false;
    if (!(await this.options.ensurePromptReady(currentConversation))) {
      return false;
    }
    this.options.clearPromptNotice(conversationId);

    const viewState = this.options.getViewState();
    const selectedProfile =
      getProviderProfileStore().getProfile(viewState.selectedProviderId) ||
      getAgentBackendManager().getActiveProfile();
    const assistantMessageId = createTimestampId("msg");
    const model =
      viewState.selectedModel || selectedProfile.defaultModel || undefined;
    const contextLength = selectedProfile.models.find(
      (item) => item.id === model,
    )?.contextLength;

    const sourceIds = [
      ...currentConversation.metadata.activeSources.map(
        (source) => source.sourceId,
      ),
      ...(submission.mentions || []).map((source) => source.sourceId),
    ].filter((sourceId, index, all) => all.indexOf(sourceId) === index);
    let availableSourceIds: string[] = [];
    try {
      availableSourceIds = sourceIds.length
        ? (
            await this.getSourceUniverse().resolveSelectedPdfSources(
              currentConversation.metadata,
              sourceIds,
            )
          ).map((source) => source.sourceId)
        : [];
    } catch (error) {
      logger.warn("failed to validate persistent thread sources", {
        conversationId,
        error: String(error),
      });
    }

    let begun;
    try {
      begun = await getThreadStore().beginTurn(currentConversation.metadata, {
        assistantMessageId,
        prompt: promptText,
        mentions: submission.mentions,
        noteContexts: submission.noteContexts,
        localAttachments: submission.localAttachments,
        execution: {
          backendId: selectedProfile.id,
          backendKind: selectedProfile.kind,
          providerProfileId: selectedProfile.id,
          providerBrand: resolveProviderBrand(selectedProfile),
          model,
          reasoningEffort: viewState.selectedReasoningEffort,
          capabilitySnapshot: selectedProfile.capabilities,
        },
        contextLength,
        availableSourceIds,
      });
    } catch (error) {
      logger.error("failed to create canonical thread turn", error, {
        conversationId,
      });
      return false;
    }

    this.options.setReadyConversation(begun.conversation);
    if (this.options.areSessionsOpen()) this.options.refreshSessions();

    const runningTurn = this.options.turnStore.create({
      conversationId,
      messageId: assistantMessageId,
      model,
      reasoningEffort: viewState.selectedReasoningEffort,
      providerProfileId: selectedProfile.id,
      providerBrand: resolveProviderBrand(selectedProfile),
    });
    const execution: ActiveTurnExecution = {
      conversationId,
      threadTurnId: begun.turn.id,
      runningTurn,
    };
    this.activeExecutions.set(conversationId, execution);
    this.updateRunningState();
    if (this.options.areSessionsOpen()) this.options.refreshSessions();
    this.options.streamScheduler.publishActive();

    const runProviderTurn = async () => {
      try {
        const noteContexts = submission.noteContexts || [];
        const effectiveMentions = begun.runInput.context.sources.map((source) =>
          sourceToMention(source, begun.turn.id),
        );
        const resolvedNoteContexts = noteContexts.length
          ? await this.getNoteContextResolver().resolveAll(
              begun.runInput.workspace,
              noteContexts,
              effectiveMentions,
            )
          : [];
        const result = await getAgentBackendManager().sendPrompt(
          {
            ...begun.runInput,
            resolvedNoteContexts,
          },
          {
            onEvent: (event) => this.handleEvent(conversationId, event),
            onCheckpoint: (checkpoint) =>
              getThreadStore().saveCheckpoint(conversationId, checkpoint),
          },
        );
        if (execution.finalization) {
          await execution.finalization;
          return;
        }
        this.reconcileResult(conversationId, result);
        this.options.markBackendHealthy(result.providerProfileId, model);
        await this.finalizeExecution(execution, () =>
          this.persistCompletedTurn(execution, result),
        );
      } catch (error) {
        if (execution.finalization) {
          await execution.finalization;
          return;
        }
        logger.error("agent backend sendPrompt failed", error, {
          conversationId,
          workspaceKey: begun.conversation.metadata.workspaceKey,
          ...this.options.turnStore.getRunIdentity(conversationId),
        });
        await this.options.refreshBackendDiagnostic(
          error,
          runningTurn.providerProfileId,
          runningTurn.model,
        );
        this.reconcileFailure(conversationId, error);
        await this.finalizeExecution(execution, () =>
          this.persistFailedTurn(execution, error),
        );
      } finally {
        if (!this.shuttingDown) this.updateRunningState();
      }
    };
    void runProviderTurn().catch((error) => {
      logger.error("turn execution finalization failed", error, {
        conversationId,
        threadTurnId: execution.threadTurnId,
      });
    });
    return true;
  }

  prepareForShutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.finalizeInterruptedExecutions();
    return this.shutdownPromise;
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
    if (!identity.runId) return;
    void getAgentBackendManager()
      .cancelTurn({
        conversationId,
        providerProfileId: identity.providerProfileId,
        runId: identity.runId,
        turnId: identity.turnId,
      })
      .catch((error) => {
        logger.error("agent backend cancel failed", error, {
          conversationId,
          runId: identity.runId,
          turnId: identity.turnId,
        });
      });
  }

  private async finalizeInterruptedExecutions(): Promise<void> {
    const error = new Error("Zopilot reloaded during an active response.");
    const pending = Array.from(this.activeExecutions.values()).map(
      (execution) => {
        if (!execution.finalization) {
          const result = this.options.turnStore.requestInterrupt(
            execution.conversationId,
          );
          this.scheduleAppliedChange(execution.conversationId, result);
          this.requestBackendCancel(execution.conversationId);
          this.reconcileFailure(execution.conversationId, error);
        }
        return this.finalizeExecution(execution, () =>
          this.persistFailedTurn(execution, error),
        );
      },
    );
    const results = await Promise.allSettled(pending);
    results.forEach((result) => {
      if (result.status === "rejected") {
        logger.error(
          "failed to persist an interrupted turn during shutdown",
          result.reason,
        );
      }
    });
  }

  private finalizeExecution(
    execution: ActiveTurnExecution,
    persist: () => Promise<Conversation>,
  ): Promise<void> {
    if (!execution.finalization) {
      const pending = (async () => {
        const conversation = await persist();
        this.finish(execution.conversationId, conversation);
      })();
      execution.finalization = pending;
      pending.then(
        () => this.activeExecutions.delete(execution.conversationId),
        () => this.activeExecutions.delete(execution.conversationId),
      );
    }
    return execution.finalization;
  }

  private handleEvent(conversationId: string, event: AgentStreamEvent): void {
    const result = this.options.turnStore.apply(conversationId, event);
    this.scheduleAppliedChange(conversationId, result);
    const execution = this.activeExecutions.get(conversationId);
    if (event.type === "turn.started" && execution) {
      void getThreadStore()
        .markTurnRunning(
          conversationId,
          execution.threadTurnId,
          event.runId,
          event.turnId,
        )
        .catch((error) => {
          logger.error("failed to persist provider run reference", error, {
            conversationId,
            threadTurnId: execution.threadTurnId,
          });
        });
    }
    if (result.changed) this.scheduleSnapshotPersistence(conversationId);
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

  private scheduleSnapshotPersistence(conversationId: string): void {
    if (this.snapshotTimers.has(conversationId)) return;
    const timer = setTimeout(() => {
      this.snapshotTimers.delete(conversationId);
      void this.persistSnapshot(conversationId);
    }, STREAM_PERSIST_INTERVAL_MS);
    this.snapshotTimers.set(conversationId, timer);
  }

  private async persistSnapshot(conversationId: string): Promise<void> {
    const execution = this.activeExecutions.get(conversationId);
    if (!execution) return;
    const projection = this.options.turnStore.getProjection(conversationId);
    try {
      await getThreadStore().persistTurnSnapshot(
        conversationId,
        execution.threadTurnId,
        projection.finalText,
        projection.trace.length ? projection.trace : undefined,
      );
    } catch (error) {
      logger.error("failed to persist streaming turn snapshot", error, {
        conversationId,
        threadTurnId: execution.threadTurnId,
      });
    }
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
    execution: ActiveTurnExecution,
    result: AgentRunResult,
  ): Promise<Conversation> {
    const projection = this.options.turnStore.getProjection(
      execution.conversationId,
    );
    const identity = this.options.turnStore.getRunIdentity(
      execution.conversationId,
    );
    const lifecycle = this.options.turnStore.getLifecycle(
      execution.conversationId,
    );
    return getThreadStore().completeTurn(
      execution.conversationId,
      execution.threadTurnId,
      {
        status:
          lifecycle === "interrupted" || result.status === "interrupted"
            ? "interrupted"
            : "completed",
        text: projection.finalText || result.text,
        trace: projection.trace.length ? projection.trace : undefined,
        runId: result.runId || identity.runId,
        providerTurnId: result.turnId || identity.turnId,
        checkpoint: result.checkpoint,
      },
    );
  }

  private async persistFailedTurn(
    execution: ActiveTurnExecution,
    error: unknown,
  ): Promise<Conversation> {
    const projection = this.options.turnStore.getProjection(
      execution.conversationId,
    );
    const lifecycle = this.options.turnStore.getLifecycle(
      execution.conversationId,
    );
    const interrupted = lifecycle === "interrupted";
    return getThreadStore().failTurn(
      execution.conversationId,
      execution.threadTurnId,
      {
        text: interrupted
          ? projection.finalText || getString("sidebar-status-interrupted")
          : combineFailedTurnText(
              projection.finalText,
              formatBackendError(error),
            ),
        trace: projection.trace.length ? projection.trace : undefined,
        interrupted,
        errorCode: interrupted ? "interrupted" : "provider_error",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    );
  }

  private finish(conversationId: string, conversation: Conversation): void {
    const timer = this.snapshotTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    this.snapshotTimers.delete(conversationId);
    const active = this.options.getActiveConversationId() === conversationId;
    const lifecycle = this.options.turnStore.getLifecycle(conversationId);
    this.options.turnStore.remove(conversationId);
    if (active) {
      this.options.streamScheduler.clear();
      this.options.setReadyConversation(conversation);
    } else if (lifecycle === "completed" || lifecycle === "failed") {
      this.options.markConversationUnread(conversationId);
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

  private getSourceUniverse(): ZoteroSourceUniverse {
    this.sourceUniverse ??= new ZoteroSourceUniverse();
    return this.sourceUniverse;
  }
}

function combineFailedTurnText(
  streamedText: string,
  formattedError: string,
): string {
  return streamedText ? `${streamedText}\n\n${formattedError}` : formattedError;
}

export { TurnCoordinator, combineFailedTurnText };
