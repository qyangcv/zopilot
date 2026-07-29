import { assert } from "chai";
import { buildCodexAppServerArguments } from "../../../src/integrations/codex/appServerConfig.ts";
import { CodexBridge } from "../../../src/integrations/codex/CodexBridge.ts";
import { shutdownMcpHttpServer } from "../../../src/integrations/mcp/httpServer.ts";
import type { ThreadRunInput } from "../../../src/domain/thread.ts";
import { configureLocaleFormatter } from "../../../src/app/localization.ts";

describe("CodexBridge", function () {
  beforeEach(function () {
    installMcpMocks();
    configureLocaleFormatter((id) =>
      id === "sidebar-codex-paper-tools-unavailable"
        ? "Paper tools unavailable; continuing without them."
        : id,
    );
  });

  afterEach(function () {
    shutdownMcpHttpServer();
    configureLocaleFormatter(undefined);
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("starts app-server over stdio without legacy Zotero overrides", function () {
    const args = buildCodexAppServerArguments();

    assert.deepEqual(args, ["app-server", "--stdio"]);
    assert.notInclude(args, 'plugins."zotero@openai-curated".enabled=false');
    assert.notInclude(args, "mcp_servers.llm_for_zotero.enabled=false");
  });

  it("requests model/list and normalizes returned model metadata", async function () {
    const bridge = createBridgeHarness();
    const promise = bridge.instance.listModels();
    await bridge.flush();

    const request = bridge.requests[0];
    assert.strictEqual(request.method, "model/list");
    assert.deepEqual(request.params, { limit: 100, includeHidden: false });

    bridge.respond(request.id, {
      data: [
        {
          id: "gpt-5.4",
          model: "gpt-5.4",
          displayName: "GPT-5.4",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low", description: "Lower latency" },
            { reasoningEffort: "medium", description: "Balanced" },
          ],
        },
        {
          model: "gpt-5.5",
          display_name: "GPT-5.5",
          default_reasoning_level: "high",
          supported_reasoning_levels: [
            { effort: "low", description: "Fast" },
            { effort: "high", description: "Deep" },
          ],
        },
        {
          model: "gpt-5.3-codex",
          name: "gpt-5.3-codex",
        },
      ],
    });

    assert.deepEqual(await promise, [
      {
        slug: "gpt-5.4",
        displayName: "GPT-5.4",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "medium"],
      },
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: ["low", "high"],
      },
      {
        slug: "gpt-5.3-codex",
        displayName: "GPT-5.3-Codex",
        defaultReasoningEffort: undefined,
        supportedReasoningEfforts: [],
      },
    ]);
  });

  it("sends selected model and reasoning effort to turn/start", async function () {
    const bridge = createBridgeHarness();
    const run = createRun("conv-a", "thread-conv-a");
    const promise = bridge.instance.sendPrompt("Question", {
      run,
      model: "gpt-5.6-terra",
      effort: "high",
    });
    await bridge.flush();

    const start = bridge.requests[0];
    assert.strictEqual(start.method, "turn/start");
    assert.strictEqual(start.params.threadId, "thread-conv-a");
    assert.strictEqual(start.params.model, "gpt-5.6-terra");
    assert.strictEqual(start.params.reasoningEffort, "high");
    assert.strictEqual(start.params.effort, "high");
    assert.strictEqual(start.params.approvalPolicy, "never");
    assert.deepEqual(start.params.sandboxPolicy, {
      type: "readOnly",
      networkAccess: false,
    });
    assert.notEqual(start.params.cwd, "/Users/test");

    bridge.respond(start.id, { turn: { id: "turn-a" } });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-a",
      turnId: "turn-a",
      delta: "Answer",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-a",
      turn: { id: "turn-a", status: "completed" },
    });

    assert.deepInclude(await promise, {
      threadId: "thread-conv-a",
      turnId: "turn-a",
      text: "Answer",
      status: "completed",
    });
  });

  it("does not apply the turn/start deadline to an active turn", async function () {
    const bridge = createBridgeHarness();
    bridge.setTurnStartTimeoutMs(5);
    const promise = bridge.instance.sendPrompt("Question", {
      run: createRun("conv-long", "thread-conv-long"),
    });
    await bridge.flush();

    const start = bridge.requests[0];
    bridge.respond(start.id, { turn: { id: "turn-long" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-long",
      turnId: "turn-long",
      delta: "Late answer",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-long",
      turn: { id: "turn-long", status: "completed" },
    });

    assert.equal((await promise).text, "Late answer");
  });

  it("streams reasoning, commentary, MCP tools, and final answer separately", async function () {
    const bridge = createBridgeHarness();
    const events: Array<Record<string, unknown>> = [];
    const promise = bridge.instance.sendPrompt("Question", {
      backendId: "codex-cli.default",
      run: createRun("conv-trace", "thread-conv-trace"),
      providerProfileId: "codex-cli.default",
      onEvent: (event) => events.push(event),
    });
    await bridge.flush();

    const start = bridge.requests[0];
    bridge.respond(start.id, { turn: { id: "turn-trace" } });
    bridge.notify("item/reasoning/textDelta", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      itemId: "reasoning-a",
      delta: "Inspecting the paper",
    });
    bridge.notify("item/started", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      item: {
        id: "commentary-a",
        type: "agentMessage",
        phase: "commentary",
        text: "",
      },
    });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      itemId: "commentary-a",
      delta: "Reading evidence",
    });
    bridge.notify("item/started", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      item: {
        type: "mcpToolCall",
        server: "zopilot",
        tool: "paper_read",
        status: "inProgress",
        arguments: { question: "method" },
      },
    });
    bridge.notify("item/completed", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      item: {
        type: "mcpToolCall",
        server: "zopilot",
        tool: "paper_read",
        status: "completed",
        arguments: { question: "method" },
        result: {
          content: [{ type: "text", text: "Evidence" }],
          structuredContent: {
            status: "ready",
            evidence: [{ sourceId: "1-PDF", page: 5 }],
          },
        },
      },
    });
    bridge.notify("item/started", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      item: {
        id: "answer-a",
        type: "agentMessage",
        phase: "final_answer",
        text: "",
      },
    });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-trace",
      turnId: "turn-trace",
      itemId: "answer-a",
      delta: "Answer",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-trace",
      turn: { id: "turn-trace", status: "completed" },
    });

    assert.equal((await promise).text, "Answer");
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "turn.started",
        "reasoning.append",
        "content.append",
        "tool.started",
        "tool.completed",
        "content.append",
        "turn.completed",
      ],
    );
    const toolEvents = events.filter(
      (event) =>
        event.type === "tool.started" || event.type === "tool.completed",
    ) as Array<{ blockId: string }>;
    assert.equal(toolEvents[0]?.blockId, toolEvents[1]?.blockId);
    assert.deepInclude(toolEvents[1] as Record<string, unknown>, {
      risk: "read-only",
      result: '[\n  {\n    "type": "text",\n    "text": "Evidence"\n  }\n]',
      structuredContent: {
        status: "ready",
        evidence: [{ sourceId: "1-PDF", page: 5 }],
      },
    });
  });

  it("keeps Codex tool parameters out of stable tool names", async function () {
    const bridge = createBridgeHarness();
    const events: Array<Record<string, unknown>> = [];
    const promise = bridge.instance.sendPrompt("Question", {
      run: createRun("conv-tools", "thread-conv-tools"),
      onEvent: (event) =>
        events.push(event as unknown as Record<string, unknown>),
    });
    await bridge.flush();

    const start = bridge.requests[0];
    bridge.respond(start.id, { turn: { id: "turn-tools" } });
    bridge.notify("item/completed", {
      threadId: "thread-conv-tools",
      turnId: "turn-tools",
      item: {
        id: "web-a",
        type: "webSearch",
        query: "DeepSeek-R1 paper arXiv official",
        action: {
          type: "search",
          query: "DeepSeek-R1 paper arXiv official",
          queries: null,
        },
        results: [],
      },
    });
    bridge.notify("item/completed", {
      threadId: "thread-conv-tools",
      turnId: "turn-tools",
      item: {
        id: "command-a",
        type: "commandExecution",
        command: "rg Figure paper.txt",
        status: "completed",
        aggregatedOutput: "Figure 1",
      },
    });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-tools",
      turnId: "turn-tools",
      delta: "Answer",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-tools",
      turn: { id: "turn-tools", status: "completed" },
    });

    await promise;
    const tools = events.filter((event) => event.type === "tool.completed");
    assert.deepEqual(
      tools.map((event) => event.name),
      ["web_search", "command"],
    );
    assert.include(String(tools[0]?.arguments), "DeepSeek-R1 paper");
    assert.include(String(tools[1]?.arguments), "rg Figure paper.txt");
    assert.notInclude(String(tools[0]?.name), "DeepSeek-R1");
    assert.notInclude(String(tools[1]?.name), "rg Figure");
  });

  it("opens new Codex threads with multi-tool paper instructions", async function () {
    const bridge = createBridgeHarness();
    const run = createRun("conv-new");
    const promise = bridge.instance.sendPrompt("Question", {
      run,
    });
    await bridge.flush();

    const threadStart = bridge.requests[0];
    assert.strictEqual(threadStart.method, "thread/start");
    assert.strictEqual(threadStart.params.ephemeral, false);
    assert.strictEqual(threadStart.params.approvalPolicy, "never");
    assert.strictEqual(threadStart.params.sandbox, "read-only");
    assert.include(
      String(threadStart.params.developerInstructions),
      "get_outline",
    );
    const mcpServer = (
      threadStart.params.config as {
        mcp_servers: {
          zopilot: {
            url: string;
            http_headers: Record<string, string> & { Authorization: string };
            enabled_tools: string[];
            startup_timeout_sec: number;
            tool_timeout_sec: number;
          };
        };
      }
    ).mcp_servers["zopilot"];
    assert.equal(mcpServer.url, "http://127.0.0.1:23124/zopilot/mcp");
    assert.match(mcpServer.http_headers.Authorization, /^Bearer /);
    assert.equal(
      mcpServer.http_headers["X-Zopilot-Conversation-ID"],
      "conv-new",
    );
    assert.equal(
      mcpServer.http_headers["X-Zopilot-Workspace-Key"],
      "item:1:conv-new",
    );
    assert.equal(mcpServer.http_headers["X-Zopilot-Workspace-Type"], "item");
    assert.deepEqual(
      JSON.parse(mcpServer.http_headers["X-Zopilot-Thread-Sources"]),
      run.context.sources,
    );
    assert.equal(
      mcpServer.http_headers["X-Zopilot-Primary-Source-ID"],
      run.context.primarySourceId,
    );
    assert.equal(mcpServer.http_headers["X-Zopilot-Library-ID"], "1");
    assert.deepEqual(mcpServer.enabled_tools, [
      "get_outline",
      "search",
      "read",
      "view_page",
    ]);
    assert.equal(mcpServer.startup_timeout_sec, 10);
    assert.equal(mcpServer.tool_timeout_sec, 60);
    assert.notProperty(mcpServer, "required");

    bridge.respond(threadStart.id, { thread: { id: "thread-new" } });
    await bridge.flush();

    const turnStart = bridge.requests.find(
      (request) => request.method === "turn/start",
    );
    assert.isDefined(turnStart);
    bridge.respond(turnStart!.id, { turn: { id: "turn-new" } });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-new",
      turnId: "turn-new",
      delta: "Answer",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-new",
      turn: { id: "turn-new", status: "completed" },
    });

    assert.deepInclude(await promise, {
      threadId: "thread-new",
      turnId: "turn-new",
      text: "Answer",
      status: "completed",
    });
  });

  it("shows a non-blocking notice when Zopilot MCP registration fails", async function () {
    const bridge = createBridgeHarness();
    const events: Array<Record<string, unknown>> = [];
    const promise = bridge.instance.sendPrompt("Question", {
      run: createRun("conv-mcp-failure"),
      onEvent: (event) =>
        events.push(event as unknown as Record<string, unknown>),
    });
    await bridge.flush();

    const threadStart = bridge.requests[0];
    assert.strictEqual(threadStart.method, "thread/start");
    bridge.notify("mcpServer/startupStatus/updated", {
      threadId: "thread-mcp-failure",
      name: "zopilot",
      status: "failed",
      error: "HTTP 502",
      failureReason: null,
    });
    bridge.respond(threadStart.id, {
      thread: { id: "thread-mcp-failure" },
    });
    await bridge.flush();

    const turnStart = bridge.requests.find(
      (request) => request.method === "turn/start",
    );
    assert.isDefined(turnStart);
    bridge.respond(turnStart!.id, { turn: { id: "turn-mcp-failure" } });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-mcp-failure",
      turnId: "turn-mcp-failure",
      delta: "Answer without paper tools",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-mcp-failure",
      turn: { id: "turn-mcp-failure", status: "completed" },
    });

    assert.equal((await promise).text, "Answer without paper tools");
    assert.deepInclude(
      events.find((event) => event.type === "notice.upsert"),
      {
        type: "notice.upsert",
        text: "Paper tools unavailable; continuing without them.",
      },
    );
    assert.include(
      events.map((event) => event.type),
      "turn.completed",
    );
  });

  it("interrupts a specific turn by threadId and turnId", async function () {
    const bridge = createBridgeHarness();
    const promise = bridge.instance.interruptTurn("thread-a", "turn-a");
    await bridge.flush();

    const request = bridge.requests[0];
    assert.strictEqual(request.method, "turn/interrupt");
    assert.deepEqual(request.params, {
      threadId: "thread-a",
      turnId: "turn-a",
    });
    bridge.respond(request.id, {});
    await promise;
  });

  it("declines unexpected write and MCP elicitation approvals", async function () {
    const instance = new CodexBridge();
    const responses: unknown[] = [];
    const bridge = instance as unknown as {
      transport: { send(message: unknown): Promise<void> };
      rejectServerRequest(message: {
        id: number;
        method: string;
        params?: Record<string, unknown>;
      }): void;
    };
    bridge.transport = {
      async send(message) {
        responses.push(message);
      },
    };

    bridge.rejectServerRequest({
      id: 1,
      method: "item/commandExecution/requestApproval",
    });
    bridge.rejectServerRequest({
      id: 2,
      method: "item/fileChange/requestApproval",
    });
    bridge.rejectServerRequest({
      id: 3,
      method: "mcpServer/elicitation/request",
    });
    await Promise.resolve();

    assert.deepEqual(responses, [
      { id: 1, result: { decision: "decline" } },
      { id: 2, result: { decision: "decline" } },
      { id: 3, result: { action: "decline" } },
    ]);
  });

  it("demultiplexes concurrent turn notifications by thread and turn", async function () {
    const bridge = createBridgeHarness();
    const first = bridge.instance.sendPrompt("First", {
      run: createRun("conv-a", "thread-conv-a"),
    });
    const second = bridge.instance.sendPrompt("Second", {
      run: createRun("conv-b", "thread-conv-b"),
    });
    await bridge.flush();

    const firstStart = bridge.requests[0];
    const secondStart = bridge.requests[1];
    bridge.respond(firstStart.id, { turn: { id: "turn-a" } });
    bridge.respond(secondStart.id, { turn: { id: "turn-b" } });

    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-b",
      turnId: "turn-b",
      delta: "B",
    });
    bridge.notify("item/agentMessage/delta", {
      threadId: "thread-conv-a",
      turnId: "turn-a",
      delta: "A",
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-a",
      turn: { id: "turn-a", status: "interrupted" },
    });
    bridge.notify("turn/completed", {
      threadId: "thread-conv-b",
      turn: { id: "turn-b", status: "completed" },
    });

    assert.deepInclude(await first, {
      threadId: "thread-conv-a",
      turnId: "turn-a",
      text: "A",
      status: "interrupted",
    });
    assert.deepInclude(await second, {
      threadId: "thread-conv-b",
      turnId: "turn-b",
      text: "B",
      status: "completed",
    });
  });
});

