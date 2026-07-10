import type { MaterialArtifact, MaterialChunk, MaterialPage } from "../types";

function extractArtifacts(
  chunks: MaterialChunk[],
  pages: MaterialPage[],
): MaterialArtifact[] {
  const artifacts: MaterialArtifact[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.text.matchAll(
      /\b(?<kind>Figure|Fig\.|Table|Tab\.|Equation|Eq\.)\s*(?<label>\d+(?:\.\d+)*)[:.\s-]*(?<caption>[^\n]{0,280})/gi,
    )) {
      const kind = normalizeArtifactType(match.groups?.kind || "");
      const labelNumber = match.groups?.label || "";
      const label = `${artifactLabelPrefix(kind)} ${labelNumber}`;
      const id = `${chunk.sourceId}:${kind}:${labelNumber}`;
      if (seen.has(id)) continue;
      seen.add(id);
      artifacts.push({
        id,
        type: kind,
        label,
        page: chunk.pageStart,
        caption: cleanCaption(match.groups?.caption || ""),
        imagePath: findPageImagePath(pages, chunk.pageStart),
        surroundingChunkIds: [],
        confidence: 0.72,
        note: "Detected from markdown text.",
      });
    }
  }
  for (const page of pages) {
    artifacts.push({
      id: `${chunks[0]?.sourceId || "source"}:page:${page.page}`,
      type: "page",
      label: `Page ${page.page}`,
      page: page.page,
      imagePath: page.imagePath,
      surroundingChunkIds: [],
      confidence: page.imagePath ? 0.95 : 0.5,
      note: page.imagePath ? "Rendered page image." : "Page text only.",
    });
  }
  return artifacts;
}

function normalizeArtifactType(value: string): "figure" | "table" | "equation" {
  const lower = value.toLowerCase();
  if (lower.startsWith("tab")) return "table";
  if (lower.startsWith("eq")) return "equation";
  return "figure";
}

function artifactLabelPrefix(kind: MaterialArtifact["type"]): string {
  if (kind === "table") return "Table";
  if (kind === "equation") return "Equation";
  if (kind === "page") return "Page";
  return "Figure";
}

function findPageImagePath(
  pages: MaterialPage[],
  page: number | undefined,
): string | undefined {
  return pages.find((item) => item.page === page)?.imagePath;
}

function cleanCaption(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export { extractArtifacts };
