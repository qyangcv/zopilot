import { CODEX_PROVIDER_ID } from "../../../domain/agent/modelCatalog";
import type { Conversation } from "../../../domain/conversation";
import type {
  SidebarMessageView,
  SidebarModelView,
  SidebarState,
} from "../ui/types";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import {
  resolveProviderBrand,
  type ProviderBrand,
} from "../../../domain/agent/providerBrand";

export {
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
};

type StreamingMessage = {
  text: string;
  trace: AgentTraceItem[];
  finalStarted: boolean;
  interrupted: boolean;
  running: boolean;
  model?: string;
  providerProfileId?: string;
  providerBrand?: ProviderBrand;
};

function createInitialSidebarState(label: string): SidebarState {
  return {
    title: label,
    context: { label },
    messages: [],
    sessions: [],
    sessionsOpen: false,
    sessionsMode: "history",
    composerEnabled: false,
    busy: false,
    models: [],
    selectedProviderId: CODEX_PROVIDER_ID,
    selectedModel: "",
    selectedReasoningEffort: undefined,
    availableReasoningEfforts: [],
    backendStatus: "idle",
    backendDiagnosticMessage: undefined,
    activeProviderLabel: "Codex CLI",
    focusToken: 0,
    sourceCandidates: [],
    libraryItemCount: 0,
    collectionOptions: [],
    prompts: [],
  };
}

function createConversationMessages(
  conversation: Conversation,
  streaming?: StreamingMessage,
  models: SidebarModelView[] = [],
): SidebarMessageView[] {
  let lastUserCreatedAt: string | undefined;
  const messages = conversation.messages.map((message) => {
    if (message.role === "user") {
      lastUserCreatedAt = message.createdAt;
    }
    return toMessageView(message, lastUserCreatedAt, models);
  });

  if (!streaming) {
    return messages;
  }

  return [
    ...messages.filter(
      (message) =>
        message.id !== getStreamingMessageId(conversation.metadata.id),
    ),
    {
      id: getStreamingMessageId(conversation.metadata.id),
      role: "assistant",
      text: streaming.text,
      trace: streaming.trace,
      finalStarted: streaming.finalStarted,
      status: streaming.interrupted ? "interrupted" : "complete",
      transient: true,
      running: streaming.running,
      model: resolveModelDisplayName(
        models,
        streaming.model,
        streaming.providerProfileId,
      ),
      providerBrand: streaming.providerBrand,
    },
  ];
}

function createSessionView(
  conversation: Conversation,
  activeConversationId?: string,
): SidebarState["sessions"][number] {
  return {
    id: conversation.metadata.id,
    title: getSessionTitle(conversation),
    meta: formatSessionMeta(conversation),
    active: activeConversationId === conversation.metadata.id,
    conversation,
  };
}

function toMessageView(
  message: Conversation["messages"][number],
  userCreatedAt?: string,
  models: SidebarModelView[] = [],
): SidebarMessageView {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    mentions: message.mentions,
    localAttachments: message.localAttachments,
    status: message.status,
    model: resolveModelDisplayName(
      models,
      message.model,
      message.providerProfileId,
    ),
    providerBrand:
      message.providerBrand ||
      resolveProviderBrand({ kind: message.backendKind }),
    trace: message.trace,
    completedAt: formatBeijingTimestamp(
      message.completedAt || message.createdAt,
    ),
    responseDuration:
      message.role === "assistant" && message.completedAt && userCreatedAt
        ? formatResponseDuration(userCreatedAt, message.completedAt)
        : undefined,
  };
}

function resolveModelDisplayName(
  models: SidebarModelView[],
  model?: string,
  providerProfileId?: string,
): string | undefined {
  if (!model) return undefined;
  const match = models.find(
    (candidate) =>
      candidate.slug === model &&
      (!providerProfileId || candidate.providerProfileId === providerProfileId),
  );
  return match?.displayName || model;
}

function formatResponseDuration(
  startedAt: string,
  completedAt: string,
): string | undefined {
  const durationMs =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}min ${seconds}s` : `${seconds}s`;
}

function getStreamingMessageId(conversationId: string): string {
  return `zp-streaming-assistant-${conversationId}`;
}

function getSessionTitle(conversation: Conversation): string {
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user",
  );
  return truncateLabel(
    firstUserMessage?.text ||
      conversation.metadata.label ||
      conversation.metadata.createdAt,
    54,
  );
}

function formatSessionMeta(conversation: Conversation): string {
  const preview = conversation.metadata.latestPreview?.trim();
  if (preview) {
    return truncateLabel(preview, 72);
  }
  return new Date(conversation.metadata.createdAt).toLocaleString();
}

function formatBeijingTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return (
    [
      beijing.getUTCFullYear(),
      pad2(beijing.getUTCMonth() + 1),
      pad2(beijing.getUTCDate()),
    ].join("-") +
    ` ${pad2(beijing.getUTCHours())}:${pad2(beijing.getUTCMinutes())}`
  );
}

function truncateLabel(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
