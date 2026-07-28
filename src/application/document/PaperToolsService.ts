import {
  createChunkLocator,
  createDocumentLocator,
  createSectionLocator,
  matchesMaterialRevision,
  parseLocator,
} from "../../document/locator";
import { searchMaterial } from "../../document/retrieval/retrieveCandidates";
import type {
  Material,
  MaterialBlock,
  MaterialBlockType,
  MaterialOutlineEntry,
  WorkspaceQueryScope,
} from "../../document/types";
import { throwIfAborted } from "../../runtime/cancellation";
import {
  PaperMaterialResolver,
  PaperToolError,
  type PaperMaterialResolverOptions,
} from "./PaperMaterialResolver";

export {
  PaperToolsService,
  type GetOutlineResult,
  type SearchResult,
  type ReadResult,
  type ViewPageResult,
  type PaperToolContext,
};

const READ_CHAR_BUDGET = 16_000;
const CURSOR_PREFIX = "zpc1";

type PaperToolContext = {
  workspaceScope?: WorkspaceQueryScope;
  bindingError?: string;
  acceptsImages: boolean;
};

type SourceResult = {
  sourceId: string;
  title: string;
  pageCount: number;
};

type OutlineNodeResult = {
  sectionId: string;
  title: string;
  level: number;
  startPage: number;
  endPage: number;
  locator: string;
  provenance: "embedded" | "inferred";
  children: OutlineNodeResult[];
};

type GetOutlineResult = {
  status: "ready" | "partial" | "unavailable";
  source: SourceResult;
  rootLocator: string;
  outline: OutlineNodeResult[];
  provenance: Material["outline"]["provenance"];
  warnings: string[];
};

type SearchResult = {
  status: "ready" | "no_match";
  sources: SourceResult[];
  matches: Array<{
    sourceId: string;
    title: string;
    preview: string;
    page?: number;
    sectionPath: string[];
    score: number;
    locator: string;
  }>;
  warnings: string[];
};

type ReadBlockResult = {
  blockId: string;
  type: MaterialBlockType;
  text: string;
  page: number;
  bbox?: [number, number, number, number];
};

type ReadResult = {
  status: "ready";
  source: SourceResult;
  locator: string;
  resolvedRange: {
    startPage: number;
    endPage: number;
    sectionPath: string[];
  };
  blocks: ReadBlockResult[];
  complete: boolean;
  nextCursor?: string;
  warnings: string[];
};

type ViewPageResult = {
  metadata: {
    status: "ready";
    source: SourceResult;
    page: number;
    mimeType: "image/png";
    contentIndex: number;
    warnings: string[];
  };
  imagePath: string;
};

type ReadSelection = {
  blocks: ReadBlockResult[];
  sectionPath: string[];
};

class PaperToolsService {
  private readonly materials: PaperMaterialResolver;

  constructor(options: PaperMaterialResolverOptions = {}) {
    this.materials = new PaperMaterialResolver(options);
  }

  async getOutline(
    input: { sourceId?: string },
    context: PaperToolContext,
    signal?: AbortSignal,
  ): Promise<GetOutlineResult> {
    const material = await this.materials.resolveOne({
      scope: context.workspaceScope,
      bindingError: context.bindingError,
      sourceId: input.sourceId,
      signal,
    });
    const nodes = buildOutlineNodes(material);
    return {
      status: material.outline.status,
      source: sourceResult(material),
      rootLocator: createDocumentLocator(
        material.manifest.source.sourceId,
        material.manifest.source.pdfHash,
      ),
      outline: nodes,
      provenance: material.outline.provenance,
      warnings: materialWarnings(material, true),
    };
  }

  async search(
    input: { query: string; sourceIds?: string[]; limit: number },
    context: PaperToolContext,
    signal?: AbortSignal,
  ): Promise<SearchResult> {
    const materials = await this.materials.resolveMany({
      scope: context.workspaceScope,
      bindingError: context.bindingError,
      sourceIds: input.sourceIds,
      signal,
    });
    const candidates = materials.flatMap((material) =>
      searchMaterial(material, input.query, input.limit).map((candidate) => ({
        material,
        candidate,
      })),
    );
    candidates.sort(
      (left, right) => right.candidate.score - left.candidate.score,
    );
    const matches = candidates
      .slice(0, input.limit)
      .map(({ material, candidate }) => ({
        sourceId: material.manifest.source.sourceId,
        title: material.manifest.source.title,
        preview: preview(candidate.chunk.text),
        page: candidate.chunk.pageStart,
        sectionPath: candidate.chunk.sectionPath,
        score: candidate.score,
        locator: createChunkLocator(
          material.manifest.source.sourceId,
          material.manifest.source.pdfHash,
          candidate.chunk.id,
        ),
      }));
    return {
      status: matches.length ? "ready" : "no_match",
      sources: materials.map(sourceResult),
      matches,
      warnings: materials.flatMap((material) => materialWarnings(material)),
    };
  }

