import type {
  Conversation,
  ConversationMessage,
  ConversationMetadata,
  LocalAttachmentRef,
  NoteContextRef,
  SourceMention,
  ThreadSource,
  WorkspaceIdentity,
} from "./conversation";
import type { AgentBackendKind, AgentCapabilities } from "./agent/types";
import type { ProviderBrand } from "./agent/providerBrand";
import type { AgentTraceItem } from "./agent/trace";

type ThreadTurnStatus =
  | "pending"
  | "running"
  | "completed"
  | "interrupted"
  | "failed";

type ThreadContextSnapshot = {
  sources: ThreadSource[];
  selectedSources: ThreadSource[];
  primarySourceId?: string;
  noteContexts: NoteContextRef[];
  localAttachments: LocalAttachmentRef[];
};

type ThreadTurnExecution = {
  backendId: string;
  backendKind: AgentBackendKind;
  providerProfileId: string;
  providerBrand?: ProviderBrand;
  model?: string;
  reasoningEffort?: string;
  capabilitySnapshot?: AgentCapabilities;
  runId?: string;
  providerTurnId?: string;
};

type ThreadTurn = {
  id: string;
  threadId: string;
  sequence: number;
  status: ThreadTurnStatus;
  userMessageId: string;
  assistantMessageId: string;
  userText: string;
  assistantText: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  context: ThreadContextSnapshot;
  execution: ThreadTurnExecution;
  trace?: AgentTraceItem[];
  error?: {
    code: string;
    message: string;
  };
};

type ProviderBindingState = "clean" | "dirty";

type ProviderBinding = {
  threadId: string;
  adapterKey: string;
  externalThreadId: string;
  syncedThroughSequence: number;
  state: ProviderBindingState;
  updatedAt: string;
};

type Thread = {
  metadata: ConversationMetadata;
  turns: ThreadTurn[];
  bindings: ProviderBinding[];
};

type ThreadHistoryItem = {
  sequence: number;
  userText: string;
  assistantText: string;
  status: Extract<ThreadTurnStatus, "completed" | "interrupted">;
};

type ThreadRunInput = {
  threadId: string;
  turnId: string;
  sequence: number;
  prompt: string;
  history: ThreadHistoryItem[];
  context: ThreadContextSnapshot;
  workspace: WorkspaceIdentity & { id: string };
  providerProfileId: string;
  model?: string;
  reasoningEffort?: string;
  binding?: ProviderBinding;
};

type ProviderCheckpoint = {
  adapterKey: string;
  externalThreadId: string;
  syncedThroughSequence: number;
  state: ProviderBindingState;
};

type ProviderRunRef = {
  runId: string;
  turnId?: string;
};

function threadToConversation(thread: Thread): Conversation {
  const messages = thread.turns.flatMap(turnToMessages);
  return {
    metadata: {
      ...thread.metadata,
      activeSources: thread.metadata.activeSources.map((source) => ({
        ...source,
      })),
    },
    messages,
  };
}

function turnToMessages(turn: ThreadTurn): ConversationMessage[] {
  const user: ConversationMessage = {
    id: turn.userMessageId,
    conversationId: turn.threadId,
    role: "user",
    text: turn.userText,
    createdAt: turn.createdAt,
    status: "complete",
    mentions: turn.context.selectedSources.length
      ? turn.context.selectedSources.map((source) =>
          sourceToMention(source, turn.id),
        )
      : undefined,
    noteContexts: turn.context.noteContexts.length
      ? turn.context.noteContexts
      : undefined,
    localAttachments: turn.context.localAttachments.length
      ? turn.context.localAttachments
      : undefined,
  };
  if (turn.status === "pending" || turn.status === "running") {
    return [user];
  }
  const assistant: ConversationMessage = {
    id: turn.assistantMessageId,
    conversationId: turn.threadId,
    role: "assistant",
    text: turn.assistantText || turn.error?.message || "",
    createdAt: turn.startedAt || turn.createdAt,
    completedAt: turn.completedAt,
    backendId: turn.execution.backendId,
    backendKind: turn.execution.backendKind,
    providerProfileId: turn.execution.providerProfileId,
    providerBrand: turn.execution.providerBrand,
    capabilitySnapshot: turn.execution.capabilitySnapshot,
    status:
      turn.status === "completed"
        ? "complete"
        : turn.status === "interrupted"
          ? "interrupted"
          : "error",
    model: turn.execution.model,
    reasoningEffort: turn.execution.reasoningEffort,
    trace: turn.trace,
  };
  return [user, assistant];
}

function sourceToMention(source: ThreadSource, turnId: string): SourceMention {
  return {
    ...source,
    id: `mention-${turnId}-${source.sourceId}`,
  };
}

function cloneThread<Value>(value: Value): Value {
  // Thread state is deliberately JSON-safe because the same values cross the
  // SQLite codec boundary. Zotero's add-on sandbox does not expose the
  // structuredClone global even though it exists in current Node runtimes.
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as Value;
}

export { cloneThread, sourceToMention, threadToConversation, turnToMessages };
export type {
  ProviderBinding,
  ProviderBindingState,
  ProviderCheckpoint,
  ProviderRunRef,
  Thread,
  ThreadContextSnapshot,
  ThreadHistoryItem,
  ThreadRunInput,
  ThreadTurn,
  ThreadTurnExecution,
  ThreadTurnStatus,
};
