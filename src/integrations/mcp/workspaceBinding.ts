import type { ThreadRunInput } from "../../domain/thread";
import type { PaperSourceRef } from "../../domain/conversation";
import type { WorkspaceQueryScope } from "../../document/types";

export {
  PAPER_BINDING_MISSING_MESSAGE,
  createPaperBindingHeaders,
  parseMcpClientCapabilities,
  parsePaperBindingHeaders,
  threadContextToWorkspaceQueryScope,
};
export type { BoundWorkspaceScope, ThreadWorkspaceBinding };

type ThreadWorkspaceBinding = Pick<ThreadRunInput, "workspace" | "context">;
type BoundWorkspaceScope = WorkspaceQueryScope;

const PAPER_BINDING_MISSING_MESSAGE =
  "This provider turn is not bound to a Zopilot paper context.";

const PAPER_BINDING_HEADERS = {
  conversationId: "X-Zopilot-Conversation-ID",
  workspaceKey: "X-Zopilot-Workspace-Key",
  workspaceType: "X-Zopilot-Workspace-Type",
  workspaceLabel: "X-Zopilot-Workspace-Label",
  collectionKey: "X-Zopilot-Collection-Key",
  collectionPath: "X-Zopilot-Collection-Path",
  itemKey: "X-Zopilot-Item-Key",
  libraryID: "X-Zopilot-Library-ID",
  sources: "X-Zopilot-Thread-Sources",
  primarySourceId: "X-Zopilot-Primary-Source-ID",
  acceptsImages: "X-Zopilot-Accepts-Images",
} as const;

function threadContextToWorkspaceQueryScope(
  binding: ThreadWorkspaceBinding,
): BoundWorkspaceScope {
  const { workspace, context } = binding;
  return {
    conversationId: workspace.id,
    workspaceKey: workspace.workspaceKey,
    workspaceType: workspace.workspaceType,
    workspaceLabel: workspace.workspaceLabel,
    libraryID: workspace.libraryID,
    collectionKey: workspace.collectionKey,
    collectionPath: workspace.collectionPath,
    itemKey: workspace.itemKey,
    sources: context.sources.map(toPaperSourceRef),
    primarySourceId: context.primarySourceId,
  };
}

function createPaperBindingHeaders(
  binding: ThreadWorkspaceBinding,
  options: { acceptsImages?: boolean } = {},
): Record<string, string> {
  const scope = threadContextToWorkspaceQueryScope(binding);
  const headers: Record<string, string> = {
    [PAPER_BINDING_HEADERS.conversationId]: scope.conversationId,
    [PAPER_BINDING_HEADERS.workspaceKey]: scope.workspaceKey,
    [PAPER_BINDING_HEADERS.workspaceType]: scope.workspaceType,
    [PAPER_BINDING_HEADERS.workspaceLabel]: scope.workspaceLabel,
    [PAPER_BINDING_HEADERS.libraryID]: String(scope.libraryID),
    [PAPER_BINDING_HEADERS.sources]: JSON.stringify(scope.sources),
    [PAPER_BINDING_HEADERS.acceptsImages]: options.acceptsImages
      ? "true"
      : "false",
  };
  if (scope.collectionKey) {
    headers[PAPER_BINDING_HEADERS.collectionKey] = scope.collectionKey;
  }
  if (scope.collectionPath?.length) {
    headers[PAPER_BINDING_HEADERS.collectionPath] = JSON.stringify(
      scope.collectionPath,
    );
  }
  if (scope.itemKey) {
    headers[PAPER_BINDING_HEADERS.itemKey] = scope.itemKey;
  }
  if (scope.primarySourceId) {
    headers[PAPER_BINDING_HEADERS.primarySourceId] = scope.primarySourceId;
  }
  return headers;
}

function parseMcpClientCapabilities(headers: Record<string, string>): {
  acceptsImages: boolean;
} {
  return {
    acceptsImages:
      readHeader(headers, PAPER_BINDING_HEADERS.acceptsImages) === "true",
  };
}

