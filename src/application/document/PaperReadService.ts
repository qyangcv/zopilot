import type {
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../domain/conversation";
import { MAX_SELECTED_CONTEXTS } from "../../domain/contextSelection";
import { createSourceId } from "../../domain/sourceIdentity";
import type {
  BuiltContext,
  ContextEvidence,
  WorkspaceQueryScope,
} from "../../document/types";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import { throwIfAborted } from "../../runtime/cancellation";
import { ZoteroSourceUniverse } from "../../integrations/zotero/ZoteroWorkspaceService";
import {
  DocumentContextBuilder,
  formatContextForTool,
} from "./DocumentContextBuilder";

export {
  PaperReadService,
  type PaperReadBusinessResult,
  type PaperReadInput,
  type PaperReadServiceContext,
  type PaperReadStructuredResult,
};

type PaperReadInput = {
  question?: string;
  sourceIds?: string[];
};

type PaperReadServiceContext = {
  workspaceScope?: WorkspaceQueryScope;
  bindingError?: string;
  acceptsImages: boolean;
};

type PaperReadStructuredResult = {
  status: BuiltContext["status"] | "invalid_source";
  workspace?: BuiltContext["workspace"];
  sources: Array<{ sourceId: string; title: string }>;
  evidence: Array<{
    sourceId: string;
    page?: number;
    label?: string;
    section: string[];
  }>;
  warnings: string[];
  images: Array<{ sourceId: string; page?: number; mimeType: "image/png" }>;
};

type PaperReadBusinessResult = {
  text: string;
  isError: boolean;
  structuredContent: PaperReadStructuredResult;
  images: Array<{
    sourceId: string;
    page?: number;
    path: string;
    mimeType: "image/png";
  }>;
};

type PaperSourceUniverse = Pick<
  ZoteroSourceUniverse,
  "resolveSelectedPdfSources" | "resolveSources"
>;

type PaperReadServiceOptions = {
  contextBuilder?: {
    build(input: {
      scope?: WorkspaceQueryScope;
      bindingError?: string;
      question?: string;
      sources?: PaperSourceRef[];
      signal?: AbortSignal;
    }): Promise<BuiltContext>;
  };
  sourceUniverse?: PaperSourceUniverse;
  logger?: (message: string, details?: JsonValue) => void;
};

const paperReadLogger = createLogger("application.document.paperRead");

class PaperReadService {
  private contextBuilder?: DocumentContextBuilder;
  private sourceUniverse?: PaperSourceUniverse;

  constructor(private readonly options: PaperReadServiceOptions = {}) {}

  async read(
    input: PaperReadInput,
    context: PaperReadServiceContext,
    signal?: AbortSignal,
  ): Promise<PaperReadBusinessResult> {
    throwIfAborted(signal);
    const startedAt = Date.now();
    const logger =
      this.options.logger ||
      ((message, details) => paperReadLogger.debug(message, details));
    logger("paper_read.start", {
      hasQuestion: Boolean(input.question),
      hasWorkspaceBinding: Boolean(context.workspaceScope),
      selectedSourceCount: input.sourceIds?.length || 0,
      acceptsImages: context.acceptsImages,
    });

    const sourceSelection = context.workspaceScope
      ? await resolveSourceSelection(
          context.workspaceScope,
          input.sourceIds,
          () => this.getSourceUniverse(),
          signal,
        )
      : {
          ok: true as const,
          sources: undefined,
          scope: context.workspaceScope,
        };
    if (!sourceSelection.ok) {
      return {
        text: sourceSelection.error,
        isError: true,
        images: [],
        structuredContent: {
          status: "invalid_source",
          sources: [],
          evidence: [],
          warnings: [sourceSelection.error],
          images: [],
        },
      };
    }

    throwIfAborted(signal);
    const output = await this.getContextBuilder().build({
      scope: sourceSelection.scope,
      bindingError: context.bindingError,
      question: input.question,
      sources: sourceSelection.sources,
      signal,
    });
    const images = selectEvidenceImages(output, context.acceptsImages);
    const structuredContent = buildStructuredResult(output, images);
    logger("paper_read.finish", {
      status: output.status,
      evidenceCount: output.evidence.length,
      imageCount: images.length,
      durationMs: Date.now() - startedAt,
    });
    return {
      text: formatContextForTool(output),
      isError:
        output.status === "not_bound" ||
        output.status === "no_source" ||
        output.status === "material_error",
      structuredContent,
      images,
    };
  }

  private getContextBuilder() {
    if (this.options.contextBuilder) return this.options.contextBuilder;
    this.contextBuilder ??= new DocumentContextBuilder();
    return this.contextBuilder;
  }

  private getSourceUniverse(): PaperSourceUniverse {
    if (this.options.sourceUniverse) return this.options.sourceUniverse;
    this.sourceUniverse ??= new ZoteroSourceUniverse();
    return this.sourceUniverse;
  }
}

function selectEvidenceImages(
  context: BuiltContext,
  acceptsImages: boolean,
): PaperReadBusinessResult["images"] {
  if (!acceptsImages || !context.query.locator) return [];
  const selected: PaperReadBusinessResult["images"] = [];
  const seen = new Set<string>();
  for (const evidence of context.evidence) {
    if (!evidence.imagePath || seen.has(evidence.imagePath)) continue;
    seen.add(evidence.imagePath);
    selected.push({
      sourceId: evidence.sourceId,
      page: evidence.page,
      path: evidence.imagePath,
      mimeType: "image/png",
    });
    if (selected.length >= 3) break;
  }
  return selected;
}

function buildStructuredResult(
  context: BuiltContext,
  images: PaperReadBusinessResult["images"],
): PaperReadStructuredResult {
  return {
    status: context.status,
    workspace: context.workspace,
    sources: context.sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
    })),
    evidence: context.evidence.map(structuredEvidence),
    warnings: [...context.warnings],
    images: images.map((image) => ({
      sourceId: image.sourceId,
      page: image.page,
      mimeType: image.mimeType,
    })),
  };
}

