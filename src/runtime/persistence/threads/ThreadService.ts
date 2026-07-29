import type {
  Conversation,
  ConversationMetadata,
  LocalAttachmentRef,
  NoteContextRef,
  PaperIdentity,
  SourceMention,
  ThreadSource,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import type {
  ProviderBinding,
  ProviderCheckpoint,
  Thread,
  ThreadHistoryItem,
  ThreadRunInput,
  ThreadTurn,
  ThreadTurnExecution,
} from "../../../domain/thread";
import { cloneThread, threadToConversation } from "../../../domain/thread";
import { createSourceId } from "../../../domain/sourceIdentity";
import {
  DEFAULT_CONTEXT_LENGTH,
  projectThreadHistory,
} from "../../../application/agent/prompt/historyProjector";
import { createTimestampId } from "../../ids/timestampId";
import { createLogger } from "../../logging/logger";
import {
  LegacyConversationReader,
  type LegacyConversationReadResult,
} from "./LegacyConversationReader";
import type {
  LegacyConversation,
  LegacyConversationMessage,
} from "./legacyTypes";
import {
  SqliteThreadRepository,
  type ThreadRepository,
} from "./ThreadRepository";
import { getDefaultThreadRootDir, getThreadDatabasePath } from "./paths";

type BeginThreadTurnInput = {
  assistantMessageId: string;
  prompt: string;
  mentions?: SourceMention[];
  noteContexts?: NoteContextRef[];
  localAttachments?: LocalAttachmentRef[];
  execution: Omit<ThreadTurnExecution, "runId" | "providerTurnId">;
  contextLength?: number;
  availableSourceIds?: string[];
};

type BegunThreadTurn = {
  conversation: Conversation;
  turn: ThreadTurn;
  runInput: ThreadRunInput;
};

type RecoveredCodexTurn =
  | {
      status: "completed" | "interrupted";
      text: string;
    }
  | { status: "unknown" };

type RecoverThreadOptions = {
  readCodexTurn?: (
    binding: ProviderBinding,
    turn: ThreadTurn,
  ) => Promise<RecoveredCodexTurn>;
};

type LegacyThreadReader = {
  readAll(): Promise<LegacyConversationReadResult[]>;
};

const CODEX_ADAPTER_KEY = "codex-cli";
const logger = createLogger("store.threadService");

class ThreadStore {
  private initialized?: Promise<void>;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly rootDir = getDefaultThreadRootDir(),
    private readonly repository: ThreadRepository = new SqliteThreadRepository(
      getThreadDatabasePath(rootDir),
    ),
    private readonly legacyReader: LegacyThreadReader | null = new LegacyConversationReader(
      rootDir,
    ),
  ) {}

  async initialize(): Promise<void> {
    this.initialized ??= this.initializeStore();
    return this.initialized;
  }

  async close(): Promise<void> {
    await this.initialized?.catch(() => undefined);
    await this.writeTail.catch(() => undefined);
    await this.repository.close();
    this.initialized = undefined;
  }

  async getOrCreateLatestWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation> {
    return this.serialize(async () => {
      await this.initialize();
      const latest = selectLatestActiveThread(
        await this.repository.listWorkspaceThreads(workspace.workspaceKey),
      );
      if (!latest) return this.insertWorkspaceConversation(workspace);
      const refreshed = refreshWorkspaceSnapshot(latest.metadata, workspace);
      if (refreshed === latest.metadata) return threadToConversation(latest);
      latest.metadata = refreshed;
      await this.repository.updateMetadata(refreshed);
      return threadToConversation(latest);
    });
  }

  async getLatestWorkspaceConversation(
    workspaceKey: string,
  ): Promise<Conversation | null> {
    await this.initialize();
    const latest = selectLatestActiveThread(
      await this.repository.listWorkspaceThreads(workspaceKey),
    );
    return latest ? threadToConversation(latest) : null;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    await this.initialize();
    const thread = await this.repository.getThread(id);
    return thread ? threadToConversation(thread) : null;
  }

  async listWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    return this.listActiveWorkspaceConversations(workspaceKey);
  }

  async listActiveWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    return this.listWorkspaceProjection(workspaceKey, false);
  }

  async listArchivedWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    return this.listWorkspaceProjection(workspaceKey, true);
  }

  async createWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation> {
    return this.serialize(async () => {
      await this.initialize();
      return this.insertWorkspaceConversation(workspace);
    });
  }

  async activateWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<Conversation> {
    return this.touchConversation(metadata);
  }

  async touchConversation(
    metadata: ConversationMetadata,
  ): Promise<Conversation> {
    return this.serialize(async () => {
      await this.initialize();
      const thread = await this.requireThread(metadata.id);
      thread.metadata = updateMetadata(thread.metadata, {});
      await this.repository.updateMetadata(thread.metadata);
      return threadToConversation(thread);
    });
  }

  async archiveWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<void> {
    await this.serialize(async () => {
      await this.initialize();
      const thread = await this.requireThread(metadata.id);
      thread.metadata = updateMetadata(thread.metadata, { archived: true });
      await this.repository.updateMetadata(thread.metadata);
    });
  }

  async restoreWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<ConversationMetadata> {
    return this.serialize(async () => {
      await this.initialize();
      const thread = await this.requireThread(metadata.id);
      const next = { ...thread.metadata };
      delete next.archived;
      thread.metadata = updateMetadata(next, {});
      await this.repository.updateMetadata(thread.metadata);
      return thread.metadata;
    });
  }

  async beginTurn(
    metadata: ConversationMetadata,
    input: BeginThreadTurnInput,
  ): Promise<BegunThreadTurn> {
    return this.serialize(async () => {
      await this.initialize();
      const thread = await this.requireThread(metadata.id);
      if (
        thread.turns.some(
          (turn) => turn.status === "pending" || turn.status === "running",
        )
      ) {
        throw new Error("This Zopilot thread already has an active turn.");
      }
      const selectedSources = (input.mentions || []).map(mentionToThreadSource);
      let activeSources = accumulateSources(
        thread.metadata.activeSources,
        selectedSources,
      );
      const availableSourceIds = input.availableSourceIds
        ? new Set(input.availableSourceIds)
        : undefined;
      if (availableSourceIds) {
        activeSources = activeSources.map((source) => ({
          ...source,
          availability: availableSourceIds.has(source.sourceId)
            ? "available"
            : "unavailable",
        }));
      }
      const effectiveSources = activeSources.filter(
        (source) => source.availability !== "unavailable",
      );
      const effectiveSelectedSources = selectedSources
        .map((source) =>
          activeSources.find((item) => item.sourceId === source.sourceId),
        )
        .filter((source): source is ThreadSource =>
          Boolean(source && source.availability !== "unavailable"),
        );
      const primarySourceId =
        selectedSources.at(-1)?.sourceId ||
        thread.metadata.primarySourceId ||
        activeSources.at(-1)?.sourceId;
      const effectivePrimarySourceId = effectiveSources.some(
        (source) => source.sourceId === primarySourceId,
      )
        ? primarySourceId
        : effectiveSources.at(-1)?.sourceId;
      const createdAt = new Date().toISOString();
      const sequence = (thread.turns.at(-1)?.sequence || 0) + 1;
      const turn: ThreadTurn = {
        id: createTimestampId("turn"),
        threadId: thread.metadata.id,
        sequence,
        status: "pending",
        userMessageId: createTimestampId("msg"),
        assistantMessageId: input.assistantMessageId,
        userText: input.prompt,
        assistantText: "",
        createdAt,
        context: {
          sources: effectiveSources,
          selectedSources: effectiveSelectedSources,
          primarySourceId: effectivePrimarySourceId,
          noteContexts: input.noteContexts || [],
          localAttachments: input.localAttachments || [],
        },
        execution: input.execution,
      };
      thread.metadata = updateMetadata(thread.metadata, {
        activeSources,
        primarySourceId,
        latestPreview: input.prompt.slice(0, 160),
        label:
          thread.metadata.label ===
          defaultThreadLabel(thread.metadata.createdAt)
            ? input.prompt.slice(0, 48)
            : thread.metadata.label,
      });
      thread.turns.push(turn);
      await this.repository.insertTurn(thread.metadata, turn);
      return {
        conversation: threadToConversation(thread),
        turn: cloneThread(turn),
        runInput: buildRunInput(
          thread,
          turn,
          input.contextLength || DEFAULT_CONTEXT_LENGTH,
        ),
      };
    });
  }

  async markTurnRunning(
    threadId: string,
    turnId: string,
    runId: string,
    providerTurnId?: string,
  ): Promise<void> {
    await this.serialize(async () => {
      const thread = await this.requireThread(threadId);
      const turn = requireTurn(thread, turnId);
      if (isTerminal(turn)) return;
      turn.status = "running";
      turn.startedAt ||= new Date().toISOString();
      turn.execution.runId = runId;
      turn.execution.providerTurnId = providerTurnId;
      thread.metadata = updateMetadata(thread.metadata, {});
      await this.repository.updateTurn(thread.metadata, turn);
    });
  }

  async persistTurnSnapshot(
    threadId: string,
    turnId: string,
    assistantText: string,
    trace?: ThreadTurn["trace"],
  ): Promise<void> {
    await this.serialize(async () => {
      const thread = await this.requireThread(threadId);
      const turn = requireTurn(thread, turnId);
      if (isTerminal(turn)) return;
      turn.assistantText = assistantText;
      turn.trace = trace;
      await this.repository.updateTurn(thread.metadata, turn);
    });
  }

  async saveCheckpoint(
    threadId: string,
    checkpoint: ProviderCheckpoint,
  ): Promise<void> {
    await this.serialize(async () => {
      await this.initialize();
      const thread = await this.requireThread(threadId);
      const binding = checkpointToBinding(threadId, checkpoint);
      replaceBinding(thread, binding);
      await this.repository.upsertBinding(binding);
    });
  }

  async completeTurn(
    threadId: string,
    turnId: string,
    input: {
      status: "completed" | "interrupted";
      text: string;
      trace?: ThreadTurn["trace"];
      runId?: string;
      providerTurnId?: string;
      checkpoint?: ProviderCheckpoint;
    },
  ): Promise<Conversation> {
    return this.serialize(async () => {
      const thread = await this.requireThread(threadId);
      const turn = requireTurn(thread, turnId);
      turn.status = input.status;
      turn.assistantText = input.text;
      turn.trace = input.trace;
      turn.startedAt ||= new Date().toISOString();
      turn.completedAt = new Date().toISOString();
      turn.execution.runId = input.runId || turn.execution.runId;
      turn.execution.providerTurnId =
        input.providerTurnId || turn.execution.providerTurnId;
      const checkpoint = input.checkpoint
        ? checkpointToBinding(threadId, input.checkpoint)
        : undefined;
      if (checkpoint) replaceBinding(thread, checkpoint);
      thread.metadata = updateMetadata(thread.metadata, {
        latestPreview: input.text.slice(0, 160),
      });
      await this.repository.updateTurn(thread.metadata, turn, checkpoint);
      return threadToConversation(thread);
    });
  }

  async failTurn(
    threadId: string,
    turnId: string,
    input: {
      text: string;
      trace?: ThreadTurn["trace"];
      interrupted?: boolean;
      errorCode: string;
      errorMessage: string;
    },
  ): Promise<Conversation> {
    return this.serialize(async () => {
      const thread = await this.requireThread(threadId);
      const turn = requireTurn(thread, turnId);
      turn.status = input.interrupted ? "interrupted" : "failed";
      turn.assistantText = input.text;
      turn.trace = input.trace;
      turn.completedAt = new Date().toISOString();
      turn.error = {
        code: input.errorCode,
        message: input.errorMessage,
      };
      const binding =
        turn.execution.backendKind === "codex-cli"
          ? dirtyCodexBinding(thread)
          : undefined;
      if (binding) replaceBinding(thread, binding);
      thread.metadata = updateMetadata(thread.metadata, {
        latestPreview: input.text.slice(0, 160),
      });
      await this.repository.updateTurn(thread.metadata, turn, binding);
      return threadToConversation(thread);
    });
  }

  async recoverInFlightTurns(
    options: RecoverThreadOptions = {},
  ): Promise<void> {
    await this.initialize();
    const threads = await this.repository.listRecoverableThreads();
    for (const thread of threads) {
      for (const turn of thread.turns) {
        if (turn.status === "pending") {
          await this.recoverFailedTurn(
            thread,
            turn,
            "provider_not_started",
            "Zopilot stopped before the provider turn started.",
          );
          continue;
        }
        if (
          turn.execution.backendKind === "codex-cli" &&
          options.readCodexTurn
        ) {
          const binding = thread.bindings.find(
            (item) => item.adapterKey === CODEX_ADAPTER_KEY,
          );
          if (binding) {
            try {
              const recovered = await options.readCodexTurn(binding, turn);
              if (recovered.status !== "unknown") {
                await this.completeTurn(thread.metadata.id, turn.id, {
                  status: recovered.status,
                  text: recovered.text || turn.assistantText,
                  trace: turn.trace,
                  runId: binding.externalThreadId,
                  providerTurnId: turn.execution.providerTurnId,
                  checkpoint: {
                    adapterKey: CODEX_ADAPTER_KEY,
                    externalThreadId: binding.externalThreadId,
                    syncedThroughSequence:
                      recovered.status === "completed"
                        ? turn.sequence
                        : binding.syncedThroughSequence,
                    state: recovered.status === "completed" ? "clean" : "dirty",
                  },
                });
                continue;
              }
            } catch (error) {
              logger.warn("failed to recover Codex turn", {
                threadId: thread.metadata.id,
                turnId: turn.id,
                error: String(error),
              });
            }
          }
        }
        await this.recoverFailedTurn(
          thread,
          turn,
          "runtime_interrupted",
          "Zopilot stopped while the provider turn was running.",
          true,
        );
      }
    }
  }

  async migrateStandaloneWorkspace(
    workspace: WorkspaceIdentity,
  ): Promise<void> {
    const source = workspace.defaultSource;
    if (
      workspace.workspaceType !== "item" ||
      !source?.parentItemKey ||
      source.parentItemID === undefined
    ) {
      return;
    }
    const sourceWorkspaceKey = `item:${source.libraryID}:${source.attachmentKey}`;
    if (sourceWorkspaceKey === workspace.workspaceKey) return;
    await this.serialize(async () => {
      await this.initialize();
      const sourceThreads =
        await this.repository.listWorkspaceThreads(sourceWorkspaceKey);
      if (!sourceThreads.length) return;
      const targetThreads = await this.repository.listWorkspaceThreads(
        workspace.workspaceKey,
      );
      const completed = targetThreads.find(
        (thread) =>
          thread.metadata.migration?.kind === "standalone-pdf-merge" &&
          thread.metadata.migration.sourceWorkspaceKey === sourceWorkspaceKey &&
          thread.metadata.migration.status === "complete",
      );
      if (completed) {
        await this.repository.removeWorkspace(sourceWorkspaceKey);
        return;
      }
      for (const sourceThread of sourceThreads) {
        const backupId = `backup-${source.attachmentKey}-${sourceThread.metadata.id}`;
        if (targetThreads.some((thread) => thread.metadata.id === backupId)) {
          continue;
        }
        await this.repository.insertThread(
          cloneForWorkspace(sourceThread, workspace, backupId, {
            kind: "standalone-pdf-backup",
            sourceWorkspaceKey,
            sourceConversationId: sourceThread.metadata.id,
          }),
        );
      }
      const target = targetThreads
        .filter(
          (thread) => !thread.metadata.archived && !thread.metadata.migration,
        )
        .sort((left, right) =>
          right.metadata.updatedAt.localeCompare(left.metadata.updatedAt),
        )[0];
      const mergedId = createTimestampId("thread");
      const inputs = target ? [...sourceThreads, target] : sourceThreads;
      const merged = mergeThreads(inputs, workspace, mergedId, {
        kind: "standalone-pdf-merge",
        status: "complete",
        sourceWorkspaceKey,
        sourceConversationIds: sourceThreads.map(
          (thread) => thread.metadata.id,
        ),
        targetConversationId: target?.metadata.id,
      });
      if (target) {
        target.metadata = updateMetadata(target.metadata, { archived: true });
        await this.repository.updateMetadata(target.metadata);
      }
      await this.repository.insertThread(merged);
      await this.repository.removeWorkspace(sourceWorkspaceKey);
    });
  }

  private async initializeStore(): Promise<void> {
    await this.repository.initialize();
    if (!this.legacyReader) return;
    const entries = await this.legacyReader.readAll();
    for (const entry of entries) {
      if (
        (await this.repository.getLegacyImportStatus(entry.key)) === "imported"
      ) {
        continue;
      }
      if (entry.status === "failed") {
        logger.error("legacy conversation import failed", entry.error, {
          key: entry.key,
        });
        await this.repository.recordLegacyImport(
          entry.key,
          "failed",
          entry.error.message,
        );
        continue;
      }
      try {
        if (
          !(await this.repository.getThread(entry.conversation.metadata.id))
        ) {
          await this.repository.insertThread(
            legacyConversationToThread(entry.conversation),
          );
        }
        await this.repository.recordLegacyImport(entry.key, "imported");
      } catch (error) {
        logger.error("legacy conversation import failed", error, {
          key: entry.key,
        });
        await this.repository.recordLegacyImport(
          entry.key,
          "failed",
          String(error),
        );
      }
    }
  }

  private async listWorkspaceProjection(
    workspaceKey: string,
    archived: boolean,
  ): Promise<Conversation[]> {
    await this.initialize();
    return (await this.repository.listWorkspaceThreads(workspaceKey))
      .filter((thread) => Boolean(thread.metadata.archived) === archived)
      .filter((thread) => thread.turns.length > 0)
      .sort(byLatestUserTurn)
      .map(threadToConversation);
  }

  private async requireThread(id: string): Promise<Thread> {
    await this.initialize();
    const thread = await this.repository.getThread(id);
    if (!thread) throw new Error(`Zopilot thread is missing: ${id}`);
    return thread;
  }

  private async insertWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation> {
    const createdAt = new Date().toISOString();
    const activeSources = workspace.defaultSource
      ? [paperToThreadSource(workspace.defaultSource)]
      : [];
    const metadata: ConversationMetadata = {
      ...workspace,
      id: createTimestampId("thread"),
      scope: "workspace",
      label: defaultThreadLabel(createdAt),
      createdAt,
      updatedAt: createdAt,
      revision: 0,
      activeSources,
      primarySourceId: activeSources.at(-1)?.sourceId,
    };
    const thread: Thread = { metadata, turns: [], bindings: [] };
    await this.repository.insertThread(thread);
    return threadToConversation(thread);
  }

  private async recoverFailedTurn(
    thread: Thread,
    turn: ThreadTurn,
    code: string,
    message: string,
    interrupted = false,
  ): Promise<void> {
    await this.failTurn(thread.metadata.id, turn.id, {
      text: turn.assistantText,
      trace: turn.trace,
      interrupted,
      errorCode: code,
      errorMessage: message,
    });
  }

  private serialize<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.writeTail.then(operation, operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

let sharedStore: ThreadStore | undefined;

function getThreadStore(): ThreadStore {
  sharedStore ??= new ThreadStore();
  return sharedStore;
}

async function shutdownThreadStore(): Promise<void> {
  const store = sharedStore;
  sharedStore = undefined;
  await store?.close();
}

function buildRunInput(
  thread: Thread,
  turn: ThreadTurn,
  contextLength: number,
): ThreadRunInput {
  const history =
    turn.execution.backendKind === "codex-cli"
      ? canonicalHistory(thread, turn.sequence)
      : projectHistory(thread, turn.sequence, contextLength, turn);
  return {
    threadId: thread.metadata.id,
    turnId: turn.id,
    sequence: turn.sequence,
    prompt: turn.userText,
    history,
    context: cloneThread(turn.context),
    workspace: {
      workspaceKey: thread.metadata.workspaceKey,
      workspaceType: thread.metadata.workspaceType,
      libraryID: thread.metadata.libraryID,
      workspaceLabel: thread.metadata.workspaceLabel,
      workspaceTitle: thread.metadata.workspaceTitle,
      collectionKey: thread.metadata.collectionKey,
      collectionPath: thread.metadata.collectionPath,
      itemKey: thread.metadata.itemKey,
      defaultSource: primarySource(turn.context),
      id: thread.metadata.id,
    },
    providerProfileId: turn.execution.providerProfileId,
    model: turn.execution.model,
    reasoningEffort: turn.execution.reasoningEffort,
    binding: thread.bindings.find(
      (binding) =>
        binding.adapterKey ===
        (turn.execution.backendKind === "codex-cli"
          ? CODEX_ADAPTER_KEY
          : turn.execution.providerProfileId),
    ),
  };
}

function projectHistory(
  thread: Thread,
  currentSequence: number,
  contextLength: number,
  currentTurn: ThreadTurn,
): ThreadHistoryItem[] {
  return projectThreadHistory({
    history: canonicalHistory(thread, currentSequence),
    contextLength,
    currentInput: [
      currentTurn.userText,
      JSON.stringify(currentTurn.context.sources),
    ].join("\n"),
  });
}

function canonicalHistory(
  thread: Thread,
  beforeSequence: number,
): ThreadHistoryItem[] {
  return thread.turns
    .filter(
      (turn) =>
        turn.sequence < beforeSequence &&
        (turn.status === "completed" || turn.status === "interrupted") &&
        Boolean(turn.assistantText),
    )
    .map((turn) => ({
      sequence: turn.sequence,
      userText: turn.userText,
      assistantText: turn.assistantText,
      status: turn.status as "completed" | "interrupted",
    }));
}

function updateMetadata(
  metadata: ConversationMetadata,
  patch: Partial<ConversationMetadata>,
): ConversationMetadata {
  return {
    ...metadata,
    ...patch,
    revision: metadata.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

function refreshWorkspaceSnapshot(
  metadata: ConversationMetadata,
  workspace: WorkspaceIdentity,
): ConversationMetadata {
  const snapshot = {
    workspaceLabel: workspace.workspaceLabel,
    workspaceTitle: workspace.workspaceTitle,
    workspaceType: workspace.workspaceType,
    libraryID: workspace.libraryID,
    collectionKey: workspace.collectionKey,
    collectionPath: workspace.collectionPath,
    itemKey: workspace.itemKey,
    defaultSource:
      workspace.workspaceType === "item" ? workspace.defaultSource : undefined,
  };
  const current = {
    workspaceLabel: metadata.workspaceLabel,
    workspaceTitle: metadata.workspaceTitle,
    workspaceType: metadata.workspaceType,
    libraryID: metadata.libraryID,
    collectionKey: metadata.collectionKey,
    collectionPath: metadata.collectionPath,
    itemKey: metadata.itemKey,
    defaultSource:
      workspace.workspaceType === "item" ? metadata.defaultSource : undefined,
  };
  if (JSON.stringify(snapshot) === JSON.stringify(current)) return metadata;
  return updateMetadata(metadata, {
    ...workspace,
    defaultSource:
      workspace.workspaceType === "item" ? workspace.defaultSource : undefined,
  });
}

function accumulateSources(
  current: ThreadSource[],
  selected: ThreadSource[],
): ThreadSource[] {
  const selectedIds = new Set(selected.map((source) => source.sourceId));
  const result = current.filter((source) => !selectedIds.has(source.sourceId));
  for (const source of selected) {
    if (!result.some((item) => item.sourceId === source.sourceId)) {
      result.push(source);
    }
  }
  return result;
}

function mentionToThreadSource(mention: SourceMention): ThreadSource {
  const { id: _id, ...source } = mention;
  return source;
}

function legacyMentionToThreadSource(mention: SourceMention): ThreadSource {
  return {
    ...mentionToThreadSource(mention),
    sourceId: createSourceId(mention.libraryID, mention.attachmentKey),
  };
}

function paperToThreadSource(paper: PaperIdentity): ThreadSource {
  return {
    ...paper,
    sourceId: createSourceId(paper.libraryID, paper.attachmentKey),
  };
}

function primarySource(
  context: ThreadTurn["context"],
): WorkspaceIdentity["defaultSource"] {
  const source =
    context.sources.find((item) => item.sourceId === context.primarySourceId) ||
    context.sources.at(-1);
  if (!source) return undefined;
  const { sourceId: _sourceId, availability: _availability, ...paper } = source;
  return paper;
}

function checkpointToBinding(
  threadId: string,
  checkpoint: ProviderCheckpoint,
): ProviderBinding {
  return {
    threadId,
    adapterKey: checkpoint.adapterKey,
    externalThreadId: checkpoint.externalThreadId,
    syncedThroughSequence: checkpoint.syncedThroughSequence,
    state: checkpoint.state,
    updatedAt: new Date().toISOString(),
  };
}

function replaceBinding(thread: Thread, binding: ProviderBinding): void {
  const index = thread.bindings.findIndex(
    (item) => item.adapterKey === binding.adapterKey,
  );
  if (index < 0) thread.bindings.push(binding);
  else thread.bindings[index] = binding;
}

function dirtyCodexBinding(thread: Thread): ProviderBinding | undefined {
  const binding = thread.bindings.find(
    (item) => item.adapterKey === CODEX_ADAPTER_KEY,
  );
  return binding
    ? { ...binding, state: "dirty", updatedAt: new Date().toISOString() }
    : undefined;
}

function requireTurn(thread: Thread, id: string): ThreadTurn {
  const turn = thread.turns.find((item) => item.id === id);
  if (!turn) throw new Error(`Zopilot thread turn is missing: ${id}`);
  return turn;
}

function isTerminal(turn: ThreadTurn): boolean {
  return (
    turn.status === "completed" ||
    turn.status === "interrupted" ||
    turn.status === "failed"
  );
}

function byLatestUserTurn(left: Thread, right: Thread): number {
  const leftAt = left.turns.at(-1)?.createdAt || "";
  const rightAt = right.turns.at(-1)?.createdAt || "";
  return (
    rightAt.localeCompare(leftAt) ||
    right.metadata.createdAt.localeCompare(left.metadata.createdAt)
  );
}

function selectLatestActiveThread(threads: Thread[]): Thread | undefined {
  return threads
    .filter((thread) => !thread.metadata.archived)
    .sort((left, right) =>
      right.metadata.updatedAt.localeCompare(left.metadata.updatedAt),
    )[0];
}

function defaultThreadLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}

function legacyConversationToThread(conversation: LegacyConversation): Thread {
  const activeSources: ThreadSource[] = [];
  let primarySourceId: string | undefined;
  const turns: ThreadTurn[] = [];
  let pending:
    | {
        message: LegacyConversationMessage;
        sources: ThreadSource[];
      }
    | undefined;
  const finishPending = (
    assistant?: LegacyConversationMessage,
    incomplete = false,
  ) => {
    if (!pending && !assistant) return;
    const user = pending?.message;
    const execution = legacyExecution(
      assistant || user,
      conversation.metadata.codexThreadId,
      conversation.metadata.backendId,
      conversation.metadata.providerProfileId,
    );
    const sequence = turns.length + 1;
    const status = incomplete
      ? "failed"
      : assistant?.status === "interrupted"
        ? "interrupted"
        : assistant?.status === "error"
          ? "failed"
          : "completed";
    turns.push({
      id: `legacy-turn-${user?.id || assistant?.id || sequence}`,
      threadId: conversation.metadata.id,
      sequence,
      status,
      userMessageId: user?.id || `legacy-user-${sequence}`,
      assistantMessageId:
        assistant?.id || `legacy-assistant-${user?.id || sequence}`,
      userText: user?.text || "",
      assistantText: assistant?.text || "",
      createdAt:
        user?.createdAt ||
        assistant?.createdAt ||
        conversation.metadata.createdAt,
      startedAt: assistant?.createdAt,
      completedAt: assistant?.completedAt,
      context: {
        sources: cloneThread(activeSources),
        selectedSources: pending?.sources || [],
        primarySourceId,
        noteContexts: user?.noteContexts || [],
        localAttachments: user?.localAttachments || [],
      },
      execution,
      trace: assistant?.trace,
      error: incomplete
        ? {
            code: "legacy_incomplete_turn",
            message: "Legacy turn did not contain an assistant response.",
          }
        : undefined,
    });
    pending = undefined;
  };
  for (const message of conversation.messages) {
    if (message.role === "user") {
      if (pending) finishPending(undefined, true);
      const selected = (message.mentions || []).map(
        legacyMentionToThreadSource,
      );
      const accumulated = accumulateSources(activeSources, selected);
      activeSources.splice(0, activeSources.length, ...accumulated);
      primarySourceId =
        selected.at(-1)?.sourceId ||
        primarySourceId ||
        activeSources.at(-1)?.sourceId;
      pending = { message, sources: selected };
    } else {
      finishPending(message);
    }
  }
  if (pending) finishPending(undefined, true);
  if (!activeSources.length && conversation.metadata.defaultSource) {
    activeSources.push(
      paperToThreadSource(conversation.metadata.defaultSource),
    );
    primarySourceId = activeSources[0]?.sourceId;
  }
  const metadata: ConversationMetadata = {
    ...conversation.metadata,
    revision: 1,
    activeSources,
    primarySourceId,
  };
  const binding = conversation.metadata.codexThreadId
    ? [
        {
          threadId: metadata.id,
          adapterKey: CODEX_ADAPTER_KEY,
          externalThreadId: conversation.metadata.codexThreadId,
          syncedThroughSequence: 0,
          state: "dirty" as const,
          updatedAt: new Date().toISOString(),
        },
      ]
    : [];
  delete (metadata as ConversationMetadata & { codexThreadId?: string })
    .codexThreadId;
  delete (metadata as ConversationMetadata & { backendId?: string }).backendId;
  delete (metadata as ConversationMetadata & { providerProfileId?: string })
    .providerProfileId;
  return { metadata, turns, bindings: binding };
}

function legacyExecution(
  message: LegacyConversationMessage | undefined,
  codexThreadId: string | undefined,
  metadataBackendId: string | undefined,
  metadataProviderProfileId: string | undefined,
): ThreadTurnExecution {
  const codex = message?.backendKind === "codex-cli" || Boolean(codexThreadId);
  return {
    backendId:
      message?.backendId || metadataBackendId || (codex ? "codex" : "legacy"),
    backendKind:
      message?.backendKind || (codex ? "codex-cli" : "openai-compatible"),
    providerProfileId:
      message?.providerProfileId ||
      metadataProviderProfileId ||
      (codex ? "codex" : "legacy"),
    providerBrand: message?.providerBrand,
    model: message?.model,
    reasoningEffort: message?.reasoningEffort,
    capabilitySnapshot: message?.capabilitySnapshot as
      | ThreadTurnExecution["capabilitySnapshot"]
      | undefined,
    runId: message?.backendRunId || message?.codexThreadId,
    providerTurnId: message?.backendTurnId || message?.codexTurnId,
  };
}

function cloneForWorkspace(
  source: Thread,
  workspace: WorkspaceIdentity,
  id: string,
  migration: ConversationMetadata["migration"],
): Thread {
  return {
    metadata: {
      ...source.metadata,
      ...workspace,
      id,
      archived: true,
      migration,
      revision: source.metadata.revision + 1,
      updatedAt: new Date().toISOString(),
    },
    turns: source.turns.map((turn, index) => ({
      ...cloneThread(turn),
      id: `${id}-${turn.id}`,
      threadId: id,
      sequence: index + 1,
      userMessageId: `${id}-${turn.userMessageId}`,
      assistantMessageId: `${id}-${turn.assistantMessageId}`,
    })),
    bindings: [],
  };
}

function mergeThreads(
  sources: Thread[],
  workspace: WorkspaceIdentity,
  id: string,
  migration: ConversationMetadata["migration"],
): Thread {
  const turns = sources
    .flatMap((thread) => thread.turns)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.sequence - right.sequence,
    )
    .map((turn, index) => ({
      ...cloneThread(turn),
      id: `${id}-${turn.id}`,
      threadId: id,
      sequence: index + 1,
      userMessageId: `${id}-${turn.userMessageId}`,
      assistantMessageId: `${id}-${turn.assistantMessageId}`,
    }));
  const activeSources = sources.reduce(
    (all, thread) => accumulateSources(all, thread.metadata.activeSources),
    [] as ThreadSource[],
  );
  const createdAt =
    sources.map((thread) => thread.metadata.createdAt).sort()[0] ||
    new Date().toISOString();
  const updatedAt = new Date().toISOString();
  return {
    metadata: {
      ...workspace,
      id,
      scope: "workspace",
      label: sources.at(-1)?.metadata.label || defaultThreadLabel(createdAt),
      createdAt,
      updatedAt,
      revision: 1,
      activeSources,
      primarySourceId: activeSources.at(-1)?.sourceId,
      latestPreview: turns.at(-1)?.assistantText || turns.at(-1)?.userText,
      migration,
    },
    turns,
    bindings: [],
  };
}

export { CODEX_ADAPTER_KEY, ThreadStore, getThreadStore, shutdownThreadStore };
export type {
  BeginThreadTurnInput,
  BegunThreadTurn,
  RecoverThreadOptions,
  RecoveredCodexTurn,
};
