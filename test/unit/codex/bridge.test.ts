import { assert } from "chai";
import { buildCodexAppServerArguments } from "../../../src/integrations/codex/appServerConfig.ts";
import { CodexBridge } from "../../../src/integrations/codex/CodexBridge.ts";
import { shutdownMcpHttpServer } from "../../../src/integrations/mcp/httpServer.ts";
import type { ConversationMetadata } from "../../../src/domain/conversation.ts";

describe("CodexBridge", function () {
  beforeEach(function () {
    installMcpMocks();
  });

  afterEach(function () {
    shutdownMcpHttpServer();
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
    bridge.cacheThread("conv-a");
    const conversation = createConversation("conv-a");
    const promise = bridge.instance.sendPrompt("Question", {
      conversation,
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

  it("streams reasoning, commentary, MCP tools, and final answer separately", async function () {
    const bridge = createBridgeHarness();
    bridge.cacheThread("conv-trace");
    const events: Array<{ type: string }> = [];
    const promise = bridge.instance.sendPrompt("Question", {
      conversation: createConversation("conv-trace"),
      onTraceEvent: (event) => events.push(event),
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
        id: "call-a",
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
        id: "call-a",
        type: "mcpToolCall",
        server: "zopilot",
        tool: "paper_read",
        status: "completed",
        arguments: { question: "method" },
        result: { content: [{ type: "text", text: "Evidence" }] },
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
        "reasoning.delta",
        "content.delta",
        "tool.started",
        "tool.completed",
        "content.delta",
      ],
    );
  });

  it("opens new Codex threads with paper_read developer instructions", async function () {
    const bridge = createBridgeHarness();
    const conversation = createConversation("conv-new");
    const promise = bridge.instance.sendPrompt("Question", {
      conversation,
    });
    await bridge.flush();

    const threadStart = bridge.requests[0];
    assert.strictEqual(threadStart.method, "thread/start");
    assert.strictEqual(threadStart.params.ephemeral, false);
    assert.include(
      String(threadStart.params.developerInstructions),
      "paper_read",
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
    assert.equal(mcpServer.http_headers["X-Zopilot-Paper-Key"], "1:conv-new");
    assert.equal(mcpServer.http_headers["X-Zopilot-Attachment-Item-ID"], "1");
    assert.equal(
      mcpServer.http_headers["X-Zopilot-Attachment-Key"],
      "conv-new-pdf",
    );
    assert.equal(mcpServer.http_headers["X-Zopilot-Library-ID"], "1");
    assert.deepEqual(mcpServer.enabled_tools, ["paper_read"]);
    assert.equal(mcpServer.startup_timeout_sec, 10);
    assert.equal(mcpServer.tool_timeout_sec, 60);

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

  it("demultiplexes concurrent turn notifications by thread and turn", async function () {
    const bridge = createBridgeHarness();
    bridge.cacheThread("conv-a");
    bridge.cacheThread("conv-b");
    const first = bridge.instance.sendPrompt("First", {
      conversation: createConversation("conv-a"),
    });
    const second = bridge.instance.sendPrompt("Second", {
      conversation: createConversation("conv-b"),
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
  cacheThread: (conversationId: string) => void;
} {
  const instance = new CodexBridge();
  const bridge = instance as unknown as {
    start: () => Promise<void>;
    getTimeoutMs: () => number;
    threads: {
      threads: Map<string, string>;
    };
    process: unknown;
    handleLine: (line: string) => void;
  };
  const requests: JsonRpcTestRequest[] = [];
  bridge.start = async () => undefined;
  bridge.getTimeoutMs = () => 30000;
  bridge.process = {
    stdin: {
      write: async (line: string) => {
        requests.push(JSON.parse(line) as JsonRpcTestRequest);
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
      bridge.handleLine(JSON.stringify({ id, result }));
    },
    notify: (method, params) => {
      bridge.handleLine(JSON.stringify({ method, params }));
    },
    cacheThread: (conversationId) => {
      bridge.threads.threads.set(conversationId, `thread-${conversationId}`);
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

function createConversation(id: string): ConversationMetadata {
  return {
    id,
    scope: "workspace",
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
    label: id,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  };
}
