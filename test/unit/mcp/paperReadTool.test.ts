import { assert } from "chai";
import {
  PaperReadService,
  PAPER_READ_MAX_SOURCES,
} from "../../../src/application/document/PaperReadService.ts";
import type { BuiltContext } from "../../../src/document/types.ts";
import {
  PAPER_BINDING_MISSING_MESSAGE,
  type BoundWorkspaceScope,
} from "../../../src/integrations/mcp/workspaceBinding.ts";

describe("PaperReadService", function () {
  it("returns traceable text and structured evidence without local paths", async function () {
    const service = createService(createContext("ready"));
    const result = await service.read(
      { question: "Explain Figure 2" },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.isFalse(result.isError);
    assert.include(result.text, "sourceId=1-PDF");
    assert.include(result.text, "page=5");
    assert.include(result.text, "label=Figure 2");
    assert.notInclude(result.text, "/cache/");
    assert.equal(result.structuredContent.evidence[0].page, 5);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].mimeType, "image/png");
  });

  it("only returns page images for an explicit locator and image-capable client", async function () {
    const context = createContext("ready");
    const service = createService(context);
    const noImages = await service.read(
      { question: "Explain Figure 2" },
      { workspaceScope: createScope(), acceptsImages: false },
    );
    const general = await createService({
      ...context,
      query: { ...context.query, locator: undefined },
    }).read(
      { question: "Summarize the paper" },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.deepEqual(noImages.images, []);
    assert.deepEqual(general.images, []);
  });

  it("deduplicates page images and returns at most three", async function () {
    const context = createContext("ready");
    const first = context.evidence[0];
    context.evidence = [
      first,
      { ...first, artifactId: "duplicate", imagePath: first.imagePath },
      { ...first, artifactId: "figure-3", imagePath: "/cache/page-3.png" },
      { ...first, artifactId: "figure-4", imagePath: "/cache/page-4.png" },
      { ...first, artifactId: "figure-5", imagePath: "/cache/page-5.png" },
    ];
    const result = await createService(context).read(
      { question: "Compare the figures" },
      { workspaceScope: createScope(), acceptsImages: true },
    );

    assert.lengthOf(result.images, 3);
    assert.equal(new Set(result.images.map((image) => image.path)).size, 3);
  });

  it("maps not_bound to a tool error", async function () {
    await assertErrorStatus("not_bound");
  });

  it("maps no_source to a tool error", async function () {
    await assertErrorStatus("no_source");
  });

  it("maps material_error to a tool error", async function () {
    await assertErrorStatus("material_error");
  });

  it("keeps no_match as a successful, empty evidence result", async function () {
    const result = await createService(createContext("no_match")).read(
      { question: "Unknown topic" },
      { workspaceScope: createScope(), acceptsImages: true },
    );
    assert.isFalse(result.isError);
    assert.deepEqual(result.structuredContent.evidence, []);
  });

  it("passes selected workspace PDFs to the context builder", async function () {
    const selected = createSourceRef("1-PDF-B", "Supplement");
    let observedSourceId = "";
    const service = new PaperReadService({
      sourceUniverse: {
        async resolveSources() {
          return [];
        },
        async resolveSelectedPdfSources() {
          return [selected];
        },
      },
      contextBuilder: {
        async build(input) {
          observedSourceId = input.sources?.[0]?.sourceId || "";
          return createContext("ready");
        },
      },
    });

    const result = await service.read(
      { sourceIds: [selected.sourceId] },
      { workspaceScope: createScope(), acceptsImages: false },
    );
    assert.isFalse(result.isError);
    assert.equal(observedSourceId, selected.sourceId);
    assert.equal(PAPER_READ_MAX_SOURCES, 10);
  });

  it("rejects selected PDFs outside the bound workspace", async function () {
    const service = new PaperReadService({
      sourceUniverse: {
        async resolveSources() {
          return [];
        },
        async resolveSelectedPdfSources() {
          return [];
        },
      },
    });
    const result = await service.read(
      { sourceIds: ["1-OTHER"] },
      { workspaceScope: createScope(), acceptsImages: false },
    );
    assert.isTrue(result.isError);
    assert.equal(result.structuredContent.status, "invalid_source");
    assert.include(result.text, "outside the current workspace");
  });

  it("passes cancellation to the document builder", async function () {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const service = new PaperReadService({
      contextBuilder: {
        async build(input) {
          receivedSignal = input.signal;
          return createContext("ready");
        },
      },
    });

    await service.read(
      {},
      { workspaceScope: createScope(), acceptsImages: false },
      controller.signal,
    );

    assert.strictEqual(receivedSignal, controller.signal);
  });
});

async function assertErrorStatus(
  status: "not_bound" | "no_source" | "material_error",
): Promise<void> {
  const result = await createService(createContext(status)).read(
    { question: "Read the paper" },
    {
      workspaceScope: status === "not_bound" ? undefined : createScope(),
      bindingError:
        status === "not_bound" ? PAPER_BINDING_MISSING_MESSAGE : undefined,
      acceptsImages: true,
    },
  );
  assert.isTrue(result.isError);
  assert.equal(result.structuredContent.status, status);
}

function createService(context: BuiltContext): PaperReadService {
  return new PaperReadService({
    contextBuilder: {
      async build() {
        return context;
      },
    },
  });
}

function createScope(): BoundWorkspaceScope {
  return {
    conversationId: "conv-a",
    workspaceKey: "item:1:PAPER-A",
    workspaceType: "item",
    workspaceLabel: "Paper A",
    defaultSource: {
      paperKey: "1:PAPER-A",
      attachmentItemID: 10,
      attachmentKey: "PDF",
      libraryID: 1,
    },
  };
}

function createSourceRef(sourceId: string, title: string) {
  return {
    sourceId,
    paperKey: `1:${title}`,
    libraryID: 1,
    parentItemID: 30,
    parentItemKey: title,
    attachmentItemID: 31,
    attachmentKey: sourceId,
    title,
  };
}

function createContext(status: BuiltContext["status"]): BuiltContext {
  const warnings =
    status === "not_bound"
      ? [PAPER_BINDING_MISSING_MESSAGE]
      : status === "no_source"
        ? ["The current workspace has no selected PDF source."]
        : status === "material_error"
          ? ["PDF material pipeline failed."]
          : [];
  return {
    status,
    workspace: {
      key: "item:1:PAPER-A",
      type: "item",
      label: "Paper A",
    },
    sources:
      status === "not_bound" || status === "no_source"
        ? []
        : [
            {
              sourceId: "1-PDF",
              paperKey: "1:PAPER-A",
              libraryID: 1,
              attachmentItemID: 10,
              attachmentKey: "PDF",
              title: "Paper A",
              filePath: "/tmp/paper.pdf",
              mtime: 1,
              size: 1024,
              pdfHash: "hash",
            },
          ],
    query: {
      query: "Explain Figure 2",
      intent: "figure",
      locator: { type: "figure", value: "2" },
      includeReferences: false,
    },
    evidence:
      status === "ready"
        ? [
            {
              type: "artifact",
              sourceId: "1-PDF",
              artifactId: "1-PDF:figure:2",
              chunkId: "1-PDF:chunk:3",
              label: "Figure 2",
              page: 5,
              sectionPath: ["Experiments"],
              imagePath: "/cache/assets/page-0005.png",
              score: 1.8,
              reasons: ["exact artifact locator"],
              text: "Figure 2 summarizes the retrieval pipeline.",
            },
          ]
        : [],
    warnings,
  };
}
