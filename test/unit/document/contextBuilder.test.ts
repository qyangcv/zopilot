import { assert } from "chai";
import { DocumentContextBuilder } from "../../../src/document/contextBuilder.ts";
import type {
  Material,
  SourceIdentity,
  WorkspaceQueryScope,
} from "../../../src/document/types.ts";

describe("DocumentContextBuilder", function () {
  it("builds artifact evidence with page and image locators", async function () {
    const builder = createBuilder();

    const context = await builder.build({
      scope: createScope(),
      question: "Explain Figure 2",
    });

    assert.equal(context.status, "ready");
    assert.equal(context.query.intent, "figure");
    assert.equal(context.evidence[0]?.type, "artifact");
    assert.equal(context.evidence[0]?.label, "Figure 2");
    assert.equal(context.evidence[0]?.page, 5);
    assert.equal(context.evidence[0]?.imagePath, "/cache/page-0005.png");
    assert.include(context.evidence[0]?.text || "", "retrieval pipeline");
  });

  it("retrieves section-aware text evidence for natural-language questions", async function () {
    const builder = createBuilder();

    const context = await builder.build({
      scope: createScope(),
      question: "What retrieval method does the paper use?",
    });

    assert.equal(context.status, "ready");
    assert.equal(context.query.intent, "general");
    assert.include(
      context.evidence.map((item) => item.sectionPath.join("/")),
      "Method",
    );
    assert.include(
      context.evidence.map((item) => item.text).join("\n"),
      "lexical retrieval with RRF and structural boost",
    );
  });

  it("adds a neutral document map for broad questions", async function () {
    const builder = createBuilder();

    const context = await builder.build({
      scope: createScope(),
      question: "Explain the paper.",
    });

    assert.equal(context.status, "ready");
    assert.equal(context.query.intent, "general");
    assert.equal(context.evidence[0]?.sectionPath.join("/"), "Document map");
    assert.include(context.evidence[0]?.text || "", "Section outline:");
    assert.include(context.evidence[0]?.text || "", "Abstract");
    assert.include(context.evidence[0]?.text || "", "Method");
    assert.notInclude(context.evidence[0]?.text || "", "pretraining");
    assert.notInclude(context.evidence[0]?.text || "", "specialized rl");
    assert.notInclude(context.evidence[0]?.text || "", "unified rft");
  });
});

function createBuilder(): DocumentContextBuilder {
  const source = createSource();
  return new DocumentContextBuilder({
    sourceResolver: {
      async resolveDefaultSource(scope: WorkspaceQueryScope) {
        return scope.defaultSource ? source : null;
      },
    },
    materialCache: {
      async getOrBuild() {
        return createMaterial(source);
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
    defaultSource: {
      paperKey: "1:PAPER-A",
      libraryID: 1,
      attachmentItemID: 10,
      attachmentKey: "PDF",
    },
  };
}

function createSource(): SourceIdentity {
  return {
    sourceId: "1-PDF",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    attachmentItemID: 10,
    attachmentKey: "PDF",
    title: "Paper A",
    filePath: "/tmp/paper.pdf",
    mtime: 1,
    size: 1000,
    pdfHash: "hash",
  };
}

function createMaterial(source: SourceIdentity): Material {
  return {
    dir: "/cache",
    manifest: {
      schemaVersion: 1,
      parser: "PyMuPDF4LLM/PyMuPDF",
      parserVersion: "test",
      source,
      builtAt: "2026-07-01T00:00:00.000Z",
      pageCount: 8,
      status: "ready",
      warnings: [],
    },
    markdown: "# Paper A",
    text: "Paper A",
    pages: [
      { page: 2, text: "method lexical retrieval" },
      {
        page: 5,
        text: "Figure 2 shows the retrieval pipeline.",
        imagePath: "/cache/page-0005.png",
      },
    ],
    chunks: [
      {
        id: "1-PDF:chunk:0",
        sourceId: "1-PDF",
        index: 0,
        kind: "abstract",
        title: "Abstract",
        sectionPath: ["Abstract"],
        pageStart: 1,
        pageEnd: 1,
        text: "This paper studies PDF reading.",
        artifactIds: [],
      },
      {
        id: "1-PDF:chunk:1",
        sourceId: "1-PDF",
        index: 1,
        kind: "body",
        title: "Method",
        sectionPath: ["Method"],
        pageStart: 2,
        pageEnd: 2,
        text: "The method uses lexical retrieval with RRF and structural boost.",
        artifactIds: [],
      },
      {
        id: "1-PDF:chunk:2",
        sourceId: "1-PDF",
        index: 2,
        kind: "caption",
        title: "Experiments",
        sectionPath: ["Experiments"],
        pageStart: 5,
        pageEnd: 5,
        text: "Figure 2: The retrieval pipeline combines chunks and artifacts.",
        artifactIds: ["1-PDF:figure:2"],
      },
    ],
    artifacts: [
      {
        id: "1-PDF:figure:2",
        type: "figure",
        label: "Figure 2",
        page: 5,
        caption: "The retrieval pipeline combines chunks and artifacts.",
        imagePath: "/cache/page-0005.png",
        surroundingChunkIds: ["1-PDF:chunk:2"],
        confidence: 0.9,
      },
    ],
  };
}
