import type {
  ConversationMessage,
  ConversationMetadata,
} from "../../../domain/conversation";
import { createLogger } from "../../logging/logger";

export { isConversationMetadata, parseConversationMessage };

const logger = createLogger("store.conversation");

function isConversationMetadata(value: unknown): value is ConversationMetadata {
  const item = value as Partial<ConversationMetadata>;
  return (
    Boolean(item) &&
    item.scope === "workspace" &&
    typeof item.id === "string" &&
    typeof item.workspaceKey === "string" &&
    (item.workspaceType === "item" ||
      item.workspaceType === "collection" ||
      item.workspaceType === "library") &&
    typeof item.workspaceLabel === "string" &&
    typeof item.workspaceTitle === "string" &&
    typeof item.libraryID === "number" &&
    (item.collectionKey === undefined ||
      typeof item.collectionKey === "string") &&
    (item.collectionPath === undefined ||
      (Array.isArray(item.collectionPath) &&
        item.collectionPath.every((entry) => typeof entry === "string"))) &&
    (item.itemKey === undefined || typeof item.itemKey === "string") &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  const item = value as Partial<ConversationMessage>;
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.conversationId === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.text === "string" &&
    typeof item.createdAt === "string" &&
    (item.status === "complete" ||
      item.status === "error" ||
      item.status === "interrupted") &&
    (item.mentions === undefined ||
      (Array.isArray(item.mentions) &&
        item.mentions.every((mention) => isSourceMention(mention)))) &&
    (item.localAttachments === undefined ||
      (Array.isArray(item.localAttachments) &&
        item.localAttachments.every((attachment) =>
          isLocalAttachmentRef(attachment),
        ))) &&
    (item.backendId === undefined || typeof item.backendId === "string") &&
    (item.backendKind === undefined ||
      item.backendKind === "codex-cli" ||
      item.backendKind === "openai-compatible") &&
    (item.providerProfileId === undefined ||
      typeof item.providerProfileId === "string") &&
    (item.backendRunId === undefined ||
      typeof item.backendRunId === "string") &&
    (item.backendTurnId === undefined ||
      typeof item.backendTurnId === "string") &&
    (item.capabilitySnapshot === undefined ||
      (item.capabilitySnapshot !== null &&
        typeof item.capabilitySnapshot === "object" &&
        !Array.isArray(item.capabilitySnapshot)))
  );
}

function isSourceMention(value: unknown): boolean {
  const item = value as {
    id?: unknown;
    sourceId?: unknown;
    paperKey?: unknown;
    libraryID?: unknown;
    parentItemID?: unknown;
    parentItemKey?: unknown;
    attachmentItemID?: unknown;
    attachmentKey?: unknown;
    title?: unknown;
  };
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.sourceId === "string" &&
    typeof item.paperKey === "string" &&
    typeof item.libraryID === "number" &&
    (item.parentItemID === undefined ||
      typeof item.parentItemID === "number") &&
    typeof item.parentItemKey === "string" &&
    typeof item.attachmentItemID === "number" &&
    typeof item.attachmentKey === "string" &&
    typeof item.title === "string"
  );
}

function isLocalAttachmentRef(value: unknown): boolean {
  const item = value as {
    id?: unknown;
    path?: unknown;
    filename?: unknown;
    kind?: unknown;
    mimeType?: unknown;
  };
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    typeof item.filename === "string" &&
    (item.kind === "pdf" || item.kind === "image") &&
    (item.mimeType === undefined || typeof item.mimeType === "string")
  );
}

function parseConversationMessage(
  line: string,
  path: string,
): ConversationMessage {
  let raw: unknown;
  try {
    raw = JSON.parse(line) as unknown;
  } catch (error) {
    logger.error("failed to parse conversation message", error, {
      path,
      lineLength: line.length,
    });
    throw error;
  }
  if (!isConversationMessage(raw)) {
    const error = new Error(`Invalid Zopilot conversation message: ${path}`);
    logger.error("invalid conversation message", error, {
      path,
      lineLength: line.length,
    });
    throw error;
  }
  return raw;
}