  async read(
    input: { locator: string; cursor?: string },
    context: PaperToolContext,
    signal?: AbortSignal,
  ): Promise<ReadResult> {
    let locator;
    try {
      locator = parseLocator(input.locator);
    } catch (error) {
      throw new PaperToolError("invalid_locator", String(error));
    }
    const material = await this.materials.resolveOne({
      scope: context.workspaceScope,
      bindingError: context.bindingError,
      sourceId: locator.sourceId,
      signal,
    });
    if (
      !matchesMaterialRevision(
        locator.revision,
        material.manifest.source.pdfHash,
      )
    ) {
      throw new PaperToolError(
        "stale_locator",
        "This locator belongs to an older version of the paper. Call get_outline or search again.",
      );
    }

    const selection = selectReadBlocks(material, locator);
    if (!selection.blocks.length) {
      throw new PaperToolError(
        "locator_not_found",
        "The locator does not resolve to readable paper text.",
      );
    }
    const offset = input.cursor ? parseCursor(input.cursor, input.locator) : 0;
    if (offset >= selection.blocks.length) {
      throw new PaperToolError(
        "invalid_cursor",
        "The read cursor is outside the locator content.",
      );
    }
    const page = paginateBlocks(selection.blocks, offset);
    throwIfAborted(signal);
    const returned = page.blocks;
    return {
      status: "ready",
      source: sourceResult(material),
      locator: input.locator,
      resolvedRange: {
        startPage: returned[0].page,
        endPage: returned.at(-1)?.page || returned[0].page,
        sectionPath: selection.sectionPath,
      },
      blocks: returned,
      complete: page.nextOffset === undefined,
      nextCursor:
        page.nextOffset === undefined
          ? undefined
          : createCursor(input.locator, page.nextOffset),
      warnings: materialWarnings(material),
    };
  }

  async viewPage(
    input: { sourceId?: string; page: number },
    context: PaperToolContext,
    signal?: AbortSignal,
  ): Promise<ViewPageResult> {
    if (!context.acceptsImages) {
      throw new PaperToolError(
        "images_unsupported",
        "The current MCP client cannot receive page images.",
      );
    }
    const material = await this.materials.resolveOne({
      scope: context.workspaceScope,
      bindingError: context.bindingError,
      sourceId: input.sourceId,
      signal,
    });
    const page = material.pages.find((item) => item.page === input.page);
    if (!page) {
      throw new PaperToolError(
        "page_out_of_range",
        `Page ${input.page} is outside this ${material.manifest.pageCount}-page PDF.`,
      );
    }
    if (!page.imagePath) {
      throw new PaperToolError(
        "page_image_unavailable",
        `Page ${input.page} could not be rendered.`,
      );
    }
    return {
      metadata: {
        status: "ready",
        source: sourceResult(material),
        page: input.page,
        mimeType: "image/png",
        contentIndex: 1,
        warnings: materialWarnings(material),
      },
      imagePath: page.imagePath,
    };
  }
}

