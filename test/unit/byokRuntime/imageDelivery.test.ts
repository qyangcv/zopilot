import { assert } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ByokAgentRunner,
  createByokMcpServer,
  withImageCapabilityHeader,
} from "../../../src/integrations/byok/runtime/ByokAgentRunner.ts";
import {
  parseOpenAIModelList,
  parseOpenRouterModelList,
} from "../../../src/integrations/byok/runtime/requestValidation.ts";
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

  it("preserves explicit input modalities without turning them into runtime policy", function () {
    const models = parseOpenAIModelList({
      data: [
        { id: "plain", input_modalities: ["text", "image"] },
        { id: "text-only", input_modalities: ["text"] },
        { id: "generic-modalities", modalities: ["text"] },
        { id: "vision-in-name-only" },
      ],
    });

    assert.deepEqual(
      models.map((model) => [model.id, model.inputModalities]),
      [
        ["plain", ["text", "image"]],
        ["text-only", ["text"]],
        ["generic-modalities", []],
        ["vision-in-name-only", []],
      ],
    );
  });

  it("reads OpenRouter image support from the architecture object", function () {
    const models = parseOpenRouterModelList({
      data: [
        {
          architecture: { input_modalities: ["text", "image"] },
          id: "author/vision",
        },
        {
          architecture: { input_modalities: ["text"] },
          id: "author/text-only",
        },
      ],
    });

    assert.deepEqual(
      models.map((model) => [model.id, model.inputModalities]),
      [
        ["author/vision", ["text", "image"]],
        ["author/text-only", ["text"]],
      ],
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

  it("initializes one Agents SDK Session from canonical history", async function () {
    const fixture = await createImageTurn();
    fixture.params.input.history = [
      {
        sequence: 1,
        userText: "Earlier question",
        assistantText: "Earlier answer",
        status: "completed",
      },
    ];
    fixture.params.input.prompt = "Current question";
    let modelInput: unknown;
    let sessionItems: unknown[] = [];
    const runner = new ByokAgentRunner({
      connectMcp: (async () => ({
        active: [],
        errors: new Map(),
        close: async () => undefined,
      })) as any,
      notify: () => undefined,
      runAgent: (async (_agent, input, options) => {
        modelInput = input;
        assert.equal(options.session.constructor.name, "SnapshotSession");
        sessionItems = await options.session.getItems();
        return createStream("Answer", undefined, "Answer");
      }) as any,
    });

    try {
      await runner.startTurn(fixture.params);
      assert.deepEqual(
        sessionItems.map((item: any) => item.role),
        ["user", "assistant"],
      );
      assert.include(JSON.stringify(sessionItems), "Earlier question");
      assert.include(JSON.stringify(sessionItems), "Earlier answer");
      assert.equal(count(JSON.stringify(modelInput), "Current question"), 1);
      assert.notInclude(JSON.stringify(modelInput), "Earlier question");
    } finally {
      await fixture.cleanup();
    }
  });

  it("streams locator turns before the provider attempt completes", async function () {
    const fixture = await createImageTurn();
    const notifications: Array<{ method: string; params?: any }> = [];
    fixture.params.input.prompt = "Analyze Figure 1";
    let releaseAttempt: (() => void) | undefined;
    const attemptGate = new Promise<void>((resolve) => {
      releaseAttempt = resolve;
    });
    let resolveFirstDelta: (() => void) | undefined;
    const firstDelta = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve;
    });
    const runner = new ByokAgentRunner({
      connectMcp: (async () => ({
        active: [],
        errors: new Map(),
        close: async () => undefined,
      })) as any,
      notify: (method, params) => {
        notifications.push({ method, params });
        if (method === "item/agentMessage/delta") resolveFirstDelta?.();
      },
      runAgent: (async () => createGatedStream("streamed", attemptGate)) as any,
    });

    try {
      let settled = false;
      const pending = runner.startTurn(fixture.params).finally(() => {
        settled = true;
      });
      await firstDelta;
      assert.isFalse(settled);
      assert.include(
        notifications
          .map((notification) => String(notification.params?.delta || ""))
          .join(""),
        "streamed",
      );
      releaseAttempt?.();
      assert.equal((await pending).text, "streamed");
    } finally {
      releaseAttempt?.();
      await fixture.cleanup();
    }
  });

  it("surfaces image rejection without retrying or hiding streamed events", async function () {
    const fixture = await createImageTurn();
    const notifications: Array<{ method: string; params?: any }> = [];
    let attempts = 0;
    const runner = new ByokAgentRunner({
      connectMcp: (async () => ({
        active: [],
        errors: new Map(),
        close: async () => undefined,
      })) as any,
      notify: (method, params) => notifications.push({ method, params }),
      runAgent: (async () => {
        attempts += 1;
        return createStream("visible-before-error", {
          statusCode: 400,
          message: "input_image is not supported by this model",
        });
      }) as any,
    });

    try {
      let caught: unknown;
      try {
        await runner.startTurn(fixture.params);
      } catch (error) {
        caught = error;
      }
      assert.equal(attempts, 1);
      assert.deepInclude(caught as Record<string, unknown>, {
        statusCode: 400,
        message: "input_image is not supported by this model",
      });
      assert.include(
        notifications
          .map((notification) => String(notification.params?.delta || ""))
          .join(""),
        "visible-before-error",
      );
      assert.notInclude(
        notifications.map((notification) => notification.method),
        "model/imageInputRejected",
      );
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

function createGatedStream(delta: string, gate: Promise<void>): any {
  return {
    cancelled: false,
    completed: Promise.resolve(),
    finalOutput: delta,
    async *[Symbol.asyncIterator]() {
      yield {
        type: "raw_model_stream_event",
        data: { type: "output_text_delta", delta },
      };
      await gate;
    },
  };
}

async function createImageTurn(): Promise<{
  cleanup: () => Promise<void>;
  params: TurnStartParams;
}> {
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
      threadId: "conversation-a",
      turnId: "turn-a",
      sequence: 1,
      history: [],
      context: {
        sources: [],
        selectedSources: [],
        noteContexts: [],
        localAttachments: [],
      },
      workspace: {
        id: "conversation-a",
        workspaceKey: "library:1",
        workspaceType: "library",
        workspaceLabel: "Library",
        workspaceTitle: "Library",
        libraryID: 1,
      },
      providerProfileId: "provider-a",
      prompt: "Describe the image",
      preparedLocalAttachments: {
        images: [{ filename: "image.png", path, mimeType: "image/png" }],
        omittedImageCount: 0,
        validAttachmentCount: 1,
        warnings: [],
      },
    },
    mcp: {
      url: "http://127.0.0.1:23119/zopilot/mcp",
      headers: { Authorization: "Bearer secret" },
      serverName: "zopilot",
      acceptsImages: true,
      timeoutMs: 30000,
    },
  };
  return {
    params,
    cleanup: () => rm(dir, { force: true, recursive: true }),
  };
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