function parsePaperBindingHeaders(
  headers: Record<string, string>,
): { ok: true; value: BoundWorkspaceScope } | { ok: false; error: string } {
  const conversationId = readHeader(
    headers,
    PAPER_BINDING_HEADERS.conversationId,
  );
  const workspaceKey = readHeader(headers, PAPER_BINDING_HEADERS.workspaceKey);
  const workspaceType = readHeader(
    headers,
    PAPER_BINDING_HEADERS.workspaceType,
  );
  const workspaceLabel =
    readHeader(headers, PAPER_BINDING_HEADERS.workspaceLabel) || workspaceKey;
  const rawLibraryID = readHeader(headers, PAPER_BINDING_HEADERS.libraryID);
  const rawSources = readHeader(headers, PAPER_BINDING_HEADERS.sources);

  if (
    !conversationId ||
    !workspaceKey ||
    !workspaceType ||
    !rawLibraryID ||
    !rawSources
  ) {
    return { ok: false, error: PAPER_BINDING_MISSING_MESSAGE };
  }
  if (!isWorkspaceType(workspaceType)) {
    return {
      ok: false,
      error: `Invalid Zopilot workspace binding header: ${PAPER_BINDING_HEADERS.workspaceType}.`,
    };
  }
  const libraryID = parseIntegerHeader(
    PAPER_BINDING_HEADERS.libraryID,
    rawLibraryID,
  );
  if (!libraryID.ok) return libraryID;
  const sources = parseSources(rawSources, libraryID.value);
  if (!sources.ok) return sources;
  const primarySourceId = readHeader(
    headers,
    PAPER_BINDING_HEADERS.primarySourceId,
  );
  if (
    primarySourceId &&
    !sources.value.some((source) => source.sourceId === primarySourceId)
  ) {
    return {
      ok: false,
      error: "The Zopilot primary source is outside the current turn context.",
    };
  }

  return {
    ok: true,
    value: {
      conversationId,
      workspaceKey,
      workspaceType,
      workspaceLabel: workspaceLabel || workspaceKey,
      libraryID: libraryID.value,
      collectionKey: readHeader(headers, PAPER_BINDING_HEADERS.collectionKey),
      collectionPath: parseCollectionPath(headers),
      itemKey: readHeader(headers, PAPER_BINDING_HEADERS.itemKey),
      sources: sources.value,
      primarySourceId,
    },
  };
}

function parseSources(
  value: string,
  libraryID: number,
): { ok: true; value: PaperSourceRef[] } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (source) => isPaperSourceRef(source) && source.libraryID === libraryID,
      )
    ) {
      throw new Error("invalid source snapshot");
    }
    const sources = parsed as PaperSourceRef[];
    if (
      new Set(sources.map((source) => source.sourceId)).size !== sources.length
    ) {
      throw new Error("duplicate source");
    }
    return { ok: true, value: sources };
  } catch {
    return {
      ok: false,
      error: "Invalid Zopilot thread source binding.",
    };
  }
}

function isPaperSourceRef(value: unknown): value is PaperSourceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.sourceId === "string" &&
    typeof source.paperKey === "string" &&
    typeof source.libraryID === "number" &&
    typeof source.attachmentItemID === "number" &&
    typeof source.attachmentKey === "string" &&
    typeof source.title === "string" &&
    (source.parentItemID === undefined ||
      typeof source.parentItemID === "number") &&
    (source.parentItemKey === undefined ||
      typeof source.parentItemKey === "string")
  );
}

function toPaperSourceRef(
  source: ThreadRunInput["context"]["sources"][number],
): PaperSourceRef {
  const { availability: _availability, ...reference } = source;
  return reference;
}

function parseCollectionPath(
  headers: Record<string, string>,
): string[] | undefined {
  const raw = readHeader(headers, PAPER_BINDING_HEADERS.collectionPath);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function isWorkspaceType(
  value: string,
): value is BoundWorkspaceScope["workspaceType"] {
  return value === "item" || value === "collection" || value === "library";
}

function parseIntegerHeader(
  name: string,
  value: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? { ok: true, value: parsed }
    : {
        ok: false,
        error: `Invalid Zopilot paper binding header: ${name}.`,
      };
}

function readHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct.trim() || undefined;
  const foundKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = foundKey ? headers[foundKey] : undefined;
  return value?.trim() || undefined;
}