function buildOutlineNodes(material: Material): OutlineNodeResult[] {
  const entries = material.outline.entries;
  const nodes = entries.map((entry, index) =>
    outlineNode(material, entry, sectionEndPage(entries, index, material)),
  );
  const roots: OutlineNodeResult[] = [];
  const stack: OutlineNodeResult[] = [];
  for (const node of nodes) {
    while (stack.length && stack.at(-1)!.level >= node.level) {
      stack.pop();
    }
    const parent = stack.at(-1);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function outlineNode(
  material: Material,
  entry: MaterialOutlineEntry,
  endPage: number,
): OutlineNodeResult {
  return {
    sectionId: entry.id,
    title: entry.title,
    level: entry.level,
    startPage: entry.page,
    endPage,
    locator: createSectionLocator(
      material.manifest.source.sourceId,
      material.manifest.source.pdfHash,
      entry.id,
    ),
    provenance: entry.provenance,
    children: [],
  };
}

function sectionEndPage(
  entries: MaterialOutlineEntry[],
  index: number,
  material: Material,
): number {
  const entry = entries[index];
  const next = entries
    .slice(index + 1)
    .find((candidate) => candidate.level <= entry.level);
  return Math.max(
    entry.page,
    Math.min(
      material.manifest.pageCount,
      next?.page || material.manifest.pageCount,
    ),
  );
}

function selectReadBlocks(
  material: Material,
  locator: ReturnType<typeof parseLocator>,
): ReadSelection {
  if (locator.kind === "chunk") {
    const chunk = material.chunks.find((item) => item.id === locator.id);
    if (!chunk) return { blocks: [], sectionPath: [] };
    const selectedIds = new Set(chunk.blockIds);
    return {
      blocks: readableBlocks(material).filter((block) =>
        selectedIds.has(block.blockId),
      ),
      sectionPath: chunk.sectionPath,
    };
  }

  const blocks = readableBlocks(material);
  if (locator.kind === "document") {
    return { blocks, sectionPath: [] };
  }
  const entries = material.outline.entries;
  const sectionIndex = entries.findIndex((entry) => entry.id === locator.id);
  if (sectionIndex < 0) return { blocks: [], sectionPath: [] };
  const entry = entries[sectionIndex];
  const boundary = entries
    .slice(sectionIndex + 1)
    .find((candidate) => candidate.level <= entry.level);
  const startIndex = entry.blockId
    ? blocks.findIndex((block) => block.blockId === entry.blockId)
    : -1;
  const endIndex = boundary?.blockId
    ? blocks.findIndex((block) => block.blockId === boundary.blockId)
    : -1;
  const selected =
    startIndex >= 0
      ? blocks.slice(startIndex, endIndex > startIndex ? endIndex : undefined)
      : blocks.filter(
          (block) =>
            block.page >= entry.page &&
            block.page <= sectionEndPage(entries, sectionIndex, material),
        );
  return {
    blocks: selected,
    sectionPath: sectionPath(entries, sectionIndex),
  };
}

function readableBlocks(material: Material): ReadBlockResult[] {
  if (material.blocks.length) {
    return [...material.blocks]
      .sort((left, right) => left.page - right.page || left.index - right.index)
      .map(toReadBlock);
  }
  return material.pages
    .filter((page) => page.text.trim())
    .map((page) => ({
      blockId: `${material.manifest.source.sourceId}:page:${page.page}`,
      type: "paragraph",
      text: page.text,
      page: page.page,
    }));
}

function toReadBlock(block: MaterialBlock): ReadBlockResult {
  return {
    blockId: block.id,
    type: block.type,
    text: block.text,
    page: block.page,
    bbox: block.bbox,
  };
}

function sectionPath(
  entries: MaterialOutlineEntry[],
  targetIndex: number,
): string[] {
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

function paginateBlocks(
  blocks: ReadBlockResult[],
  offset: number,
): { blocks: ReadBlockResult[]; nextOffset?: number } {
  const selected: ReadBlockResult[] = [];
  let chars = 0;
  let index = offset;
  while (index < blocks.length) {
    const block = blocks[index];
    if (selected.length && chars + block.text.length > READ_CHAR_BUDGET) {
      break;
    }
    selected.push(block);
    chars += block.text.length;
    index += 1;
  }
  return {
    blocks: selected,
    nextOffset: index < blocks.length ? index : undefined,
  };
}

function createCursor(locator: string, offset: number): string {
  return `${CURSOR_PREFIX}.${offset.toString(36)}.${locatorFingerprint(locator)}`;
}

function parseCursor(cursor: string, locator: string): number {
  const parts = cursor.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== CURSOR_PREFIX ||
    parts[2] !== locatorFingerprint(locator)
  ) {
    throw new PaperToolError("invalid_cursor", "Invalid read cursor.");
  }
  const offset = Number.parseInt(parts[1], 36);
  if (!/^[0-9a-z]+$/u.test(parts[1]) || !Number.isSafeInteger(offset)) {
    throw new PaperToolError(
      "invalid_cursor",
      "The cursor does not belong to this locator.",
    );
  }
  return offset;
}

function locatorFingerprint(locator: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < locator.length; index += 1) {
    hash ^= locator.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function sourceResult(material: Material): SourceResult {
  return {
    sourceId: material.manifest.source.sourceId,
    title: material.manifest.source.title,
    pageCount: material.manifest.pageCount,
  };
}

function materialWarnings(
  material: Material,
  includeOutline = false,
): string[] {
  return [
    ...material.manifest.warnings,
    ...(includeOutline ? material.outline.warnings : []),
  ];
}

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 360
    ? normalized
    : `${normalized.slice(0, 357).trimEnd()}...`;
}
