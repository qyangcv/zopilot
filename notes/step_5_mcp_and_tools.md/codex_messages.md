# Codex App Server 消息处理

本文记录 `zotero-copilot` 当前如何把 `codex app-server` 的消息接入 Zotero Copilot 侧栏。内容已按当前代码和本机 `codex app-server` 协议生成结果核对，并删去重复日志清单。

## 核对结论

| 内容 | 结论 | 依据 |
| --- | --- | --- |
| app-server 启动方式 | 吻合。当前通过 `codex app-server --stdio` 启动；`--stdio` 等价于 `--listen stdio://`。 | `src/codex/appServerConfig.ts`；`codex app-server --help` |
| thread 创建 | 吻合。`ensureThread()` 创建一个 ephemeral thread，注入 `config.mcp_servers` 和 `developerInstructions`；如果 app-server 不支持 `developerInstructions`，会删除该字段重试。 | `src/codex/bridge.ts` |
| turn 输入 | 吻合。每轮只通过 `turn/start` 发送一个 `type: "text"` 的 user input。当前 app-server schema 还支持 `image`、`localImage`、`skill`、`mention`，但本仓库没有使用这些输入。 | `src/codex/bridge.ts`；`codex app-server generate-ts --experimental` |
| PDF 上下文传递 | 吻合。当前 user turn 只包含用户原问题；没有直接塞入论文 metadata、abstract、selected text 或 full text。论文内容依赖 MCP `paper_read`。 | `src/codex/promptBuilder.ts`；`src/codex/developerInstructions.ts` |
| MCP 工具面 | 吻合。对 Codex 暴露的 Zotero MCP 配置只启用 `paper_read`；active paper 解析和检索逻辑留在内部。 | `src/codex/mcpConfig.ts`；`src/mcp/toolRegistry.ts` |
| `paper_read` 返回 | 需按当前实现收窄。内部会构造 evidence output，但 MCP 对外当前只返回 text content：匹配片段用 `---` 拼接；无片段时返回状态文本。未暴露 `structuredContent`。 | `src/mcp/tools/paperRead.ts`；`src/mcp/activePaperRetrievalService.ts` |
| UI 渲染边界 | 吻合。侧栏只渲染 user message、assistant placeholder、`item/agentMessage/delta` 累积文本、首个 assistant delta 前的 notice、fatal error 和空回复 fallback。 | `src/modules/sidebar/index.ts` |

## 发送给 Codex 的内容

`CodexBridge.ensureThread()` 在第一次提问前创建 thread：

- `params.ephemeral = true`。
- `params.cwd` 使用本机 HOME。
- `params.config.mcp_servers` 来自 `buildCodexMcpServersConfig()`，指向 Zotero 本地 HTTP MCP endpoint，并只启用 `paper_read`。
- `params.developerInstructions` 来自 `buildCodexDeveloperInstructions()`，要求需要论文信息时使用 `paper_read`，并避免描述 MCP tool、tool call 或内部流程。

`CodexBridge.runPrompt()` 每轮发送：

```ts
input: [
  {
    type: "text",
    text: prompt,
    text_elements: [],
  },
];
```

`buildPaperQuestionPrompt()` 当前直接返回用户问题。因此普通 user turn 不包含 PDF 文件、论文元数据、摘要、选中文本或全文。论文读取路径是：Codex 看到 developer instructions 后调用 `paper_read`，再由 Zotero MCP 读取当前 PDF reader 的 Zotero full text。

## app-server 消息分派

`readStdout()` 读取 app-server stdout 的 line-delimited JSON。`handleLine()` 的分派规则是：

- 同时有 `id` 和 `method`：视为 JSON-RPC server request；当前全部用 `-32601` 拒绝。
- 有 `id` 但无 `method`：视为 JSON-RPC response；用于 resolve/reject `request()`。
- 有 `method` 但无 `id`：视为 notification；交给 `handleNotification()`。

stderr、无效 JSON、MCP 配置注入、`developerInstructions` fallback 等只写入 Zotero Toolbox Console，不进入侧栏。

## 侧栏会显示什么

侧栏当前显示：

- 用户提交的原始 textarea 文本。
- 初始 assistant placeholder：`sidebar-codex-starting`。
- `item/agentMessage/delta` 的累积文本，并持续重渲染同一个 assistant bubble。
- 在 assistant delta 到达前出现的 retryable `error` 或 `warning` notice。
- fatal error，经 `formatCodexError()` 包成 Markdown code block。
- 空最终回复 fallback：`sidebar-codex-empty-response`。

`turn/completed` 到达后，最终 assistant 内容仍然是同一个 `activeTurn.fullText.trim()`。如果没有任何 delta，侧栏显示空回复 fallback。

## 侧栏不会显示什么

以下内容当前不会进入 Zotero Copilot chat UI，只可能写入 Zotero Toolbox Console 或被忽略：

- `turn/started`。
- `mcpServer/startupStatus/updated`。
- `item/mcpToolCall/progress`。
- `item/started` / `item/completed` 中包含 `mcpToolCall` 的 tool lifecycle item。
- `mcpServerStatus/list` 的结果或失败日志。
- app-server stderr、无效 JSON 解析日志。
- `codex mcp config unavailable`。
- `codex thread/start mcp config injected`。
- `developerInstructions unsupported` fallback 日志。
- 本地 MCP HTTP endpoint 的请求、鉴权拒绝、无效 JSON、response、smoke check、tool call start/finish/error 等诊断日志。

## 当前限制

当前 UI 不区分：

- tool 调用前的 assistant 过程文本。
- tool 调用后的最终回答文本。
- 多个 `agentMessage` item。
- tool-grounded answer 和 non-tool answer。

代码把所有 `item/agentMessage/delta` 都追加到同一个 `activeTurn.fullText`，并流式显示到同一个 assistant bubble。`turn/completed` 后，这个累积字符串就是 `result.text`。

因此，类似 “我先检查当前论文” 的文字如果出现在侧栏最终气泡中，原因不是 MCP event 被显示了，而是 app-server 把它作为 `item/agentMessage/delta` 发出；当前代码会把所有 agent message delta 都当作 assistant answer text。
