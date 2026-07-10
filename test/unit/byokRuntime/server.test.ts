import { assert } from "chai";
import { ByokRuntimeServer } from "../../../src/integrations/byok/runtime/ByokRuntimeServer.ts";
import type { ProviderProfileWithSecret } from "../../../src/domain/agent/types.ts";

describe("ByokRuntimeServer", function () {
  afterEach(function () {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it("serves initialize over newline-delimited JSON-RPC", async function () {
    const harness = createServerHarness();

    harness.send({ id: 1, method: "initialize" });
    await flush();

    assert.deepEqual(harness.messages, [
      {
        id: 1,
        result: {
          serverInfo: {
            name: "zopilot-byok-runtime",
            version: "1",
          },
        },
      },
    ]);
  });

  it("returns configured provider models from an OpenAI model endpoint", async function () {
    const harness = createServerHarness();
    (globalThis as { fetch: typeof fetch }).fetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "model-a" }, { id: "model-b" }],
        }),
        { status: 200 },
      );

    harness.send({
      id: 2,
      method: "model/list",
      params: { profile: createProfile() },
    });
    await flush();

    const response = harness.messages[0] as {
      result: Array<{ id: string; displayName: string }>;
    };
    assert.deepEqual(
      response.result.map((model) => [model.id, model.displayName]),
      [
        ["model-a", "model-a"],
        ["model-b", "model-b"],
      ],
    );
  });

  it("reports malformed JSON and unsupported methods without stopping", async function () {
    const harness = createServerHarness();

    harness.sendRaw("not-json");
    harness.send({ id: 3, method: "unknown" });
    await flush();

    assert.equal(harness.messages[0].method, "warning");
    assert.include(
      String((harness.messages[0].params as { message: string }).message),
      "Invalid BYOK runtime JSON",
    );
    assert.deepInclude(harness.messages[1], {
      id: 3,
      error: {
        code: -32000,
        message: "Unsupported BYOK runtime method: unknown",
      },
    });
  });

  it("aborts and acknowledges the selected run", async function () {
    const harness = createServerHarness();
    const controller = new AbortController();
    const server = harness.instance as unknown as {
      agentRunner: {
        abortControllers: Map<string, AbortController>;
      };
    };
    server.agentRunner.abortControllers.set("run-a", controller);

    harness.send({
      id: 4,
      method: "turn/interrupt",
      params: { runId: "run-a" },
    });
    await flush();

    assert.isTrue(controller.signal.aborted);
    assert.deepEqual(harness.messages, [{ id: 4, result: {} }]);
  });
});

type JsonMessage = Record<string, unknown>;

function createServerHarness(): {
  instance: ByokRuntimeServer;
  messages: JsonMessage[];
  send: (message: JsonMessage) => void;
  sendRaw: (line: string) => void;
} {
  const messages: JsonMessage[] = [];
  const instance = new ByokRuntimeServer({
    write: (line) => messages.push(JSON.parse(line) as JsonMessage),
    exit: () => undefined,
  });
  const server = instance as unknown as {
    handleLine: (line: string) => void;
  };
  return {
    instance,
    messages,
    send: (message) => server.handleLine(JSON.stringify(message)),
    sendRaw: (line) => server.handleLine(line),
  };
}

function createProfile(): ProviderProfileWithSecret {
  return {
    id: "provider-a",
    kind: "openai-compatible",
    preset: "openai-compatible",
    displayName: "Provider A",
    baseURL: "https://provider.example/v1",
    apiKeyRef: "provider-a",
    apiKey: "secret",
    hasApiKey: true,
    defaultModel: "configured-model",
    models: [
      {
        id: "configured-model",
        displayName: "Configured Model",
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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
