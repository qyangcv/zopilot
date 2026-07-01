import { MaterialCache } from "./materialCache";
import { routeQuery } from "./query";
import { retrieveContextCandidates } from "./retrieval";
import { ZoteroPdfSourceResolver } from "./sourceResolver";
import type {
  BuiltContext,
  ContextEvidence,
  Material,
  MaterialArtifact,
  QueryPlan,
  SourceIdentity,
  WorkspaceQueryScope,
} from "./types";

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

class DocumentContextBuilder {
  private readonly sourceResolver: NonNullable<
    DocumentContextBuilderOptions["sourceResolver"]
  >;
  private readonly materialCache: NonNullable<
    DocumentContextBuilderOptions["materialCache"]
  >;

  constructor(options: DocumentContextBuilderOptions = {}) {
    this.sourceResolver =
      options.sourceResolver || new ZoteroPdfSourceResolver();
    this.materialCache = options.materialCache || new MaterialCache();
  }

  async build(input: {
    scope?: WorkspaceQueryScope;
    bindingError?: string;
    question?: string;
  }): Promise<BuiltContext> {
    const plan = routeQuery(input.question);
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
    const source = await this.sourceResolver.resolveDefaultSource(input.scope);
    if (!source) {
      return {
        status: "no_source",
        workspace,
        sources: [],
        query: plan,
        evidence: [],
        warnings: ["The current workspace has no selected PDF source."],
      };
    }

    let material: Material;
    try {
      material = await this.materialCache.getOrBuild(source);
    } catch (error) {
      return {
        status: "material_error",
        workspace,
        sources: [source],
        query: plan,
        evidence: [],
        warnings: [String(error)],
      };
    }

    const evidence = packEvidence(material, plan);
    return {
      status: evidence.length ? "ready" : "no_match",
      workspace,
      sources: [source],
      query: plan,
      evidence,
      warnings: material.manifest.warnings,
    };
  }
}

function packEvidence(material: Material, plan: QueryPlan): ContextEvidence[] {
  const evidence: ContextEvidence[] = [];
  evidence.push(...packArtifactEvidence(material, plan));
  evidence.push(...packDocumentMapEvidence(material, plan));
  evidence.push(...packRepresentativeEvidence(material, plan));

  const candidates = retrieveContextCandidates(material, plan);
  const usedChunkIds = new Set(evidence.map((item) => item.chunkId));
  const pageCounts = new Map<number, number>();
  for (const candidate of candidates) {
    if (usedChunkIds.has(candidate.chunk.id)) {
      continue;
    }
    if (
      candidate.chunk.pageStart !== undefined &&
      (pageCounts.get(candidate.chunk.pageStart) || 0) >= 2
    ) {
      continue;
    }
    evidence.push({
      type: "chunk",
      sourceId: candidate.chunk.sourceId,
      chunkId: candidate.chunk.id,
      page: candidate.chunk.pageStart,
      sectionPath: candidate.chunk.sectionPath,
      score: candidate.score,
      reasons: candidate.reasons,
      text: truncateText(candidate.chunk.text, 1800),
    });
    if (candidate.chunk.pageStart !== undefined) {
      pageCounts.set(
        candidate.chunk.pageStart,
        (pageCounts.get(candidate.chunk.pageStart) || 0) + 1,
      );
    }
    if (evidence.length >= 8) {
      break;
    }
  }
  return evidence.slice(0, 8);
}

function packDocumentMapEvidence(
  material: Material,
  plan: QueryPlan,
): ContextEvidence[] {
  if (!shouldAddDocumentOverview(plan)) {
    return [];
  }
  const outline = buildSectionOutline(material);
  if (!outline) {
    return [];
  }
  return [
    {
      type: "chunk",
      sourceId: material.manifest.source.sourceId,
      chunkId: "document-map",
      page: 1,
      sectionPath: ["Document map"],
      score: 1,
      reasons: ["document map"],
      text: outline,
    },
  ];
}

