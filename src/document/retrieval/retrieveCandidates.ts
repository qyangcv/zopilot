import { Document } from "flexsearch";
import type {
  Material,
  MaterialArtifact,
  MaterialChunk,
  QueryPlan,
  RetrievalCandidate,
} from "../types";
import { pageRangeContains } from "../pageRange";

export { retrieveContextCandidates };

type SearchDoc = {
  id: string;
  text: string;
  title: string;
  sectionPath: string;
  caption: string;
  kind: string;
  page: string;
  artifactLabel: string;
};

const RRF_K = 60;

function retrieveContextCandidates(
  material: Material,
  plan: QueryPlan,
): RetrievalCandidate[] {
  const chunkById = new Map(material.chunks.map((chunk) => [chunk.id, chunk]));
  const index = buildIndex(material);
  const resultLists = [
    searchField(index, plan.query, "text"),
    searchField(index, plan.query, "sectionPath"),
    searchField(index, plan.query, "caption"),
    searchField(index, plan.query, "artifactLabel"),
  ];
  if (plan.locator) {
    resultLists.unshift(
      searchField(index, plan.locator.value, "artifactLabel"),
    );
    if (plan.locator.page) {
      resultLists.unshift(
        material.chunks
          .filter((chunk) => pageRangeContains(chunk, plan.locator?.page))
          .map((chunk) => chunk.id),
      );
    }
  }

  const merged = new Map<
    string,
    { score: number; reasons: string[]; firstRank: number }
  >();
  resultLists.forEach((list, listIndex) => {
    list.forEach((id, rank) => {
      const current = merged.get(id) || {
        score: 0,
        reasons: [],
        firstRank: Number.POSITIVE_INFINITY,
      };
      current.score += 1 / (RRF_K + rank + 1);
      current.firstRank = Math.min(current.firstRank, rank + listIndex * 1000);
      const reason = listIndexReason(listIndex, plan);
      if (!current.reasons.includes(reason)) {
        current.reasons.push(reason);
      }
      merged.set(id, current);
    });
  });

  for (const chunk of material.chunks) {
    if (!plan.includeReferences && chunk.kind === "references") {
      merged.delete(chunk.id);
      continue;
    }
    const structural = structuralBoost(chunk, material.artifacts, plan);
    if (structural <= 0) {
      continue;
    }
    const current = merged.get(chunk.id) || {
      score: 0,
      reasons: [],
      firstRank: Number.POSITIVE_INFINITY,
    };
    current.score += structural;
    current.reasons.push("structural boost");
    merged.set(chunk.id, current);
  }

  const ranked = Array.from(merged.entries())
    .map(([id, item]) => ({
      chunk: chunkById.get(id),
      score: item.score,
      reasons: item.reasons,
      firstRank: item.firstRank,
    }))
    .filter(
      (
        item,
      ): item is RetrievalCandidate & {
        firstRank: number;
      } => Boolean(item.chunk),
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.firstRank - right.firstRank,
    );

  return applyMmr(ranked, 10);
}

function buildIndex(material: Material): Document<SearchDoc> {
  const index = new Document<SearchDoc>({
    tokenize: "forward",
    document: {
      id: "id",
      index: [
        "text",
        "title",
        "sectionPath",
        "caption",
        "kind",
        "page",
        "artifactLabel",
      ],
    },
  });
  for (const chunk of material.chunks) {
    index.add({
      id: chunk.id,
      text: chunk.text,
      title: chunk.title || "",
      sectionPath: chunk.sectionPath.join(" / "),
      caption: chunk.kind === "caption" ? chunk.text : "",
      kind: chunk.kind,
      page: pageLabel(chunk),
      artifactLabel: chunk.artifactIds
        .map((id) => material.artifacts.find((artifact) => artifact.id === id))
        .filter((artifact): artifact is MaterialArtifact => Boolean(artifact))
        .map((artifact) => artifact.label)
        .join(" "),
    });
  }
  return index;
}

function searchField(
  index: Document<SearchDoc>,
  query: string,
  field: keyof SearchDoc,
): string[] {
  if (!query.trim()) {
    return [];
  }
  const raw = index.search(query, {
    index: field,
    limit: 20,
  } as never) as unknown;
  return normalizeSearchIds(raw);
}

function normalizeSearchIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      ids.push(entry);
      continue;
    }
    if (typeof entry === "number") {
      ids.push(String(entry));
      continue;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as {
      id?: unknown;
      result?: unknown;
    };
    if (typeof item.id === "string") {
      ids.push(item.id);
    }
    if (Array.isArray(item.result)) {
      ids.push(...normalizeSearchIds(item.result));
    }
  }
  return Array.from(new Set(ids));
}

function listIndexReason(index: number, plan: QueryPlan): string {
  if (plan.locator && index === 0) {
    return "locator match";
  }
  return (
    ["body search", "section search", "caption search", "artifact search"][
      index
    ] || "retrieval"
  );
}

function structuralBoost(
  chunk: MaterialChunk,
  artifacts: MaterialArtifact[],
  plan: QueryPlan,
): number {
  let boost = 0;
  if (chunk.kind === "title" || chunk.kind === "abstract") {
    boost += plan.intent === "summary" ? 0.08 : 0.03;
  }
  if (chunk.kind === "caption" || chunk.kind === "table") {
    boost += plan.intent === "figure" || plan.intent === "table" ? 0.12 : 0.04;
  }
  if (plan.locator?.page && pageRangeContains(chunk, plan.locator.page)) {
    boost += 0.2;
  }
  if (plan.locator) {
    const locatorLabel =
      `${plan.locator.type} ${plan.locator.value}`.toLowerCase();
    const exact = artifacts.some(
      (artifact) =>
        chunk.artifactIds.includes(artifact.id) &&
        artifact.label.toLowerCase() === locatorLabel,
    );
    if (exact) {
      boost += 0.35;
    }
  }
  const titleOverlap = countQueryTitleOverlap(plan.query, chunk);
  if (titleOverlap) {
    boost += Math.min(0.16, titleOverlap * 0.04);
  }
  return boost;
}

function countQueryTitleOverlap(query: string, chunk: MaterialChunk): number {
  if (!query.trim()) {
    return 0;
  }
  const titleTerms = new Set(
    tokenize(`${chunk.title || ""} ${chunk.sectionPath.join(" ")}`),
  );
  if (!titleTerms.size) {
    return 0;
  }
  return tokenize(query).filter((term) => titleTerms.has(term)).length;
}

function applyMmr(
  ranked: RetrievalCandidate[],
  limit: number,
): RetrievalCandidate[] {
  const selected: RetrievalCandidate[] = [];
  const usedPages = new Map<number, number>();
  const remaining = [...ranked];

  while (selected.length < limit && remaining.length) {
    remaining.sort((left, right) => {
      const leftPenalty = pagePenalty(left.chunk, usedPages);
      const rightPenalty = pagePenalty(right.chunk, usedPages);
      return right.score - rightPenalty - (left.score - leftPenalty);
    });
    const next = remaining.shift();
    if (!next) {
      break;
    }
    selected.push(next);
    if (next.chunk.pageStart !== undefined) {
      usedPages.set(
        next.chunk.pageStart,
        (usedPages.get(next.chunk.pageStart) || 0) + 1,
      );
    }
  }
  return selected;
}

function pagePenalty(
  chunk: MaterialChunk,
  usedPages: Map<number, number>,
): number {
  if (chunk.pageStart === undefined) {
    return 0;
  }
  return (usedPages.get(chunk.pageStart) || 0) * 0.08;
}

function pageLabel(chunk: MaterialChunk): string {
  if (chunk.pageStart === undefined) {
    return "";
  }
  if (!chunk.pageEnd || chunk.pageEnd === chunk.pageStart) {
    return String(chunk.pageStart);
  }
  return `${chunk.pageStart}-${chunk.pageEnd}`;
}

function tokenize(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}_-]{2,}/gu))
    .map((match) => match[0])
    .filter((term) => !RETRIEVAL_STOP_WORDS.has(term));
}

const RETRIEVAL_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "with",
  "this",
  "that",
  "paper",
  "article",
  "study",
]);
