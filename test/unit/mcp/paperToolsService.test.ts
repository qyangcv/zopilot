import { assert } from "chai";
import { PaperToolsService } from "../../../src/application/document/PaperToolsService.ts";
import { createDocumentLocator } from "../../../src/document/locator.ts";
import type {
  Material,
  SourceIdentity,
  WorkspaceQueryScope,
} from "../../../src/document/types.ts";

const PDF_HASH = "ab".repeat(32);

describe("PaperToolsService", function () {
  it("returns hierarchical outline locators that read complete sections", async function () {
    const service = createService();
    const outline = await service.getOutline(
      {},
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.equal(outline.status, "ready");
    assert.equal(outline.outline[0].title, "Introduction");
    assert.equal(outline.outline[1].children[0].title, "Retrieval");

    const read = await service.read(
      { locator: outline.outline[1].locator },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.equal(read.resolvedRange.sectionPath.join(" > "), "Methods");
    assert.deepEqual(
      read.blocks.map((block) => block.blockId),
      ["b-methods", "b-retrieval", "b-ranking"],
    );
    assert.notInclude(
      read.blocks.map((block) => block.text).join("\n"),
      "Conclusion",
    );
  });

  it("searches unknown locations and returns locators accepted by read", async function () {
    const service = createService();
    const search = await service.search(
      { query: "reciprocal rank fusion", limit: 4 },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.equal(search.status, "ready");
    assert.isNotEmpty(search.matches);
    assert.include(search.matches[0].preview, "reciprocal rank fusion");

    const read = await service.read(
      { locator: search.matches[0].locator },
      { workspaceScope: createScope(), acceptsImages: true },
    );
    assert.include(read.blocks[0].text, "reciprocal rank fusion");
  });

  it("keeps a root locator readable when no reliable outline exists", async function () {
    const material = createMaterial();
    material.outline = {
      status: "unavailable",
      provenance: "unavailable",
      entries: [],
      warnings: ["No outline."],
    };
    const service = createService({ material });
    const outline = await service.getOutline(
      {},
      { workspaceScope: createScope(), acceptsImages: true },
    );
    const read = await service.read(
      { locator: outline.rootLocator },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.equal(outline.status, "unavailable");
    assert.deepEqual(outline.outline, []);
    assert.include(
      read.blocks.map((block) => block.text).join("\n"),
      "Methods",
    );
  });

  it("continues long reads with a cursor bound to the same locator", async function () {
    const material = createMaterial();
    material.blocks = [
      block("long-a", 1, 0, "a".repeat(13_000)),
      block("long-b", 2, 0, "b".repeat(13_000)),
      block("long-c", 3, 0, "c".repeat(1_000)),
    ];
    const service = createService({ material });
    const outline = await service.getOutline(
      {},
      { workspaceScope: createScope(), acceptsImages: true },
    );
    const first = await service.read(
      { locator: outline.rootLocator },
      { workspaceScope: createScope(), acceptsImages: true },
    );
    const second = await service.read(
      {
        locator: outline.rootLocator,
        cursor: first.nextCursor,
      },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.isFalse(first.complete);
    assert.equal(first.blocks[0].blockId, "long-a");
    assert.isTrue(second.complete);
    assert.deepEqual(
      second.blocks.map((item) => item.blockId),
      ["long-b", "long-c"],
    );
  });

  it("rejects stale and fabricated locators", async function () {
    const service = createService();
    const stale = createDocumentLocator("1-PDF-A", "cd".repeat(32));

    await assertRejected(
      () =>
        service.read(
          { locator: stale },
          { workspaceScope: createScope(), acceptsImages: true },
        ),
      /older version/,
    );
    await assertRejected(
      () =>
        service.read(
          { locator: "section-methods" },
          { workspaceScope: createScope(), acceptsImages: true },
        ),
      /Invalid paper locator/,
    );
  });

  it("returns one rendered page only to image-capable clients", async function () {
    const service = createService();
    const result = await service.viewPage(
      { page: 3 },
      { workspaceScope: createScope(), acceptsImages: true },
    );
    assert.equal(result.imagePath, "/cache/page-0003.png");
    assert.equal(result.metadata.page, 3);

    await assertRejected(
      () =>
        service.viewPage(
          { page: 3 },
          { workspaceScope: createScope(), acceptsImages: false },
        ),
      /cannot receive page images/,
    );
  });

  it("validates selected sources against the bound workspace", async function () {
    const service = createService({ selectedSourceIds: [] });
    await assertRejected(
      () =>
        service.search(
          { query: "method", sourceIds: ["1-OTHER"], limit: 4 },
          { workspaceScope: createScope(), acceptsImages: true },
        ),
      /outside the current workspace/,
    );
  });
});

function createService(
  options: { selectedSourceIds?: string[]; material?: Material } = {},
): PaperToolsService {
  const source = options.material?.manifest.source || createSource();
  return new PaperToolsService({
    sourceUniverse: {
      async resolveSelectedPdfSources(_workspace, sourceIds) {
        const allowed = options.selectedSourceIds ?? [source.sourceId];
        return sourceIds
          .filter((sourceId) => allowed.includes(sourceId))
          .map(() => createSourceRef());
      },
    },
    sourceResolver: {
      async resolveDefaultSource() {
        return source;
      },
      async resolveSourceRef() {
        return source;
      },
    },
    materialCache: {
      async getOrBuild() {
        return options.material || createMaterial(source);
      },
    },
  });
}

function createScope(): WorkspaceQueryScope {
  return {
    conversationId: "conv-a",
    workspaceKey: "item:1:PAPER-A",
    workspaceType: "item",
    workspaceLabel: "Paper A",
    libraryID: 1,
    defaultSource: {
      paperKey: "1:PAPER-A",
      libraryID: 1,
      attachmentItemID: 10,
      attachmentKey: "PDF-A",
    },
  };
}

function createSource(): SourceIdentity {
  return {
    sourceId: "1-PDF-A",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
    filePath: "/tmp/paper-a.pdf",
    mtime: 1,
    size: 100,
    pdfHash: PDF_HASH,
  };
}

function createSourceRef() {
  return {
    sourceId: "1-PDF-A",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    parentItemID: 20,
    parentItemKey: "PAPER-A",
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
  };
}

function createMaterial(source = createSource()): Material {
  return {
    dir: "/cache",
    manifest: {
      schemaVersion: 3,
      parser: "Zopilot PDF Helper/PyMuPDF4LLM",
      parserVersion: "test",
      source,
      builtAt: "2026-07-28T00:00:00.000Z",
      pageCount: 4,
      status: "ready",
      warnings: [],
    },
    markdown: "",
    text: "",
    pages: [
      { page: 1, text: "Introduction" },
      { page: 2, text: "Methods" },
      {
        page: 3,
        text: "Retrieval and ranking",
        imagePath: "/cache/page-0003.png",
      },
      { page: 4, text: "Conclusion" },
    ],
    blocks: [
      block("b-intro", 1, 0, "Introduction", "heading"),
      block("b-intro-text", 1, 1, "The paper studies retrieval."),
      block("b-methods", 2, 0, "Methods", "heading"),
      block("b-retrieval", 2, 1, "2.1 Retrieval", "heading"),
      block(
        "b-ranking",
        3,
        0,
        "We combine lexical retrieval with reciprocal rank fusion.",
      ),
      block("b-conclusion", 4, 0, "Conclusion", "heading"),
    ],
    outline: {
      status: "ready",
      provenance: "embedded",
      warnings: [],
      entries: [
        outline("section-0001", "Introduction", 1, 1, "b-intro"),
        outline("section-0002", "Methods", 1, 2, "b-methods"),
        outline("section-0003", "Retrieval", 2, 2, "b-retrieval"),
        outline("section-0004", "Conclusion", 1, 4, "b-conclusion"),
      ],
    },
    chunks: [
      {
        id: "chunk-000001",
        sourceId: source.sourceId,
        index: 0,
        kind: "body",
        title: "Introduction",
        sectionPath: ["Introduction"],
        pageStart: 1,
        pageEnd: 1,
        text: "The paper studies retrieval.",
        blockIds: ["b-intro-text"],
        artifactIds: [],
      },
      {
        id: "chunk-000002",
        sourceId: source.sourceId,
        index: 1,
        kind: "body",
        title: "Retrieval",
        sectionPath: ["Methods", "Retrieval"],
        pageStart: 2,
        pageEnd: 3,
        text: "We combine lexical retrieval with reciprocal rank fusion.",
        blockIds: ["b-ranking"],
        artifactIds: [],
      },
    ],
    artifacts: [],
  };
}

function block(
  id: string,
  page: number,
  index: number,
  text: string,
  type: Material["blocks"][number]["type"] = "paragraph",
) {
  return { id, page, index, text, type };
}

function outline(
  id: string,
  title: string,
  level: number,
  page: number,
  blockId: string,
) {
  return {
    id,
    title,
    level,
    page,
    blockId,
    provenance: "embedded" as const,
  };
}

async function assertRejected(
  action: () => Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await action();
    assert.fail("expected action to reject");
  } catch (error) {
    assert.match(String(error), pattern);
  }
}
