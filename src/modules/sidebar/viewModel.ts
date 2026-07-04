import { getString } from "../../utils/locale";
import type { Conversation } from "../../shared/conversation";
import type {
  SidebarMessageView,
  SidebarModelView,
  SidebarState,
} from "./app/types";
import { extractReaderLocators } from "./readerNavigation";

export {
  DEFAULT_MODEL,
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
};

type StreamingMessage = {
  text: string;
  interrupted: boolean;
  running: boolean;
};

const DEFAULT_MODEL: SidebarModelView = {
  slug: "gpt-5.5",
  displayName: "GPT-5.5",
  supportedReasoningEfforts: ["medium"],
  defaultReasoningEffort: "medium",
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
    models: [DEFAULT_MODEL],
    selectedModel: DEFAULT_MODEL.slug,
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: DEFAULT_MODEL.supportedReasoningEfforts,
    backendStatus: "checking",
    backendDiagnosticMessage: undefined,
    activeProviderLabel: "Codex CLI",
    focusToken: 0,
    sourceCandidates: [],
    collectionOptions: [],
    prompts: [],
  };
}

function createConversationMessages(
  conversation: Conversation,
  streaming?: StreamingMessage,
): SidebarMessageView[] {
  const messages = conversation.messages.map(toMessageView);

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
      text: streaming.text || getString("sidebar-backend-starting"),
      status: streaming.interrupted ? "interrupted" : "complete",
      transient: true,
      running: streaming.running,
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
): SidebarMessageView {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    mentions: message.mentions,
    localAttachments: message.localAttachments,
    status: message.status,
    completedAt: formatBeijingTimestamp(
      message.completedAt || message.createdAt,
    ),
    locators:
      message.role === "assistant" ? extractReaderLocators(message.text) : [],
  };
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
