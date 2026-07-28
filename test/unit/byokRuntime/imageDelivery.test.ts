import { assert } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ByokAgentRunner,
  createByokMcpServer,
  isUnsupportedImageError,
  withImageCapabilityHeader,
} from "../../../src/integrations/byok/runtime/ByokAgentRunner.ts";
import { parseOpenAIModelList } from "../../../src/integrations/byok/runtime/requestValidation.ts";
import type { TurnStartParams } from "../../../src/integrations/byok/runtime/requestValidation.ts";

describe("BYOK image delivery", function () {
  it("uses structured MCP results as the canonical model output", function () {
    const server = createByokMcpServer(
      {
        url: "http://127.0.0.1/zopilot/mcp",
        serverName: "zopilot",
        headers: {
          Authorization: "Bearer test-token",
          "X-Zopilot-MCP-Accepts-Images": "1",
        },
        acceptsImages: true,
        timeoutMs: 30_000,
      },
      false,
    );

    assert.isTrue(server.useStructuredContent);
  });

  it("only trusts explicit input modalities and never guesses from names", function () {
    const models = parseOpenAIModelList({
      data: [
        { id: "plain", input_modalities: ["text", "image"] },
        { id: "text-only", input_modalities: ["text"] },
        { id: "generic-modalities", modalities: ["text"] },
        { id: "vision-in-name-only" },
      ],
    });

    assert.deepEqual(
      models.map((model) => [model.id, model.imageInputRejected]),
      [
        ["plain", undefined],
        ["text-only", true],
        ["generic-modalities", undefined],
        ["vision-in-name-only", undefined],
      ],
    );
  });

  it("only classifies explicit image incompatibility errors", function () {
    assert.isTrue(
      isUnsupportedImageError({
        statusCode: 400,
        message: "input_image is not supported by this model",
      }),
    );
    assert.isTrue(
      isUnsupportedImageError({
        message: "Failed to deserialize the JSON body: unknown variant `image`",
      }),
    );
    assert.isTrue(
      isUnsupportedImageError({
        statusCode: 400,
        message:
          "Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image`",
      }),
    );
    assert.isFalse(
      isUnsupportedImageError({
        statusCode: 413,
        message: "image is too large",
      }),
    );
    assert.isFalse(
      isUnsupportedImageError({
        statusCode: 500,
        message: "vision service unavailable",
      }),
    );
    assert.isFalse(
      isUnsupportedImageError({
        statusCode: 400,
        message: "invalid temperature",
      }),
    );
    assert.isFalse(
      isUnsupportedImageError({
        statusCode: 400,
        message: "image rejected by content policy moderation",
      }),
    );
  });

  it("replaces the MCP image header without changing other headers", function () {
    assert.deepEqual(
      withImageCapabilityHeader(
        {
          Authorization: "Bearer secret",
          "x-zopilot-accepts-images": "true",
        },
        false,
      ),
      {
        Authorization: "Bearer secret",
        "X-Zopilot-Accepts-Images": "false",
      },
    );
  });

  it("discards the rejected image attempt and retries once without images", async function () {
    const fixture = await createImageTurn();
    const notifications: Array<{ method: string; params?: any }> = [];
    const inputs: unknown[] = [];
    let attempt = 0;
    let closeCount = 0;
    const runner = new ByokAgentRunner({
      connectMcp: (async () => ({
        active: [],
        errors: new Map(),
        close: async () => {
          closeCount += 1;
        },
      })) as any,
      notify: (method, params) => notifications.push({ method, params }),
      runAgent: (async (_agent: unknown, input: unknown) => {
        inputs.push(input);
        attempt += 1;
        return attempt === 1
          ? createStream("discarded", {
              statusCode: 400,
              message: "input_image is not supported by this model",
            })
          : createStream("retry", undefined, "retry");
      }) as any,
    });

    try {
      const result = await runner.startTurn(fixture.params);
      assert.equal(result.text, "retry");
      assert.lengthOf(inputs, 2);
      assert.isArray(inputs[0]);
      assert.isString(inputs[1]);
      assert.include(String(inputs[1]), "were not sent");
      assert.include(String(inputs[1]), "Do not claim");
      assert.equal(closeCount, 2);
      assert.notInclude(
        notifications
          .map((notification) => String(notification.params?.delta || ""))
          .join(""),
        "discarded",
      );
      assert.include(
        notifications
          .map((notification) => String(notification.params?.message || ""))
          .join(""),
        "1 张图片未发送",
      );
      assert.deepInclude(
        notifications.find(
          (notification) => notification.method === "model/imageInputRejected",
        )?.params,
        {
          modelId: "model-a",
        },
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not create a positive model capability after image success", async function () {
    const fixture = await createImageTurn({ withMcp: false });
    const runner = new ByokAgentRunner({
      notify: () => undefined,
      runAgent: (async () => createStream("ok", undefined, "ok")) as any,
    });

    try {
      const result = await runner.startTurn(fixture.params);
      assert.equal(result.text, "ok");
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats every BYOK provider the same until an image is rejected", async function () {
    const fixture = await createImageTurn({ withMcp: false });
    fixture.params.profile.providerId = "deepseek";
    let receivedInput: unknown;
    const runner = new ByokAgentRunner({
      notify: () => undefined,
      runAgent: (async (_agent: unknown, input: unknown) => {
        receivedInput = input;
        return createStream("ok", undefined, "ok");
      }) as any,
    });

    try {
      await runner.startTurn(fixture.params);
      assert.isArray(receivedInput);
    } finally {
      await fixture.cleanup();
    }
  });
});

function createStream(delta: string, failure?: unknown, finalOutput = ""): any {
  return {
    cancelled: false,
    completed: Promise.resolve(),
    finalOutput,
    async *[Symbol.asyncIterator]() {
      yield {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta },
      };
      if (failure) throw failure;
    },
  };
}

async function createImageTurn(
  options: { withMcp?: boolean } = {},
): Promise<{ cleanup: () => Promise<void>; params: TurnStartParams }> {
  const dir = await mkdtemp(join(tmpdir(), "zopilot-image-capability-"));
  const path = join(dir, "image.png");
  await writeFile(
    path,
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  );
  const params: TurnStartParams = {
    runId: "run-image-capability",
    profile: {
      id: "provider-a",
      kind: "openai-compatible",
      providerId: "custom",
      displayName: "Provider",
      baseURL: "https://provider.example/v1",
      apiKey: "secret",
      defaultModel: "model-a",
      models: [
        {
          id: "model-a",
          displayName: "Model A",
          supportedReasoningEfforts: ["medium"],
        },
      ],
      capabilities: {
        streaming: true,
        tools: options.withMcp !== false,
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
          id: "conversation-a",
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
        images: [{ filename: "image.png", path, mimeType: "image/png" }],
        omittedImageCount: 0,
        validAttachmentCount: 1,
        warnings: [],
      },
    },
    ...(options.withMcp === false
      ? {}
      : {
          mcp: {
            url: "http://127.0.0.1:23119/zopilot/mcp",
            headers: { Authorization: "Bearer secret" },
            serverName: "zopilot",
            acceptsImages: true,
            timeoutMs: 30000,
          },
        }),
  };
  return {
    params,
    cleanup: () => rm(dir, { force: true, recursive: true }),
  };
}
