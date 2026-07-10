import { MaterialRepository } from "../../document/material/MaterialRepository";
import { packEvidenceAcrossSources } from "../../document/retrieval/contextPacker";
import { parseRetrievalQuery } from "../../document/retrieval/queryParser";
import { ZoteroPdfSourceResolver } from "../../integrations/zotero/ZoteroPdfSourceResolver";
import type { PaperSourceRef } from "../../domain/conversation";
import type {
  BuiltContext,
  Material,
  SourceIdentity,
  WorkspaceQueryScope,
} from "../../document/types";

export { DocumentContextBuilder, formatContextForTool };

type DocumentContextBuilderOptions = {
  sourceResolver?: {
    resolveDefaultSource(
      scope: WorkspaceQueryScope,
    ): Promise<SourceIdentity | null>;
  };
  materialCache?: {
    getOrBuild(source: SourceIdentity): Promise<Material>;
  };
};

type ContextSourceResolver = NonNullable<
  DocumentContextBuilderOptions["sourceResolver"]
> & {
  resolveSourceRef?(source: PaperSourceRef): Promise<SourceIdentity | null>;
};

class DocumentContextBuilder {
  private readonly sourceResolver: ContextSourceResolver;
  private readonly materialCache: NonNullable<
    DocumentContextBuilderOptions["materialCache"]
  >;

  constructor(options: DocumentContextBuilderOptions = {}) {
    this.sourceResolver =
      options.sourceResolver || new ZoteroPdfSourceResolver();
    this.materialCache = options.materialCache || new MaterialRepository();
  }

  async build(input: {
    scope?: WorkspaceQueryScope;
    bindingError?: string;
    question?: string;
    sources?: PaperSourceRef[];
  }): Promise<BuiltContext> {
    const plan = parseRetrievalQuery(input.question);
    if (!input.scope) {
      return {
        status: "not_bound",
        workspace: {
          key: "",
          type: "item",
          label: "",
        },
        sources: [],
        query: plan,
        evidence: [],
        warnings: [input.bindingError || "This Codex thread is not bound."],
      };
    }

    const workspace = {
      key: input.scope.workspaceKey,
      type: input.scope.workspaceType,
      label: input.scope.workspaceLabel,
    };
    const requestedSources = input.sources || [];
    const sourceResults = requestedSources.length
      ? await this.resolveSelectedSources(requestedSources)
      : [await this.sourceResolver.resolveDefaultSource(input.scope)];
    const sources = sourceResults.filter((source): source is SourceIdentity =>
      Boolean(source),
    );
    if (!sources.length) {
      return {
        status: "no_source",
        workspace,
        sources: [],
        query: plan,
        evidence: [],
        warnings: ["The current workspace has no selected PDF source."],
      };
    }

    const materials: Material[] = [];
    const warnings: string[] = [];
    for (const source of sources) {
      try {
        materials.push(await this.materialCache.getOrBuild(source));
      } catch (error) {
        warnings.push(`${source.title}: ${String(error)}`);
      }
    }
    if (!materials.length) {
      return {
        status: "material_error",
        workspace,
        sources,
        query: plan,
        evidence: [],
        warnings,
      };
    }

    const evidence = packEvidenceAcrossSources(materials, plan);
    return {
      status: evidence.length ? "ready" : "no_match",
      workspace,
      sources,
      query: plan,
      evidence,
      warnings: [
        ...warnings,
        ...materials.flatMap((material) => material.manifest.warnings),
      ],
    };
  }

  private async resolveSelectedSources(
    sources: PaperSourceRef[],
  ): Promise<Array<SourceIdentity | null>> {
    if (!this.sourceResolver.resolveSourceRef) {
      return [];
    }
    return Promise.all(
      sources.map((source) => this.sourceResolver.resolveSourceRef!(source)),
    );
  }
}

function formatContextForTool(context: BuiltContext): string {
  if (context.status === "not_bound") {
    return context.warnings[0] || "This Codex thread is not bound.";
  }
  if (context.status === "no_source") {
    return context.warnings[0] || "No PDF source is selected.";
  }
  if (context.status === "material_error") {
    return [
      "The PDF material pipeline failed before evidence could be built.",
      ...context.warnings.map((warning) => `Warning: ${warning}`),
    ].join("\n");
  }
  if (!context.evidence.length) {
    return "No relevant paper context was found.";
  }

  const lines = [
    `Workspace: ${context.workspace.type} ${context.workspace.key}`,
    `Source: ${context.sources.map((source) => source.title).join("; ")}`,
    `Query intent: ${context.query.intent}`,
  ];
  lines.push("");

  for (const [index, item] of context.evidence.entries()) {
    lines.push(
      [
        `Evidence ${index + 1}`,
        item.type === "artifact" && item.label ? `label=${item.label}` : "",
        item.page !== undefined ? `page=${item.page}` : "",
        item.sectionPath.length
          ? `section=${item.sectionPath.join(" > ")}`
          : "",
        item.imagePath ? `image=${item.imagePath}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
    lines.push(item.text || "(no text)");
    lines.push("---");
  }
  return lines.join("\n").trim();
}
