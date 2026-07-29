import type {
  ConversationMetadata,
  LocalAttachmentRef,
  NoteContextRef,
  PaperIdentity,
  ThreadSource,
} from "../../../domain/conversation";
import { isProviderBrand } from "../../../domain/agent/providerBrand";
import { isAgentTraceItem } from "../../../domain/agent/trace";
import type {
  ProviderBinding,
  ThreadContextSnapshot,
  ThreadTurn,
} from "../../../domain/thread";
import { isRecord } from "../../json/guards";

function parseThreadMetadata(
  value: unknown,
  source: string,
): ConversationMetadata {
  if (!isRecord(value) || !isWorkspace(value)) {
    throw new Error(`Invalid Zopilot thread metadata in ${source}.`);
  }
  if (
    typeof value.id !== "string" ||
    value.scope !== "workspace" ||
    typeof value.label !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Number.isInteger(value.revision) ||
    !Array.isArray(value.activeSources) ||
    !value.activeSources.every(isThreadSource) ||
    !optionalString(value.primarySourceId) ||
    !optionalString(value.latestPreview) ||
    !optionalBoolean(value.archived)
  ) {
    throw new Error(`Invalid Zopilot thread metadata in ${source}.`);
  }
  return value as unknown as ConversationMetadata;
}

function parseThreadTurn(value: unknown, source: string): ThreadTurn {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.threadId !== "string" ||
    !Number.isInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !isTurnStatus(value.status) ||
    typeof value.userMessageId !== "string" ||
    typeof value.assistantMessageId !== "string" ||
    typeof value.userText !== "string" ||
    typeof value.assistantText !== "string" ||
    typeof value.createdAt !== "string" ||
    !optionalString(value.startedAt) ||
    !optionalString(value.completedAt) ||
    !isThreadContext(value.context) ||
    !isTurnExecution(value.execution) ||
    (value.trace !== undefined &&
      (!Array.isArray(value.trace) || !value.trace.every(isAgentTraceItem))) ||
    (value.error !== undefined && !isTurnError(value.error))
  ) {
    throw new Error(`Invalid Zopilot thread turn in ${source}.`);
  }
  return value as unknown as ThreadTurn;
}

function parseProviderBinding(value: unknown, source: string): ProviderBinding {
  if (
    !isRecord(value) ||
    typeof value.threadId !== "string" ||
    typeof value.adapterKey !== "string" ||
    typeof value.externalThreadId !== "string" ||
    !Number.isInteger(value.syncedThroughSequence) ||
    Number(value.syncedThroughSequence) < 0 ||
    (value.state !== "clean" && value.state !== "dirty") ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error(`Invalid Zopilot provider binding in ${source}.`);
  }
  return value as unknown as ProviderBinding;
}

function isWorkspace(value: Record<string, unknown>): boolean {
  return (
    typeof value.workspaceKey === "string" &&
    (value.workspaceType === "item" ||
      value.workspaceType === "collection" ||
      value.workspaceType === "library") &&
    typeof value.workspaceLabel === "string" &&
    typeof value.workspaceTitle === "string" &&
    typeof value.libraryID === "number" &&
    optionalString(value.collectionKey) &&
    (value.collectionPath === undefined ||
      (Array.isArray(value.collectionPath) &&
        value.collectionPath.every((item) => typeof item === "string"))) &&
    optionalString(value.itemKey) &&
    (value.defaultSource === undefined || isPaperIdentity(value.defaultSource))
  );
}

function isThreadContext(value: unknown): value is ThreadContextSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.sources) &&
    value.sources.every(isThreadSource) &&
    Array.isArray(value.selectedSources) &&
    value.selectedSources.every(isThreadSource) &&
    optionalString(value.primarySourceId) &&
    Array.isArray(value.noteContexts) &&
    value.noteContexts.every(isNoteContext) &&
    Array.isArray(value.localAttachments) &&
    value.localAttachments.every(isLocalAttachment)
  );
}

function isTurnExecution(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.backendId === "string" &&
    (value.backendKind === "codex-cli" ||
      value.backendKind === "openai-compatible") &&
    typeof value.providerProfileId === "string" &&
    (value.providerBrand === undefined ||
      isProviderBrand(value.providerBrand)) &&
    optionalString(value.model) &&
    optionalString(value.reasoningEffort) &&
    optionalString(value.runId) &&
    optionalString(value.providerTurnId) &&
    (value.capabilitySnapshot === undefined ||
      (isRecord(value.capabilitySnapshot) &&
        Object.values(value.capabilitySnapshot).every(
          (item) => typeof item === "boolean",
        )))
  );
}

function isTurnError(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

function isTurnStatus(value: unknown): boolean {
  return (
    value === "pending" ||
    value === "running" ||
    value === "completed" ||
    value === "interrupted" ||
    value === "failed"
  );
}

function isThreadSource(value: unknown): value is ThreadSource {
  return (
    isRecord(value) &&
    typeof value.sourceId === "string" &&
    typeof value.paperKey === "string" &&
    typeof value.libraryID === "number" &&
    isParentReference(value.parentItemID, value.parentItemKey) &&
    typeof value.attachmentItemID === "number" &&
    typeof value.attachmentKey === "string" &&
    typeof value.title === "string" &&
    (value.availability === undefined ||
      value.availability === "available" ||
      value.availability === "unavailable")
  );
}

function isPaperIdentity(value: unknown): value is PaperIdentity {
  return (
    isRecord(value) &&
    typeof value.paperKey === "string" &&
    typeof value.libraryID === "number" &&
    isParentReference(value.parentItemID, value.parentItemKey) &&
    typeof value.attachmentItemID === "number" &&
    typeof value.attachmentKey === "string" &&
    typeof value.title === "string"
  );
}

function isNoteContext(value: unknown): value is NoteContextRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.libraryID === "number" &&
    isParentReference(value.parentItemID, value.parentItemKey) &&
    typeof value.noteItemID === "number" &&
    typeof value.noteItemKey === "string" &&
    typeof value.title === "string" &&
    typeof value.dateModified === "string"
  );
}

function isLocalAttachment(value: unknown): value is LocalAttachmentRef {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    typeof value.filename === "string" &&
    (value.kind === "pdf" || value.kind === "image") &&
    optionalString(value.mimeType)
  );
}

function isParentReference(
  parentItemID: unknown,
  parentItemKey: unknown,
): boolean {
  if (parentItemID === undefined && parentItemKey === undefined) return true;
  return (
    (parentItemID === undefined || typeof parentItemID === "number") &&
    typeof parentItemKey === "string"
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

export {
  isThreadSource,
  parseProviderBinding,
  parseThreadMetadata,
  parseThreadTurn,
};
