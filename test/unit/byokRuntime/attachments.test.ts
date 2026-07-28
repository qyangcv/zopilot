import { assert } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalAttachmentPreparer } from "../../../src/application/agent/LocalAttachmentPreparer.ts";
import {
  buildAgentInput,
  detectImageMimeType,
} from "../../../src/integrations/byok/runtime/ByokAgentRunner.ts";
import type { Material } from "../../../src/document/types.ts";
import type { TurnStartParams } from "../../../src/integrations/byok/runtime/requestValidation.ts";

describe("BYOK local attachments", function () {
  afterEach(function () {
    delete (globalThis as { IOUtils?: unknown }).IOUtils;
  });

  it("keeps image attachments while omitting model input", async function () {
    const preparer = new LocalAttachmentPreparer();
    const result = await preparer.prepare({
      attachments: [
        {
          id: "image-a",
          kind: "image",
          path: "/tmp/image.png",
          filename: "image.png",
          mimeType: "image/png",
        },
      ],
      prompt: "Describe this",
      imagePolicy: "omit",
    });
    assert.deepEqual(result.images, []);
    assert.equal(result.omittedImageCount, 1);
    assert.equal(result.validAttachmentCount, 1);
  });

  it("uses locally parsed PDF evidence and related page images", async function () {
    installStatMock(1024);
    const preparer = new LocalAttachmentPreparer({
      buildPdfMaterial: async () => createPdfMaterial(),
    });
    const result = await preparer.prepare({
      attachments: [
        {
          id: "pdf-a",
          kind: "pdf",
          path: "/tmp/paper.pdf",
          filename: "paper.pdf",
          mimeType: "application/pdf",
        },
      ],
      prompt: "Explain Figure 2",
      imagePolicy: "include",
    });

    assert.include(result.text, "file=paper.pdf");
    assert.include(result.text, "page=2");
    assert.equal(result.images[0].path, "/tmp/page-2.png");
    assert.equal(result.images[0].page, 2);
  });

  it("builds structured Agents input with a verified image data URL", async function () {
    const dir = await mkdtemp(join(tmpdir(), "zopilot-attachment-"));
    const path = join(dir, "image.png");
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    await writeFile(path, png);
    try {
      const input = await buildAgentInput(
        createTurnParams(path),
        () => undefined,
      );
      assert.isArray(input);
      const image = (input as any)[0].content[1];
      assert.equal(image.type, "input_image");
      assert.match(image.image, /^data:image\/png;base64,/);
      assert.equal(detectImageMimeType(png), "image/png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function installStatMock(size: number): void {
  (globalThis as { IOUtils?: unknown }).IOUtils = {
    stat: async () => ({ size, lastModified: 1 }),
  };
}

function createPdfMaterial(): Material {
  const source = {
    sourceId: "local-paper",
    paperKey: "local:paper",
    libraryID: 0,
    attachmentItemID: 0,
    attachmentKey: "paper",
    title: "paper.pdf",
    filePath: "/tmp/paper.pdf",
    mtime: 1,
    size: 1024,
    pdfHash: "hash",
  };
  return {
    dir: "/tmp/material",
    manifest: {
      schemaVersion: 1,
      parser: "test",
      parserVersion: "1",
      source,
      builtAt: "2026-07-26T00:00:00.000Z",
      pageCount: 2,
      status: "ready",
      warnings: [],
    },
    markdown: "",
    text: "",
    pages: [{ page: 2, text: "Figure 2 result", imagePath: "/tmp/page-2.png" }],
    blocks: [],
    outline: {
      status: "unavailable",
      provenance: "unavailable",
      entries: [],
      warnings: [],
    },
    chunks: [
      {
        id: "chunk-2",
        sourceId: source.sourceId,
        index: 0,
        kind: "body",
        sectionPath: ["Results"],
        pageStart: 2,
        pageEnd: 2,
        text: "Figure 2 result",
        blockIds: [],
        artifactIds: ["figure-2"],
      },
    ],
    artifacts: [
      {
        id: "figure-2",
        type: "figure",
        label: "Figure 2",
        page: 2,
        caption: "Figure 2 result",
        imagePath: "/tmp/page-2.png",
        surroundingChunkIds: ["chunk-2"],
        confidence: 1,
      },
    ],
  };
}

function createTurnParams(path: string): TurnStartParams {
  return {
    runId: "run-a",
    profile: {
      id: "provider-a",
      kind: "openai-compatible",
      providerId: "custom",
      displayName: "Provider",
      baseURL: "https://provider.example/v1",
      apiKey: "secret",
      models: [],
      capabilities: {
        streaming: true,
        tools: true,
        images: true,
        cancellation: true,
        modelListing: true,
        reasoning: false,
        structuredOutput: false,
        usageMetadata: false,
      },
      timeoutMs: 30000,
      retryCount: 0,
      enabled: true,
      status: "connected",
    },
    input: {
      conversation: {
        metadata: {
          id: "conv-a",
          scope: "workspace",
          workspaceKey: "library:1",
          workspaceType: "library",
          workspaceLabel: "Library",
          workspaceTitle: "Library",
          libraryID: 1,
          label: "Conversation",
          createdAt: "2026-07-26T00:00:00.000Z",
          updatedAt: "2026-07-26T00:00:00.000Z",
        },
        messages: [],
      },
      prompt: "Describe the image",
      preparedLocalAttachments: {
        images: [
          {
            filename: "image.png",
            path,
            mimeType: "image/png",
          },
        ],
        warnings: [],
        omittedImageCount: 0,
        validAttachmentCount: 1,
      },
    },
  };
}
