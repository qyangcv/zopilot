import type { PaperIdentity } from "../../../domain/conversation";
import type {
  LegacyConversationMessage,
  LegacyConversationMetadata,
  LegacyPaperConversationMetadata,
} from "./legacyTypes";
import { createLogger } from "../../logging/logger";
import { isAgentTraceItem } from "../../../domain/agent/trace";
import { isProviderBrand } from "../../../domain/agent/providerBrand";

export {
  isConversationMetadata,
  parseConversationMessage,
  parseConversationMetadata,
};

const logger = createLogger("store.conversation");

function isConversationMetadata(
  value: unknown,
): value is LegacyConversationMetadata {
  const item = value as Partial<LegacyConversationMetadata>;
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

function parseConversationMetadata(
  value: unknown,
): LegacyConversationMetadata | undefined {
  if (isConversationMetadata(value)) return value;
  if (!isPaperConversationMetadata(value)) return undefined;
  return {
    workspaceKey: `item:${value.paperKey}`,
    workspaceType: "item",
    libraryID: value.libraryID,
    workspaceLabel: value.title,
    workspaceTitle: value.title,
    itemKey: value.parentItemKey || value.attachmentKey,
    defaultSource: {
      paperKey: value.paperKey,
      libraryID: value.libraryID,
      parentItemID: value.parentItemID,
      parentItemKey: value.parentItemKey,
      attachmentItemID: value.attachmentItemID,
      attachmentKey: value.attachmentKey,
      title: value.title,
    },
    id: value.id,
    scope: "workspace",
    label: value.label,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    latestPreview: value.latestPreview,
    archived: value.archived,
    codexThreadId: value.codexThreadId,
    backendId: value.backendId,
    providerProfileId: value.providerProfileId,
  };
}

function isPaperConversationMetadata(
  value: unknown,
): value is LegacyPaperConversationMetadata {
  const item = value as Partial<LegacyPaperConversationMetadata>;
  return (
    Boolean(item) &&
    item.scope === "paper" &&
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    isPaperIdentity(value) &&
    (item.latestPreview === undefined ||
      typeof item.latestPreview === "string") &&
    (item.archived === undefined || typeof item.archived === "boolean") &&
    (item.codexThreadId === undefined ||
      typeof item.codexThreadId === "string") &&
    (item.backendId === undefined || typeof item.backendId === "string") &&
    (item.providerProfileId === undefined ||
      typeof item.providerProfileId === "string")
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

function isConversationMessage(
  value: unknown,
): value is LegacyConversationMessage {
  const item = value as Partial<LegacyConversationMessage>;
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
    availability?: unknown;
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
    typeof item.title === "string" &&
    (item.availability === undefined ||
      item.availability === "available" ||
      item.availability === "unavailable")
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
): LegacyConversationMessage {
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
