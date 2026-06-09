# Codex App Server Message Handling

This note records how `zotero-copilot` currently handles messages from `codex app-server`.

## Input sent to Codex

`CodexBridge.ensureThread()` creates one ephemeral Codex thread and injects:

- `params.config.mcp_servers`, built by `buildCodexMcpServersConfig()`.
- `params.developerInstructions`, built by `buildCodexDeveloperInstructions()`.

`CodexBridge.runPrompt()` sends each user turn through `turn/start` with one text input:

```ts
input: [
  {
    type: "text",
    text: prompt,
    text_elements: [],
  },
];
```

At the sidebar layer, `buildPaperQuestionPrompt()` currently returns only the user question. There is no paper metadata, abstract, selected text, full text, or tool routing text in the visible user turn.

## Message routing

`readStdout()` reads line-delimited JSON from the app-server process. `handleLine()` classifies each parsed message:

- JSON-RPC server request: message has both `id` and `method`.
- JSON-RPC response: message has `id` but no `method`.
- JSON-RPC notification: message has `method` but no `id`.

Unsupported server requests are rejected with `-32601`. JSON-RPC responses resolve or reject pending `request()` promises. Notifications are routed by `handleNotification()`.

## Special handling

### Turn lifecycle

`turn/started`

- Reads `params.turn.id`.
- Stores it on the active turn as `turnId`.
- Does not render anything in the sidebar.

`turn/completed`

- Reads `params.turn.status`.
- If status is not `completed`, rejects the active turn and marks bridge status as `error`.
- Otherwise resolves `{ threadId, turnId, text }`, where `text` is `activeTurn.fullText.trim()`.
- The sidebar then renders `result.text` as the assistant message.

### Agent text delta

`item/agentMessage/delta`

- Reads `params.delta`.
- Appends it to `activeTurn.fullText`.
- Calls `onDelta(delta, activeTurn.fullText)`.
- The sidebar immediately re-renders the assistant bubble with the accumulated `fullText`.

Current important consequence: all `agentMessage` deltas are treated as assistant answer text. The bridge does not distinguish pre-tool status text, process narration, and final answer text.

### Retry/error/warning notices

`error`

- Formats `params.error.message` plus `params.error.additionalDetails`.
- If `params.willRetry` is true, sends the formatted text to `onNotice()` and logs `"codex app-server retrying"`.
- Otherwise rejects the active turn and marks bridge status as `error`.

`warning`

- Reads `params.message`, or falls back to `"Codex app-server warning."`.
- Sends it to `onNotice()`.
- Logs `"codex app-server warning"`.

Sidebar behavior:

- `onNotice()` is displayed only if no assistant text has arrived yet.
- Once any `agentMessage/delta` has arrived, later notices are not rendered in the chat bubble.

### MCP status and tool events

`mcpServer/startupStatus/updated`

- Logged to Zotero Toolbox Console as `"codex mcp startup status"`.
- Not rendered in the sidebar.

`item/mcpToolCall/progress`

- Logged as `"codex mcp tool progress"`.
- Not rendered in the sidebar.

`item/started` and `item/completed`

- If `message.params` contains `"mcpToolCall"`, logged as `"codex mcp tool item item/started"` or `"codex mcp tool item item/completed"`.
- Not rendered in the sidebar.
- Non-MCP items are ignored.

`mcpServerStatus/list`

- After thread creation, `logMcpServerStatus()` calls `mcpServerStatus/list`.
- The result is logged as `"codex mcp server status list"`.
- Failures are logged as `"codex mcp server status list failed"`.
- Nothing is rendered in the sidebar.

## Excluded from sidebar rendering

These app-server messages are currently excluded from the Zotero Copilot chat UI:

- `turn/started`
- `mcpServer/startupStatus/updated`
- `item/mcpToolCall/progress`
- `item/started` / `item/completed` for MCP tool calls
- `mcpServerStatus/list` result
- app-server stderr
- invalid JSON parse logs
- `codex mcp config unavailable`
- `codex thread/start mcp config injected`
- `developerInstructions unsupported` retry log

They may still be visible in Zotero Toolbox Console through `ztoolkit.log()`.

## Displayed without separation

The current main UI does not separate:

- process text before a tool call
- final answer text after a tool call
- multiple `agentMessage` items
- tool-grounded answer text vs non-tool answer text

Everything that arrives as `item/agentMessage/delta` is appended into one `activeTurn.fullText` string and streamed into the same assistant bubble. On `turn/completed`, that same accumulated string becomes `result.text`.

This is why text such as “I will first check the current paper” can appear in the final assistant bubble: it is an `agentMessage` delta, not an MCP event, and the current code treats every `agentMessage` delta as answer text.

## Displayed in Zotero Copilot sidebar

The sidebar chat currently shows:

- User message: the raw textarea value submitted by the user.
- Initial assistant placeholder: `sidebar-codex-starting`.
- Streaming assistant content: accumulated `item/agentMessage/delta` text.
- Final assistant content: `result.text` after `turn/completed`.
- Notice content before assistant text starts: `warning` or retryable `error` notice.
- Fatal errors: formatted by `formatCodexError()` as a Markdown code block.
- Empty final response fallback: `sidebar-codex-empty-response`.

## Displayed in Zotero Toolbox Console

The following categories are logged with `ztoolkit.log()` and appear in the Toolbox Console:

- App-server stderr: `"codex app-server stderr"`.
- Invalid app-server JSON: `"invalid codex app-server JSON"`.
- MCP config failure: `"codex mcp config unavailable"`.
- Thread MCP injection: `"codex thread/start mcp config injected"`.
- Unsupported `developerInstructions` fallback: `"codex thread/start developerInstructions unsupported; retrying without visible fallback"`.
- Retryable app-server errors: `"codex app-server retrying"`.
- App-server warnings: `"codex app-server warning"`.
- MCP startup status: `"codex mcp startup status"`.
- MCP tool progress: `"codex mcp tool progress"`.
- MCP tool item start/completion: `"codex mcp tool item item/started"` / `"codex mcp tool item item/completed"`.
- MCP server status list: `"codex mcp server status list"` or `"codex mcp server status list failed"`.

The local MCP server also logs:

- `"mcp.http.start"` / `"mcp.http.stop"`.
- `"mcp.http.smoke.ok"` / `"mcp.http.smoke.error"`.
- `"mcp.http.request"`.
- `"mcp.lifecycle.initialized"`.
- `"mcp.http.request.error"`.
- `"mcp.tool.paper_read.start"`.
- `"mcp.tool.paper_read.finish"`.
- `"mcp.tool.paper_read.error"`.

These logs are diagnostic output only. They are not rendered in the Zotero Copilot chat panel.