function packRepresentativeEvidence(
  material: Material,
  plan: QueryPlan,
): ContextEvidence[] {
  if (!shouldAddDocumentOverview(plan)) {
    return [];
  }
  const selected = selectRepresentativeChunks(material);
  return selected.map((chunk) => ({
    type: "chunk",
    sourceId: chunk.sourceId,
    chunkId: chunk.id,
    page: chunk.pageStart,
    sectionPath: chunk.sectionPath,
    score: 0.9,
    reasons: ["representative document section"],
    text: truncateText(chunk.text, chunk.kind === "abstract" ? 1400 : 1200),
  }));
}

function shouldAddDocumentOverview(plan: QueryPlan): boolean {
  return (
    !plan.locator && (plan.intent === "summary" || plan.intent === "general")
  );
}

function buildSectionOutline(material: Material): string {
  const sections = Array.from(
    new Map(
      material.chunks
        .filter((chunk) => chunk.kind !== "references")
        .map((chunk) => [
          chunk.sectionPath.join(" > ") || chunk.title || "Untitled section",
          chunk,
        ]),
    ).entries(),
  )
    .slice(0, 24)
    .map(([label, chunk]) => {
      const page =
        chunk.pageStart === undefined
          ? ""
          : chunk.pageEnd && chunk.pageEnd !== chunk.pageStart
            ? ` (pages ${chunk.pageStart}-${chunk.pageEnd})`
            : ` (page ${chunk.pageStart})`;
      return `- ${label}${page}`;
    });
  if (!sections.length) {
    return "";
  }
  return [
    `Document title: ${material.manifest.source.title}`,
    `Page count: ${material.manifest.pageCount}`,
    "Section outline:",
    ...sections,
  ].join("\n");
}

function selectRepresentativeChunks(material: Material): Material["chunks"] {
  const chunks = material.chunks.filter((chunk) => chunk.kind !== "references");
  if (!chunks.length) {
    return [];
  }
  const selected: typeof chunks = [];
  const add = (chunk: (typeof chunks)[number] | undefined) => {
    if (chunk && !selected.some((item) => item.id === chunk.id)) {
      selected.push(chunk);
    }
  };
  add(chunks.find((chunk) => chunk.kind === "abstract"));
  add(chunks.find((chunk) => chunk.kind === "title"));
  const body = chunks.filter((chunk) => chunk.kind === "body");
  add(body[0]);
  add(body[Math.floor(body.length / 2)]);
  add(body.at(-1));
  return selected.slice(0, 4);
}

function packArtifactEvidence(
  material: Material,
  plan: QueryPlan,
): ContextEvidence[] {
  if (!plan.locator) {
    return [];
  }
  const artifacts = findArtifacts(material.artifacts, plan);
  return artifacts.slice(0, 3).map((artifact) => {
    const surrounding = material.chunks.find((chunk) =>
      artifact.surroundingChunkIds.includes(chunk.id),
    );
    const textParts = [
      artifact.caption ? `Caption: ${artifact.caption}` : "",
      surrounding ? truncateText(surrounding.text, 1200) : "",
    ].filter(Boolean);
    return {
      type: "artifact",
      sourceId: material.manifest.source.sourceId,
      artifactId: artifact.id,
      chunkId: surrounding?.id,
      label: artifact.label,
      page: artifact.page,
      sectionPath: surrounding?.sectionPath || [],
      imagePath: artifact.imagePath,
      score: artifact.confidence + 1,
      reasons: ["exact artifact locator"],
      text: textParts.join("\n\n"),
    };
  });
}

function findArtifacts(
  artifacts: MaterialArtifact[],
  plan: QueryPlan,
): MaterialArtifact[] {
  const locator = plan.locator;
  if (!locator) {
    return [];
  }
  if (locator.type === "page") {
    return artifacts.filter(
      (artifact) => artifact.type === "page" && artifact.page === locator.page,
    );
  }
  const label = `${locator.type} ${locator.value}`.toLowerCase();
  return artifacts.filter(
    (artifact) =>
      artifact.type === locator.type && artifact.label.toLowerCase() === label,
  );
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

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+\n/g, "\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).trim();
}
