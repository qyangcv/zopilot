import type { JsonValue } from "../../../runtime/json/types";
import type {
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import {
  DocumentContextBuilder,
  formatContextForTool,
} from "../../../application/document/DocumentContextBuilder";
import type {
  BuiltContext,
  WorkspaceQueryScope,
} from "../../../document/types";
import { createSourceId } from "../../../domain/sourceIdentity";
import { ZoteroSourceUniverse } from "../../zotero/ZoteroWorkspaceService";
import type {
  McpTool,
  McpToolCallContext,
  McpToolCallResult,
} from "../protocol";
import { isJsonObject } from "../protocol";
import { createLogger } from "../../../runtime/logging/logger";

export { createPaperReadTool };

type PaperReadInput = {
  question?: string;
  sourceIds?: string[];
};

type PaperReadToolOptions = {
  contextBuilder?: {
    build(input: {
      scope?: WorkspaceQueryScope;
      bindingError?: string;
      question?: string;
      sources?: PaperSourceRef[];
    }): Promise<BuiltContext>;
  };
  sourceUniverse?: {
    resolveSources(
      workspace: WorkspaceIdentity,
      currentSource?: WorkspaceIdentity["defaultSource"],
    ): Promise<PaperSourceRef[]>;
  };
  logger?: (message: string, details?: JsonValue) => void;
};

const paperReadLogger = createLogger("mcp.tools.paperRead");

function createPaperReadTool(options: PaperReadToolOptions = {}): McpTool {
  const logger = createPaperReadLogger(options.logger);
  let defaultContextBuilder: DocumentContextBuilder | undefined;
  const getContextBuilder = () => {
    if (options.contextBuilder) {
      return options.contextBuilder;
    }
    defaultContextBuilder ??= new DocumentContextBuilder();
    return defaultContextBuilder;
  };
  let defaultSourceUniverse:
    | NonNullable<PaperReadToolOptions["sourceUniverse"]>
    | undefined;
  const getSourceUniverse = () => {
    if (options.sourceUniverse) {
      return options.sourceUniverse;
    }
    defaultSourceUniverse ??= new ZoteroSourceUniverse();
    return defaultSourceUniverse;
  };
  return {
    definition: {
      name: "paper_read",
      title: "Read Zopilot paper context",
      description:
        "Retrieve traceable evidence from the PDF material cache for the current Zopilot workspace. Returns context excerpts, document structure, locators, pages, and artifact paths; it does not answer for the agent.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: {
            type: "string",
            description:
              "The paper-specific reading question or locator intent, such as Figure 2, Table 1, page 5, a section title, or a natural-language information need.",
          },
          sourceIds: {
            type: "array",
            maxItems: 5,
            items: { type: "string" },
            description:
              "Optional Zopilot source IDs selected with @ mentions in the current workspace.",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async call(
      input: JsonValue | undefined,
      context: McpToolCallContext,
    ): Promise<McpToolCallResult> {
      const startedAt = Date.now();
      const parsedInput = parsePaperReadInput(input);
      logger.debug("mcp.tool.paper_read.start", {
        hasQuestion: Boolean(parsedInput.question),
        hasWorkspaceBinding: Boolean(context.workspaceScope),
        selectedSourceCount: parsedInput.sourceIds?.length || 0,
      });

      const sourceSelection = context.workspaceScope
        ? await resolveSourceSelection(
            context.workspaceScope,
            parsedInput.sourceIds,
            getSourceUniverse,
          )
        : {
            ok: true as const,
            sources: undefined,
            scope: context.workspaceScope,
          };
      if (!sourceSelection.ok) {
        return {
          content: [
            {
              type: "text",
              text: sourceSelection.error,
            },
          ],
          isError: true,
          _meta: {
            "zopilot.mcp.step": "v0.3.0-light.context",
            "zopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      }

      const output = await getContextBuilder().build({
        scope: sourceSelection.scope,
        bindingError: context.paperBindingError,
        question: parsedInput.question,
        sources: sourceSelection.sources,
      });
      logger.debug("mcp.tool.paper_read.finish", {
        status: output.status,
        evidenceCount: output.evidence.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [
          {
            type: "text",
            text: formatContextForTool(output),
          },
        ],
        isError:
          output.status === "not_bound" ||
          output.status === "no_source" ||
          output.status === "material_error",
        _meta: {
          "zopilot.mcp.step": "v0.3.0-light.context",
          "zopilot.mcp.durationMs": Date.now() - startedAt,
        },
      };
    },
  };
}

function parsePaperReadInput(input: JsonValue | undefined): PaperReadInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isJsonObject(input)) {
    throw new Error("paper_read input must be an object.");
  }

  for (const key of Object.keys(input)) {
    if (key !== "question" && key !== "sourceIds") {
      throw new Error(`paper_read input contains unsupported field: ${key}`);
    }
  }

  const question = input.question;
  if (question !== undefined && typeof question !== "string") {
    throw new Error("paper_read.question must be a string.");
  }
  const sourceIds = input.sourceIds;
  if (
    sourceIds !== undefined &&
    (!Array.isArray(sourceIds) ||
      sourceIds.length > 5 ||
      !sourceIds.every((item) => typeof item === "string"))
  ) {
    throw new Error(
      "paper_read.sourceIds must be an array of up to 5 strings.",
    );
  }
  return {
    question,
    sourceIds,
  };
}

async function resolveSourceSelection(
  scope: WorkspaceQueryScope,
  sourceIds: string[] | undefined,
  getSourceUniverse: () => NonNullable<PaperReadToolOptions["sourceUniverse"]>,
): Promise<
  | {
      ok: true;
      sources?: PaperSourceRef[];
      scope: WorkspaceQueryScope;
    }
  | { ok: false; error: string }
> {
  const workspace = scopeToWorkspace(scope);
  if (!sourceIds?.length && scope.workspaceType !== "collection") {
    return { ok: true, scope };
  }
  const universe = await getSourceUniverse().resolveSources(
    workspace,
    workspace.defaultSource,
  );
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
          parentItemKey:
            scope.defaultSource.parentItemKey ||
            scope.defaultSource.paperKey.split(":").at(-1) ||
            scope.defaultSource.paperKey,
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

function createPaperReadLogger(callback?: PaperReadToolOptions["logger"]) {
  if (callback) {
    return {
      debug: callback,
    };
  }
  return {
    debug: (message: string, details?: JsonValue) =>
      paperReadLogger.debug(message, details),
  };
}
