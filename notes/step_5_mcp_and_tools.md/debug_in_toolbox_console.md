这次日志整体说明：MCP 框架已经跑通，而且 Codex app-server 真实调用了 `paper_read`。

按截图顺序看：

**1. app-server 开始启动 MCP servers**

```text
codex mcp startup status { name: "node_repl", status: "starting" }
codex mcp startup status { name: "codex_apps", status: "starting" }
codex mcp startup status { name: "zotero-copilot", status: "starting" }
```

来源：`CodexBridge.handleNotification()` 处理 `mcpServer/startupStatus/updated`，见 [bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:440)。

含义：

- `node_repl`、`codex_apps` 是 Codex 环境里已有的 MCP。
- `zotero-copilot` 是我们注入的 MCP server。
- 看到 `zotero-copilot starting`，说明 `thread/start.config.mcp_servers` 已被 app-server 接收。

**2. app-server 连接 Zotero MCP endpoint**

```text
mcp.http.request { id: 0, method: "initialize" }
mcp.http.response { count: 1, durationMs: 0 }
```

来源：

- 每个 MCP HTTP JSON-RPC 请求都会在 [httpServer.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/httpServer.ts:232) 打 `mcp.http.request`。
- 返回响应时在 [httpServer.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/httpServer.ts:207) 打 `mcp.http.response`。

含义：

- Codex app-server 已经真实访问 Zotero 本地 endpoint。
- `initialize` 成功返回，说明 HTTP、token、JSON-RPC 基础握手通过。

**3. app-server 列工具**

```text
mcp.http.request { id: 1, method: "tools/list" }
mcp.http.response { count: 1, durationMs: 0 }
codex mcp startup status { name: "zotero-copilot", status: "ready" }
```

来源：

- `tools/list` 由 [httpServer.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/httpServer.ts:264) 分发到 registry。
- registry 当前只返回 `paper_read`，见 [toolRegistry.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/toolRegistry.ts:18)。

含义：

- Codex app-server 已看到 Zotero MCP server 的 tool list。
- `zotero-copilot ready` 是关键成功信号：server 可连接，工具可发现。

**4. 这一行不是 MCP 主问题**

```text
codex app-server stderr ... failed to refresh available models: timeout waiting for child process to exit
```

来源：app-server stderr 被 [bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:334) 透传。

含义：

- 这是 Codex app-server 刷新模型列表超时。
- 不是 Zotero MCP endpoint 的错误。
- 后面 `paper_read` 成功调用，所以这次 MCP 链路没有被它阻断。

**5. 模型真正开始调用 tool**

```text
codex mcp tool item item/started
mcp.http.request { id: 2, method: "tools/call" }
mcp.tool.call.start { name: "paper_read" }
```

来源：

- `item/started` 是 app-server 通知，被 [bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:454) 捕获。
- `tools/call` 在 [httpServer.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/httpServer.ts:268) 分发。
- `mcp.tool.call.start` 在 [httpServer.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/httpServer.ts:304) 打出。

含义：

- 这不是 smoke test。
- 这是一次真实对话里，Codex 决定调用 `paper_read`。

**6. `paper_read` handler 执行成功**

```text
mcp.tool.paper_read.start { hasQuestion: true, maxChars: 20000 }
mcp.tool.paper_read.finish { status: "active_reader", hasPaper: true, durationMs: 0 }
mcp.tool.call.finish { name: "paper_read", isError: false, durationMs: 1 }
```

来源：

- `paper_read.start/finish` 在 [paperRead.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/tools/paperRead.ts:69)。
- 它会解析输入、调用 `ZoteroContextGateway.getActivePaper()`，见 [paperRead.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/tools/paperRead.ts:169)。
- `active_reader` 输出由 [paperRead.ts](/Users/yang/code/zotero/zotero-copilot/src/mcp/tools/paperRead.ts:188) 生成。

含义：

- `hasQuestion: true`：Codex 传了阅读意图/问题。
- `maxChars: 20000`：走了默认 budget。
- `status: "active_reader"`：找到了当前 Zotero PDF reader。
- `hasPaper: true`：当前 reader paper scope 有效。
- `isError: false`：tool call 没报错。

**7. app-server 收到 tool 结果**

```text
mcp.http.response { count: 1, durationMs: 1 }
codex mcp tool item item/completed
```

含义：

- Zotero MCP endpoint 已把 `paper_read` result 返回给 Codex app-server。
- app-server 认为这个 tool item 完成。
- 到这里，完整链路已经跑通：

```text
用户提问
-> Codex app-server
-> tools/call paper_read
-> Zotero MCP HTTP endpoint
-> paper_read handler
-> ZoteroContextGateway active reader scope
-> tool result
-> Codex app-server item/completed
```

一个小细节：截图里这行：

```text
mcp.http.request { id: null, method: "notifications/initialized" }
mcp.http.response { count: 1 }
```

说明 Codex 发的是 MCP 标准 notification 名字 `notifications/initialized`。当前代码只特判了 `"initialized"`，所以它可能给 notification 返回了一个响应。现在没有阻断链路，但后续应该补一个兼容处理：对 `notifications/initialized` 也不返回 body。这是协议细节优化，不影响你截图里这次 `paper_read` 成功。

你以后判断是否跑通，重点看这四个信号：

```text
zotero-copilot status: "ready"
mcp.http.request method: "tools/list"
mcp.http.request method: "tools/call"
mcp.tool.paper_read.finish status: "active_reader", hasPaper: true
```

这四个同时出现，就说明 MCP server 被发现、工具被列出、工具被真实调用、Zotero 当前 reader scope 被拿到。
