import { assert } from "chai";
import { ByokRuntimeBridge } from "../../../src/integrations/byok/ByokRuntimeBridge.ts";
import type {
  AgentPromptInput,
  ProviderProfileWithSecret,
} from "../../../src/domain/agent/types.ts";
import type { AgentStreamEvent } from "../../../src/domain/agent/streaming.ts";

describe("ByokRuntimeBridge", function () {
  it("lists models with the configured provider profile", async function () {
    const harness = createBridgeHarness();
    const profile = createProfile();
    const pending = harness.instance.listModels(profile);
    await flush();

    const request = harness.requests[0];
    assert.equal(request.method, "model/list");
    assert.deepInclude(request.params.profile as Record<string, unknown>, {
      id: profile.id,
      baseURL: profile.baseURL,
      apiKey: profile.apiKey,
    });
    harness.respond(request.id, profile.models);

    assert.deepEqual(await pending, profile.models);
  });

  it("routes streaming and tool notifications to the active run", async function () {
    const harness = createBridgeHarness();
    const profile = createProfile();
    const events: AgentStreamEvent[] = [];
    const pending = harness.instance.sendPrompt(profile, createPromptInput(), {
      onEvent: (event) => events.push(event),
    });
    await flush();

    const request = harness.requests[0];
    const runId = String(request.params.runId);
    assert.deepInclude(events[0], {
      type: "turn.started",
      runId,
      backendId: profile.id,
      providerProfileId: profile.id,
      sequence: 1,
    });
    assert.equal(request.method, "turn/start");
    harness.notify("item/agentMessage/delta", { runId, delta: "A" });
    harness.notify("item/reasoning/delta", {
      runId,
      itemId: "reasoning-a",
      kind: "content",
      delta: "Thinking",
    });
    harness.notify("item/tool/started", {
      runId,
      name: "paper_read",
      arguments: '{"question":"method"}',
    });
    harness.notify("warning", { runId, message: "retrying" });
    harness.notify("item/tool/completed", {
      runId,
      name: "paper_read",
      result: "Evidence",
    });
    harness.respond(request.id, {
      backendId: profile.id,
      providerProfileId: profile.id,
      runId,
      text: "Answer",
      status: "completed",
    });

    assert.deepInclude(await pending, {
      backendId: profile.id,
      providerProfileId: profile.id,
      runId,
      text: "Answer",
      status: "completed",
    });
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "turn.started",
        "content.append",
        "reasoning.append",
        "tool.started",
        "notice.upsert",
        "tool.completed",
        "turn.completed",
      ],
    );
    assert.deepInclude(events[1], {
      type: "content.append",
      expectedOffset: 0,
      delta: "A",
    });
    const toolEvents = events.filter(
      (event) =>
        event.type === "tool.started" || event.type === "tool.completed",
    );
    assert.equal(toolEvents[0]?.blockId, toolEvents[1]?.blockId);
  });

  it("interrupts the selected BYOK run", async function () {
    const harness = createBridgeHarness();
    const pending = harness.instance.interruptTurn("run-a");
    await flush();

    const request = harness.requests[0];
    assert.equal(request.method, "turn/interrupt");
    assert.deepEqual(request.params, { runId: "run-a" });
    harness.respond(request.id, {});
    await pending;
  });

  it("answers reverse paper_read requests over the same transport", async function () {
    const calls: unknown[] = [];
    const harness = createBridgeHarness(async (params) => {
      calls.push(params);
      return { text: "evidence", isError: false };
    });

    harness.requestFromRuntime(77, "tool/paper_read", {
      input: { question: "method" },
    });
    await flush();

    assert.deepEqual(calls, [{ input: { question: "method" } }]);
    const response = harness.responses.find((item) => item.id === 77);
    assert.deepEqual(response, {
      id: 77,
      result: { text: "evidence", isError: false },
    });
  });
});

type RpcRequest = {
  id: number;
  method: string;
  params: Record<string, unknown>;
};

type RpcResponse = {
  id: number;
  result?: unknown;
  error?: unknown;
};

function createBridgeHarness(
  callPaperRead?: (params: never) => Promise<{
    text: string;
    isError: boolean;
  }>,
): {
  instance: ByokRuntimeBridge;
  requests: RpcRequest[];
  responses: RpcResponse[];
  respond: (id: number, result: unknown) => void;
  notify: (method: string, params: unknown) => void;
  requestFromRuntime: (id: number, method: string, params: unknown) => void;
} {
  const instance = new ByokRuntimeBridge({ callPaperRead });
  const bridge = instance as unknown as {
    start: () => Promise<void>;
    process: unknown;
    handleLine: (line: string) => void;
  };
  const requests: RpcRequest[] = [];
  const responses: RpcResponse[] = [];
  bridge.start = async () => undefined;
  bridge.process = {
    stdin: {
      write: async (line: string) => {
        const message = JSON.parse(line) as RpcRequest | RpcResponse;
        if ("method" in message) {
          requests.push(message);
        } else {
          responses.push(message);
        }
      },
      close: async () => undefined,
    },
  };
  return {
    instance,
    requests,
    responses,
    respond: (id, result) => {
      bridge.handleLine(JSON.stringify({ id, result }));
    },
    notify: (method, params) => {
      bridge.handleLine(JSON.stringify({ method, params }));
    },
    requestFromRuntime: (id, method, params) => {
      bridge.handleLine(JSON.stringify({ id, method, params }));
    },
  };
}

function createProfile(): ProviderProfileWithSecret {
  return {
    id: "provider-a",
    kind: "openai-compatible",
    providerId: "custom",
    displayName: "Provider A",
    baseURL: "https://provider.example/v1",
    apiKeyRef: "provider-a",
    apiKey: "secret",
    hasApiKey: true,
    defaultModel: "model-a",
    models: [
      {
        id: "model-a",
        displayName: "Model A",
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium",
      },
    ],
    capabilities: {
      streaming: true,
      tools: true,
      images: false,
      cancellation: true,
      modelListing: true,
      reasoning: true,
      structuredOutput: false,
      usageMetadata: true,
    },
    timeoutMs: 30000,
    retryCount: 1,
    enabled: true,
    status: "connected",
  };
}

function createPromptInput(): AgentPromptInput {
  return {
    providerProfileId: "provider-a",
    conversation: {
      metadata: {
        id: "conv-a",
        scope: "workspace",
        workspaceKey: "item:1:paper-a",
        workspaceType: "item",
        workspaceLabel: "Paper A",
        workspaceTitle: "Paper A",
        libraryID: 1,
        label: "Conversation A",
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      messages: [],
    },
    prompt: "Question",
    model: "model-a",
    reasoningEffort: "medium",
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
