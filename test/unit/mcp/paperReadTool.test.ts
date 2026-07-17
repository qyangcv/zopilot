import { assert } from "chai";
import { createPaperReadTool } from "../../../src/integrations/mcp/tools/paperRead.ts";
import {
  PAPER_BINDING_MISSING_MESSAGE,
  type BoundWorkspaceScope,
} from "../../../src/integrations/mcp/workspaceBinding.ts";
import type { BuiltContext } from "../../../src/document/types.ts";

describe("paper_read MCP tool", function () {
  it("exposes the paper_read definition as a read-only context facade", function () {
    const tool = createTool(createContext("ready"));

    assert.equal(tool.definition.name, "paper_read");
    assert.isUndefined(
      tool.definition.inputSchema.properties?.sourceIds?.maxItems,
    );
    assert.include(tool.definition.description, "material cache");
    assert.isTrue(tool.definition.annotations?.readOnlyHint);
  });

  it("calls the context builder with the bound workspace and returns traceable context", async function () {
    let observedQuestion = "";
    let observedScope: BoundWorkspaceScope | undefined;
    const tool = createPaperReadTool({
      contextBuilder: {
        async build(input) {
          observedQuestion = input.question || "";
          observedScope = input.scope;
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      {
        question: "Explain Figure 2",
      },
      { workspaceScope: createScope() },
    );

    assert.isFalse(result.isError);
    assert.equal(observedQuestion, "Explain Figure 2");
    assert.equal(observedScope?.workspaceKey, "item:1:PAPER-A");
    assert.include(result.content[0].text, "Workspace: item item:1:PAPER-A");
    assert.include(result.content[0].text, "Evidence 1");
    assert.include(result.content[0].text, "label=Figure 2");
    assert.notInclude(result.content[0].text, "page=5");
    assert.include(result.content[0].text, "image=/cache/assets/page-0005.png");
    assert.notInclude(result.content[0].text, "Parser warning");
    assert.notInclude(result.content[0].text, "Markdown extraction failed");
    assert.notProperty(result, "structuredContent");
  });

  it("returns an error when paper_read has no bound workspace", async function () {
    const tool = createTool(createContext("not_bound"));

    const result = await tool.call(
      {
        question: "What is the method?",
      },
      { paperBindingError: PAPER_BINDING_MISSING_MESSAGE },
    );

    assert.isTrue(result.isError);
    assert.equal(result.content[0].text, PAPER_BINDING_MISSING_MESSAGE);
  });

  it("returns a source selection error for workspaces without a default PDF", async function () {
    const tool = createTool(createContext("no_source"));

    const result = await tool.call(
      {
        question: "What is the method?",
      },
      { workspaceScope: { ...createScope(), defaultSource: undefined } },
    );

    assert.isTrue(result.isError);
    assert.include(result.content[0].text, "no selected PDF source");
  });

  it("returns material pipeline failures as tool errors", async function () {
    const tool = createTool(createContext("material_error"));

    const result = await tool.call(
      {
        question: "What is Table 1?",
      },
      { workspaceScope: createScope() },
    );

    assert.isTrue(result.isError);
    assert.include(result.content[0].text, "PDF material pipeline failed");
    assert.include(result.content[0].text, "PyMuPDF4LLM");
  });

  it("passes validated selected sourceIds to the context builder", async function () {
    const source = createSourceRef("1-PDF-B", "Paper B");
    let observedSources = 0;
    const tool = createPaperReadTool({
      sourceUniverse: {
        async resolveSources() {
          return [source];
        },
      },
      contextBuilder: {
        async build(input) {
          observedSources = input.sources?.length || 0;
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      {
        question: "Compare methods",
        sourceIds: ["1-PDF-B"],
      },
      { workspaceScope: createScope() },
    );

    assert.isFalse(result.isError);
    assert.equal(observedSources, 1);
  });

  it("validates selected item PDFs against every PDF attachment", async function () {
    const alternate = createSourceRef("1-PDF-B", "Supplement.pdf");
    let usedItemPdfResolver = false;
    let observedSourceId = "";
    const tool = createPaperReadTool({
      sourceUniverse: {
        async resolveSources() {
          return [createSourceRef("1-PDF-A", "Main.pdf")];
        },
        async resolveItemPdfSources() {
          usedItemPdfResolver = true;
          return [createSourceRef("1-PDF-A", "Main.pdf"), alternate];
        },
      },
      contextBuilder: {
        async build(input) {
          observedSourceId = input.sources?.[0]?.sourceId || "";
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      {
        question: "Read the supplement",
        sourceIds: ["1-PDF-B"],
      },
      { workspaceScope: createScope() },
    );

    assert.isFalse(result.isError);
    assert.isTrue(usedItemPdfResolver);
    assert.equal(observedSourceId, alternate.sourceId);
  });

  it("validates sibling PDFs selected from a collection item tree", async function () {
    const alternate = createSourceRef("1-PDF-B", "Supplement.pdf");
    let observedWorkspaceType = "";
    const tool = createPaperReadTool({
      sourceUniverse: {
        async resolveSources() {
          return [createSourceRef("1-PDF-A", "Paper A")];
        },
        async resolveSelectedPdfSources(workspace, sourceIds) {
          observedWorkspaceType = workspace.workspaceType;
          assert.deepEqual(sourceIds, ["1-PDF-B"]);
          return [alternate];
        },
      },
      contextBuilder: {
        async build(input) {
          assert.equal(input.sources?.[0]?.sourceId, alternate.sourceId);
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      {
        question: "Read the supplement",
        sourceIds: ["1-PDF-B"],
      },
      {
        workspaceScope: {
          ...createScope(),
          workspaceKey: "collection:1:COLL",
          workspaceType: "collection",
          collectionKey: "COLL",
        },
      },
    );

    assert.isFalse(result.isError);
    assert.equal(observedWorkspaceType, "collection");
  });

  it("rejects selected sourceIds outside the bound workspace", async function () {
    const tool = createPaperReadTool({
      sourceUniverse: {
        async resolveSources() {
          return [createSourceRef("1-PDF-A", "Paper A")];
        },
      },
      contextBuilder: {
        async build() {
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      {
        question: "Compare methods",
        sourceIds: ["1-PDF-B"],
      },
      { workspaceScope: createScope() },
    );

    assert.isTrue(result.isError);
    assert.include(result.content[0].text, "outside the current workspace");
  });

  it("rejects unsupported paper_read input fields", async function () {
    const tool = createTool(createContext("ready"));

    try {
      await tool.call(
        {
          itemId: 1,
        },
        { workspaceScope: createScope() },
      );
      assert.fail("Expected invalid input to fail");
    } catch (error) {
      assert.include(
        String(error),
        "paper_read input contains unsupported field: itemId",
      );
    }
  });

  it("accepts every PDF selected inside one item context", async function () {
    const sources = Array.from({ length: 12 }, (_, index) =>
      createSourceRef(`source-${index}`, `Paper ${index}`),
    );
    let observedSourceCount = 0;
    const tool = createPaperReadTool({
      sourceUniverse: {
        async resolveSources() {
          return [];
        },
        async resolveItemPdfSources() {
          return sources;
        },
      },
      contextBuilder: {
        async build(input) {
          observedSourceCount = input.sources?.length || 0;
          return createContext("ready");
        },
      },
    });

    const result = await tool.call(
      { sourceIds: sources.map((source) => source.sourceId) },
      { workspaceScope: createScope() },
    );

    assert.isFalse(result.isError);
    assert.equal(observedSourceCount, 12);
  });
});

function createTool(context: BuiltContext) {
  return createPaperReadTool({
    contextBuilder: {
      async build() {
        return context;
      },
    },
  });
}

function createSourceRef(sourceId: string, title: string) {
  return {
    sourceId,
    paperKey: `1:${title.replace(/\s+/g, "-").toUpperCase()}`,
    libraryID: 1,
    parentItemID: 30,
    parentItemKey: title.replace(/\s+/g, "-").toUpperCase(),
    attachmentItemID: 31,
    attachmentKey: sourceId.slice(2),
    title,
  };
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

function createContext(status: BuiltContext["status"]): BuiltContext {
  const base: BuiltContext = {
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
    evidence: [],
    warnings: ["Markdown extraction failed; page text extraction was used."],
  };

  if (status === "not_bound") {
    return { ...base, warnings: [PAPER_BINDING_MISSING_MESSAGE] };
  }
  if (status === "no_source") {
    return {
      ...base,
      warnings: ["The current workspace has no selected PDF source."],
    };
  }
  if (status === "material_error") {
    return {
      ...base,
      warnings: ["PyMuPDF4LLM failed to parse the PDF."],
    };
  }
  return {
    ...base,
    evidence: [
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
        text: "Caption: Figure 2 summarizes the retrieval pipeline.",
      },
    ],
  };
}