type JsonRpcTestRequest = {
  id: number;
  method: string;
  params: Record<string, unknown>;
};

function createBridgeHarness(): {
  instance: CodexBridge;
  requests: JsonRpcTestRequest[];
  flush: () => Promise<void>;
  respond: (id: number, result: unknown) => void;
  notify: (method: string, params: unknown) => void;
  setTurnStartTimeoutMs: (timeoutMs: number) => void;
} {
  const instance = new CodexBridge();
  const bridge = instance as unknown as {
    start: () => Promise<void>;
    getTurnStartTimeoutMs: () => number;
    process: unknown;
    getTransport: () => {
      handleLine: (line: string) => void;
    };
  };
  const requests: JsonRpcTestRequest[] = [];
  bridge.start = async () => undefined;
  bridge.getTurnStartTimeoutMs = () => 30000;
  bridge.process = {
    stdin: {
      write: async (line: string) => {
        const request = JSON.parse(line) as JsonRpcTestRequest;
        if (request.method === "thread/resume") {
          queueMicrotask(() =>
            bridge.getTransport().handleLine(
              JSON.stringify({
                id: request.id,
                result: {
                  thread: { id: request.params.threadId },
                },
              }),
            ),
          );
          return;
        }
        requests.push(request);
      },
      close: async () => undefined,
    },
  };
  return {
    instance,
    requests,
    flush: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    respond: (id, result) => {
      bridge.getTransport().handleLine(JSON.stringify({ id, result }));
    },
    notify: (method, params) => {
      bridge.getTransport().handleLine(JSON.stringify({ method, params }));
    },
    setTurnStartTimeoutMs: (timeoutMs) => {
      bridge.getTurnStartTimeoutMs = () => timeoutMs;
    },
  };
}

