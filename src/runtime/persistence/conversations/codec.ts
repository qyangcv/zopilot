import type {
  ConversationMessage,
  ConversationMetadata,
  PaperIdentity,
} from "../../../domain/conversation";
import { createLogger } from "../../logging/logger";
import { isAgentTraceItem } from "../../../domain/agent/trace";
import { isProviderBrand } from "../../../domain/agent/providerBrand";

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
    (item.defaultSource === undefined || isPaperIdentity(item.defaultSource)) &&
    (item.migration === undefined || isConversationMigration(item.migration)) &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isConversationMigration(value: unknown): boolean {
  const item = value as {
    kind?: unknown;
    status?: unknown;
    sourceWorkspaceKey?: unknown;
    sourceConversationIds?: unknown;
    sourceConversationId?: unknown;
    targetConversationId?: unknown;
  };
  if (item?.kind === "standalone-pdf-backup") {
    return (
      typeof item.sourceWorkspaceKey === "string" &&
      typeof item.sourceConversationId === "string"
    );
  }
  return (
    Boolean(item) &&
    item.kind === "standalone-pdf-merge" &&
    (item.status === "prepared" || item.status === "complete") &&
    typeof item.sourceWorkspaceKey === "string" &&
    Array.isArray(item.sourceConversationIds) &&
    item.sourceConversationIds.every((id) => typeof id === "string") &&
    (item.targetConversationId === undefined ||
      typeof item.targetConversationId === "string")
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
    (item.noteContexts === undefined ||
      (Array.isArray(item.noteContexts) &&
        item.noteContexts.every((note) => isNoteContextRef(note)))) &&
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
    (item.providerBrand === undefined || isProviderBrand(item.providerBrand)) &&
    (item.backendRunId === undefined ||
      typeof item.backendRunId === "string") &&
    (item.backendTurnId === undefined ||
      typeof item.backendTurnId === "string") &&
    (item.capabilitySnapshot === undefined ||
      (item.capabilitySnapshot !== null &&
        typeof item.capabilitySnapshot === "object" &&
        !Array.isArray(item.capabilitySnapshot))) &&
    (item.trace === undefined ||
      (Array.isArray(item.trace) && item.trace.every(isAgentTraceItem)))
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
    isParentReference(item.parentItemID, item.parentItemKey) &&
    typeof item.attachmentItemID === "number" &&
    typeof item.attachmentKey === "string" &&
    typeof item.title === "string"
  );
}

function isPaperIdentity(value: unknown): value is PaperIdentity {
  const item = value as Partial<Record<keyof PaperIdentity, unknown>>;
  return (
    Boolean(item) &&
    typeof item.paperKey === "string" &&
    typeof item.libraryID === "number" &&
    isParentReference(item.parentItemID, item.parentItemKey) &&
    typeof item.attachmentItemID === "number" &&
    typeof item.attachmentKey === "string" &&
    typeof item.title === "string"
  );
}

function isParentReference(
  parentItemID: unknown,
  parentItemKey: unknown,
): boolean {
  if (parentItemID === undefined && parentItemKey === undefined) {
    return true;
  }
  return (
    (parentItemID === undefined || typeof parentItemID === "number") &&
    typeof parentItemKey === "string"
  );
}

function isNoteContextRef(value: unknown): boolean {
  const item = value as {
    id?: unknown;
    libraryID?: unknown;
    parentItemID?: unknown;
    parentItemKey?: unknown;
    noteItemID?: unknown;
    noteItemKey?: unknown;
    title?: unknown;
    dateModified?: unknown;
  };
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.libraryID === "number" &&
    ((item.parentItemKey === undefined && item.parentItemID === undefined) ||
      (typeof item.parentItemKey === "string" &&
        (item.parentItemID === undefined ||
          typeof item.parentItemID === "number"))) &&
    typeof item.noteItemID === "number" &&
    typeof item.noteItemKey === "string" &&
    typeof item.title === "string" &&
    typeof item.dateModified === "string"
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