function structuredEvidence(evidence: ContextEvidence) {
  return {
    sourceId: evidence.sourceId,
    page: evidence.page,
    label: evidence.label,
    section: evidence.sectionPath,
  };
}

async function resolveSourceSelection(
  scope: WorkspaceQueryScope,
  sourceIds: string[] | undefined,
  getSourceUniverse: () => PaperSourceUniverse,
  signal?: AbortSignal,
): Promise<
  | {
      ok: true;
      sources?: PaperSourceRef[];
      scope: WorkspaceQueryScope;
    }
  | { ok: false; error: string }
> {
  const workspace = scopeToWorkspace(scope);
  throwIfAborted(signal);
  if (!sourceIds?.length && scope.workspaceType !== "collection") {
    return { ok: true, scope };
  }
  const sourceUniverse = getSourceUniverse();
  const universe = sourceIds?.length
    ? await sourceUniverse.resolveSelectedPdfSources(workspace, sourceIds)
    : await sourceUniverse.resolveSources(workspace, workspace.defaultSource);
  throwIfAborted(signal);
  if (sourceIds?.length) {
    const sourceById = new Map(
      universe.map((source) => [source.sourceId, source]),
    );
    const selected = sourceIds.map((id) => sourceById.get(id));
    const invalid = sourceIds.filter((_, index) => !selected[index]);
    if (invalid.length) {
      return {
        ok: false,
        error: `Selected source is outside the current workspace: ${invalid.join(", ")}`,
      };
    }
    return {
      ok: true,
      sources: selected.filter((source): source is PaperSourceRef =>
        Boolean(source),
      ),
      scope,
    };
  }

  if (
    scope.workspaceType === "collection" &&
    scope.defaultSource &&
    !universe.some((source) => source.sourceId === defaultSourceId(scope))
  ) {
    return {
      ok: false,
      error:
        "Choose a paper with @ in this collection workspace before asking a paper question.",
    };
  }
  return { ok: true, scope };
}

function scopeToWorkspace(scope: WorkspaceQueryScope): WorkspaceIdentity {
  return {
    workspaceKey: scope.workspaceKey,
    workspaceType: scope.workspaceType,
    workspaceLabel: scope.workspaceLabel,
    workspaceTitle: scope.workspaceLabel,
    libraryID: scope.libraryID,
    collectionKey: scope.collectionKey,
    collectionPath: scope.collectionPath,
    itemKey: scope.itemKey,
    defaultSource: scope.defaultSource
      ? {
          paperKey: scope.defaultSource.paperKey,
          libraryID: scope.defaultSource.libraryID,
          parentItemID: scope.defaultSource.parentItemID,
          parentItemKey: scope.defaultSource.parentItemKey,
          attachmentItemID: scope.defaultSource.attachmentItemID,
          attachmentKey: scope.defaultSource.attachmentKey,
          title: scope.defaultSource.title || scope.workspaceLabel,
        }
      : undefined,
  };
}

function defaultSourceId(scope: WorkspaceQueryScope): string {
  return scope.defaultSource
    ? createSourceId(
        scope.defaultSource.libraryID,
        scope.defaultSource.attachmentKey,
      )
    : "";
}

export const PAPER_READ_MAX_SOURCES = MAX_SELECTED_CONTEXTS;