function installMcpMocks(): void {
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Prefs: {
      get: (name: string) => (name === "httpServer.port" ? 23124 : undefined),
    },
    Server: {
      Endpoints: {},
    },
  };
}

function createRun(id: string, externalThreadId?: string): ThreadRunInput {
  const source = {
    sourceId: `zotero:1:${id}-pdf`,
    paperKey: `1:${id}`,
    libraryID: 1,
    parentItemKey: id,
    attachmentItemID: 1,
    attachmentKey: `${id}-pdf`,
    title: id,
  };
  return {
    threadId: id,
    turnId: `zopilot-turn-${id}`,
    sequence: 1,
    prompt: "Question",
    history: [],
    context: {
      sources: [source],
      selectedSources: [],
      primarySourceId: source.sourceId,
      noteContexts: [],
      localAttachments: [],
    },
    workspace: {
      id,
      workspaceKey: `item:1:${id}`,
      workspaceType: "item",
      workspaceLabel: id,
      workspaceTitle: id,
      libraryID: 1,
      defaultSource: {
        paperKey: `1:${id}`,
        libraryID: 1,
        parentItemKey: id,
        attachmentItemID: 1,
        attachmentKey: `${id}-pdf`,
        title: id,
      },
    },
    providerProfileId: "codex-cli.default",
    binding: externalThreadId
      ? {
          threadId: id,
          adapterKey: "codex-cli",
          externalThreadId,
          syncedThroughSequence: 0,
          state: "clean",
          updatedAt: "2026-06-13T00:00:00.000Z",
        }
      : undefined,
  };
}
