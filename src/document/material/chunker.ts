import type {
  MaterialArtifact,
  MaterialBlock,
  MaterialChunk,
  MaterialChunkKind,
  MaterialOutline,
  MaterialOutlineEntry,
  MaterialPage,
} from "../types";
import { pageRangeContains } from "../pageRange";
import { extractArtifacts } from "./artifactExtractor";

export { buildChunksAndArtifacts };

const TARGET_CHARS = 4_200;

function buildChunksAndArtifacts(input: {
  sourceId: string;
  blocks: MaterialBlock[];
  outline: MaterialOutline;
  pages: MaterialPage[];
}): { chunks: MaterialChunk[]; artifacts: MaterialArtifact[] } {
  const chunks = chunkBlocks(input.sourceId, input.blocks, input.outline);
  const artifacts = extractArtifacts(chunks, input.pages);
  for (const artifact of artifacts) {
    for (const chunk of chunks) {
      if (
        pageRangeContains(chunk, artifact.page) ||
        chunk.text.toLowerCase().includes(artifact.label.toLowerCase())
      ) {
        artifact.surroundingChunkIds.push(chunk.id);
        chunk.artifactIds.push(artifact.id);
      }
    }
  }
  return { chunks, artifacts };
}

function chunkBlocks(
  sourceId: string,
  materialBlocks: MaterialBlock[],
  outline: MaterialOutline,
): MaterialChunk[] {
  const blocks = [...materialBlocks]
    .filter((block) => block.text.trim())
    .sort((left, right) => left.page - right.page || left.index - right.index);
  const outlinePositions = resolveOutlinePositions(blocks, outline.entries);
  const chunks: MaterialChunk[] = [];
  let pending: MaterialBlock[] = [];
  let pendingPath: string[] = [];
  let pendingChars = 0;

  const flush = () => {
    if (!pending.length) return;
    const index = chunks.length;
    chunks.push({
      id: `chunk-${String(index + 1).padStart(6, "0")}`,
      sourceId,
      index,
      kind: inferChunkKind(pending),
      title: pendingPath.at(-1),
      sectionPath: pendingPath,
      pageStart: pending[0].page,
      pageEnd: pending.at(-1)?.page,
      text: pending.map((block) => block.text).join("\n\n"),
      blockIds: pending.map((block) => block.id),
      artifactIds: [],
    });
    pending = [];
    pendingPath = [];
    pendingChars = 0;
  };

  blocks.forEach((block, blockIndex) => {
    const path = sectionPathAt(outline.entries, outlinePositions, blockIndex);
    const sectionChanged =
      pending.length > 0 && !sameStringArray(path, pendingPath);
    const exceedsTarget =
      pending.length > 0 && pendingChars + block.text.length + 2 > TARGET_CHARS;
    if (sectionChanged || exceedsTarget) flush();
    if (!pending.length) pendingPath = path;
    pending.push(block);
    pendingChars += block.text.length + 2;
  });
  flush();
  return chunks;
}

function resolveOutlinePositions(
  blocks: MaterialBlock[],
  entries: MaterialOutlineEntry[],
): number[] {
  const indexById = new Map(
    blocks.map((block, index) => [block.id, index] as const),
  );
  let lastPosition = 0;
  return entries.map((entry) => {
    const exact = entry.blockId ? indexById.get(entry.blockId) : undefined;
    if (exact !== undefined) {
      lastPosition = Math.max(lastPosition, exact);
      return lastPosition;
    }
    const pagePosition = blocks.findIndex((block) => block.page >= entry.page);
    if (pagePosition >= 0) {
      lastPosition = Math.max(lastPosition, pagePosition);
    }
    return lastPosition;
  });
}

function sectionPathAt(
  entries: MaterialOutlineEntry[],
  positions: number[],
  blockIndex: number,
): string[] {
  let targetIndex = -1;
  for (let index = 0; index < positions.length; index += 1) {
    if (positions[index] > blockIndex) break;
    targetIndex = index;
  }
  if (targetIndex < 0) return [];

  const target = entries[targetIndex];
  const path = [target.title];
  let level = target.level;
  for (let index = targetIndex - 1; index >= 0 && level > 1; index -= 1) {
    const candidate = entries[index];
    if (candidate.level < level) {
      path.unshift(candidate.title);
      level = candidate.level;
    }
  }
  return path;
}

function inferChunkKind(blocks: MaterialBlock[]): MaterialChunkKind {
  if (blocks.every((block) => block.type === "table")) return "table";
  if (blocks.every((block) => block.type === "caption")) return "caption";
  if (blocks.some((block) => block.type === "title")) return "title";
  return "body";
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
