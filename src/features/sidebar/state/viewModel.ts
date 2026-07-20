import { CODEX_PROVIDER_ID } from "../../../domain/agent/modelCatalog";
import type { Conversation } from "../../../domain/conversation";
import type {
  SidebarMessageView,
  SidebarModelView,
  SidebarState,
} from "../ui/types";
import { resolveProviderBrand } from "../../../domain/agent/providerBrand";

export {
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
  resolveModelDisplayName,
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
    itemContextTree: undefined,
    libraryItemCount: 0,
    collectionOptions: [],
    prompts: [],
    reloading: false,
  };
}

function createConversationMessages(
  conversation: Conversation,
  models: SidebarModelView[] = [],
): SidebarMessageView[] {
  let lastUserCreatedAt: string | undefined;
  const messages = conversation.messages.map((message) => {
    if (message.role === "user") {
      lastUserCreatedAt = message.createdAt;
    }
    return toMessageView(message, lastUserCreatedAt, models);
  });

  return messages;
}

function createSessionView(
  conversation: Conversation,
  activeConversationId?: string,
): SidebarState["sessions"][number] {
  return {
    id: conversation.metadata.id,
    title: getSessionTitle(conversation),
    meta: getLastUserMessageAt(conversation),
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
    noteContexts: message.noteContexts,
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

function getSessionTitle(conversation: Conversation): string {
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user",
  );
  const userText = firstUserMessage
    ? stripSessionContext(firstUserMessage, conversation)
    : "";
  return truncateLabel(
    firstUserMessage
      ? userText || "Use the selected context."
      : conversation.metadata.label || conversation.metadata.createdAt,
    54,
  );
}

function getLastUserMessageAt(conversation: Conversation): string {
  const lastUserMessage = conversation.messages.findLast(
    (message) => message.role === "user",
  );
  return lastUserMessage?.createdAt || conversation.metadata.createdAt;
}

function stripSessionContext(
  message: Conversation["messages"][number],
  conversation: Conversation,
): string {
  let text = message.text;
  const contextLabels = [
    ...(message.mentions || []).map((mention) => mention.title),
    ...(message.noteContexts || []).map((note) => note.title),
    ...(message.localAttachments || []).map(
      (attachment) => attachment.filename,
    ),
    conversation.metadata.defaultSource?.title,
  ].filter((label): label is string => Boolean(label?.trim()));

  for (const label of new Set(contextLabels)) {
    const escaped = escapeRegExp(label.trim());
    text = text
      .replace(new RegExp(`@\\s*${escaped}`, "giu"), " ")
      .replace(
        new RegExp(`\\[(?:附件|attachment)\\s*[:：]\\s*${escaped}\\]`, "giu"),
        " ",
      );
  }
  return text.replace(/\s+/g, " ").trim();
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
