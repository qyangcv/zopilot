import { retrieveContextCandidates } from "./retrieval";
import type {
  ContextEvidence,
  Material,
  MaterialArtifact,
  QueryPlan,
} from "./types";

export { packEvidenceAcrossSources };

function packEvidenceAcrossSources(
  materials: Material[],
  plan: QueryPlan,
): ContextEvidence[] {
  const bySource = materials.map((material) => packEvidence(material, plan));
  const selected: ContextEvidence[] = [];
  for (const evidence of bySource) {
    if (evidence[0]) {
      selected.push(evidence[0]);
    }
  }
  for (const evidence of bySource) {
    for (const item of evidence.slice(1)) {
      if (selected.length >= 10) {
        return selected;
      }
      if (!selected.some((existing) => sameEvidence(existing, item))) {
        selected.push(item);
      }
    }
  }
  return selected.slice(0, 10);
}

function sameEvidence(left: ContextEvidence, right: ContextEvidence): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.chunkId === right.chunkId &&
    left.artifactId === right.artifactId
  );
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
    if (evidence.length >= 10) {
      break;
    }
  }
  return evidence.slice(0, 10);
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

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+\n/g, "\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).trim();
}
