# Step 5 MCP 与 paper_read 实施方案

更新时间：2026-06-09

## 结论

Step 5 只做一件事：让 Codex 在当前 Zotero PDF reader scope 下，通过 MCP 只读调用 `paper_read`，按需读取当前论文内容。

公开 MCP tool 只保留：

```text
paper_read
```

不公开：

```text
get_active_paper
paper_search
get_paper_metadata
read_selected_text
chunk_read
pdf_path_read
library_search
note_write
metadata_write
```

`get_active_paper` 是内部 scope resolver。`paper_search` 是内部 retrieval/search 能力。它们都不应成为模型可见 tool。

## 当前实现状态

1. 当前仓库已实现 MCP transport skeleton。
   - `src/mcp/httpServer.ts` 注册 Zotero 本地 HTTP MCP endpoint：`/zotero-copilot/mcp`。
   - `src/mcp/protocol.ts` 定义 MCP / JSON-RPC 基础类型与响应 helper。
   - `src/mcp/toolRegistry.ts` 只注册并暴露 `paper_read`。
   - `src/mcp/tools/paperRead.ts` 实现 `paper_read` skeleton：校验输入，解析当前 active reader scope，返回 scope/status，占位说明后续会接入 evidence path。
   - `src/codex/mcpConfig.ts` 生成 `thread/start.config.mcp_servers` 配置。

2. 当前 `CodexBridge` 仍启动：

   ```text
   codex app-server --stdio
   ```

   但 `thread/start` 已注入临时 MCP 配置：

   ```text
   config.mcp_servers.zotero-copilot.url
   config.mcp_servers.zotero-copilot.http_headers.Authorization
   config.mcp_servers.zotero-copilot.enabled_tools = ["paper_read"]
   ```

   app-server 发来的无关 server request 仍由 bridge 以 `-32601` 拒绝。

3. 本机 `codex-cli 0.137.0` 已验证：
   - `thread/start.params.config` 存在。
   - `config.mcp_servers.<name>` 可在 `thread/start` 时注入临时 MCP server。
   - `mcpServerStatus/list` 能看到注入的 server 和 tools。
   - `mcpServer/tool/call` 能手动调用 dummy MCP tool。
   - `item/mcpToolCall/progress`、`mcpServer/startupStatus/updated` 是真实 app-server notifications，可通过 Zotero Toolbox Console 查看，不需要额外做 UI diagnostics。

4. Codex MCP 配置使用：

   ```toml
   [mcp_servers.<server-name>]
   ```

   支持：
   - STDIO server: `command` / `args`。
   - Streamable HTTP server: `url`。

5. MCP 当前标准 transport 是：
   - `stdio`
   - `Streamable HTTP`

   不应按旧 HTTP+SSE 方案新写实现。

参考：
- Codex MCP: https://developers.openai.com/codex/mcp
- MCP transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports

## 已有 transport 记录

已完成：

- 插件 startup 时调用 `startMcpHttpServer()`，在 Zotero 内置 HTTP server 上注册 `/zotero-copilot/mcp`；shutdown 时删除 endpoint。
- HTTP MCP endpoint 支持 `initialize`、`initialized`、`ping`、`tools/list`、`tools/call`。
- endpoint 使用随机 bearer token；请求会校验 `Authorization`、`Host`、`Origin`、HTTP method 和 JSON body。
- `tools/list` 只返回 `paper_read`，不公开 `get_active_paper`、`paper_search` 或任何写操作。
- `paper_read` 当前是 skeleton：输入只接受 `question?: string` 和 `maxChars?: number`；输出当前 reader scope/status、warnings 和 `_meta`，不读取全文、不返回 PDF path。
- `CodexBridge.ensureThread()` 在 `thread/start` 时注入 MCP server config，并在 thread 创建后调用 `mcpServerStatus/list` 记录 app-server 侧可见状态。
- `CodexBridge.handleNotification()` 已记录 `mcpServer/startupStatus/updated`、`item/mcpToolCall/progress`，以及包含 `mcpToolCall` 的 `item/started` / `item/completed`。这些日志用于 Zotero Toolbox Console 调试，不做单独 UI diagnostics。
- `promptBuilder` 当前已加入 tool routing 指令；后续 evidence path 接入时应进一步收薄为 MCP-first 最小 prompt。

调试日志链路：

```text
mcp.http.start
mcp.http.request
mcp.http.response
mcp.http.smoke.ok / mcp.http.smoke.error
mcp.tool.call.start / mcp.tool.call.finish
mcp.tool.paper_read.start / mcp.tool.paper_read.finish / mcp.tool.paper_read.error
codex thread/start mcp config injected
codex mcp server status list
codex mcp startup status
codex mcp tool progress
```

已加测试：

```text
unit/mcp/toolRegistry.test.ts
unit/mcp/httpServer.test.ts
unit/codex/mcpConfig.test.ts
```

当前验证结果：

```text
npm run test:unit  # 14 passing
npm run build      # passed
npm test           # startup test passed
```

`npm run lint:check` 仍受 notes 目录中既有 Prettier 警告影响；本次新增/修改的代码文件已单独通过 Prettier 与 ESLint。

## 最终架构

```text
用户问题
  -> sidebar
  -> buildPaperQuestionPrompt()
  -> CodexBridge
  -> codex app-server
  -> MCP tool call: zotero-copilot.paper_read
  -> Zotero local MCP endpoint
  -> PaperReadToolHandler
  -> RetrievalService
  -> ZoteroContextGateway
  -> current PDF reader attachment / metadata / full text
  <- evidence package
  <- Codex 基于 evidence 回答
```

推荐接入方式：

```text
Zotero plugin exposes localhost Streamable HTTP MCP endpoint
CodexBridge injects it through thread/start.config.mcp_servers
```

不推荐把 Zotero reader MCP 做成 stdio server。stdio server 是 Codex 启动的子进程，默认拿不到正在运行的 Zotero reader state；当前 Step 5 的核心数据恰恰在 Zotero 进程内。

## 安全边界

必须满足：

- 只读。
- 只读当前 active PDF reader 对应 attachment。
- 不读全库。
- 不接受任意 `itemId`、`libraryId`、local path。
- 不把 PDF path 暴露给模型。
- 不写 note。
- 不改 metadata。
- 不删除、移动 attachment。
- 不执行 shell。

HTTP endpoint 必须：

- 只绑定 `127.0.0.1`。
- 使用随机 session token 或等价鉴权。
- 校验 `Authorization` 或自定义 header。
- 校验 `Origin`，避免 DNS rebinding 风险。
- Zotero 退出或 addon shutdown 时关闭 server。

## 模块划分

新增模块建议：

```text
src/mcp/httpServer.ts
src/mcp/protocol.ts
src/mcp/toolRegistry.ts
src/mcp/tools/paperRead.ts
src/codex/mcpConfig.ts
src/activatePaper/RetrievalService.ts
src/activatePaper/types.ts
```

职责：

```text
httpServer
  - 实现 Streamable HTTP MCP endpoint
  - 处理 initialize / initialized / tools/list / tools/call
  - 做 token、origin、method、content-type 校验

toolRegistry
  - 注册且只注册 paper_read
  - 统一 tools/list 和 tools/call 分发

paperRead tool
  - 校验输入
  - 限定 scope
  - 调 RetrievalService
  - 包装 MCP result

RetrievalService
  - 从 Zotero 原材料生成 snippets/chunks
  - 返回全部命中的 chunks
  - 生成带 provenance 的 evidence package
  - 后续内部扩展 lexical retrieval

ZoteroContextGateway
  - 只负责从 Zotero 取原材料
  - 已有 getActivePaper()
  - 已有 getPaperMetadata()
  - 已有 getAttachmentTextStatusForPrompt()
  - 已有 getAttachmentFullTextForTool()
```

## paper_read evidence contract

输入保持克制：

```ts
type PaperReadToolInput = {
  question?: string;
};
```

字段：

- `question`: 用户问题或阅读意图。用于 retrieval query / chunk ranking。

不放入首版公开 schema：

```text
mode
pages
sectionHint
includeSelection
maxSnippets
maxChars
debug
path
itemId
libraryId
```

输出：

```ts
type PaperReadToolOutput = {
  snippets: Array<{
    text: string;
    source: "zotero_fulltext";
    locator?: {
      chunkIndex?: number;
      charStart?: number;
      charEnd?: number;
      page?: number;
    };
    score?: number;
  }>;
  warnings?: string[];
};
```

MCP result 同时返回：

```ts
{
  content: [{ type: "text", text: readableSummary }],
  structuredContent: PaperReadToolOutput,
  isError?: boolean,
  _meta?: JsonValue
}
```

`paper_read` 返回 evidence，不返回最终答案。正式回答证据以 `snippets` 为主体；metadata、abstract、selected text、full-text status 不作为默认 answer context 返回。`warnings` 只用于 tool result 的失败或可信度限制说明，例如 no active reader、全文不可用、section/page locator 不可靠；不做单独 diagnostics 系统。

## evidence path 读取策略

1. 调 `ZoteroContextGateway.getActivePaper()`。
2. 无 active reader：返回 `isError: true`，`snippets: []`，并在 `warnings` 中说明无法读取当前论文。
3. 有 scope：内部可读取 metadata / abstract / text status 辅助定位，但不默认输出为模型上下文。
4. 调 `getAttachmentFullTextForTool(scope)` 取得 Zotero full-text 原材料。
5. 无全文、扫描 PDF、API error：返回 `snippets: []`，并在 `warnings` 中说明限制。
6. 有全文：做最小 chunking + lexical retrieval，按 `question` 排序后返回全部命中的 chunks。

5.2 不额外设计 snippet 预算、`maxChars` 或 `maxSnippets`。当前很多顶级模型已经支持 1M 级上下文；相比提前截断，首版更应该保证 evidence 不被预算逻辑误删。`paper_read` 仍不是“返回整篇全文”的接口：它返回 retrieval 命中的 chunks；如果 retrieval 命中很多，就全部返回。不要新增一个只截取全文开头的中间阶段；transport skeleton 之后就应直接进入真实 evidence path。

## CodexBridge 改动

需要做：

1. addon startup 时启动 local MCP HTTP server，得到：

   ```ts
   {
     name: "zotero-copilot",
     url: "http://127.0.0.1:<port>/zotero-copilot/mcp",
     token: "<random>"
   }
   ```

2. `thread/start` 增加：

   ```ts
   config: {
     mcp_servers: {
       "zotero-copilot": {
         url,
         http_headers: {
           Authorization: `Bearer ${token}`,
         },
         enabled_tools: ["paper_read"],
         startup_timeout_sec: 10,
         tool_timeout_sec: 60,
       },
     },
   }
   ```

3. `handleNotification()` 只记录 MCP startup/tool-call 相关日志，供 Zotero Toolbox Console 查看。

4. 继续安全拒绝无关 server request。

暂不需要：

- 让 Zotero 插件处理 `mcpServer/tool/call` request。
- 写入用户全局 `~/.codex/config.toml`。
- 要求用户手动 `codex mcp add`。
- 做单独的 UI diagnostics 面板或状态系统。

## Prompt 改动

MCP 完整接入后，`src/codex/promptBuilder.ts` 应从 Step 4 的 context-in-prompt 过渡为 MCP-first 最小 prompt。正式问答路径只保留用户问题和 tool routing 信息：

```text
You are answering a question about the currently open Zotero paper.
Use the Zotero MCP tool `paper_read` when paper-specific evidence is needed.
Base paper-specific claims on `paper_read` snippets. If snippets are missing or insufficient, say so explicitly.
```

保留：
- user prompt
- `paper_read` tool 信息和调用约束

不再默认放入 prompt：
- active reader scope
- title/authors/year/DOI
- abstract
- selected text
- full-text status
- warnings
- full text preview
- PDF path
- retrieval debug

这些字段仍可作为内部实现原材料或 tool-result warnings 的依据，但不应作为正式 prompt 的常驻上下文。这样可以避免模型跳过 `paper_read`，也避免 metadata、abstract、selected text 尚未实现或不完整时干扰回答。

## 测试与验收

自动测试：

```text
unit/mcp/toolRegistry.test.ts
unit/mcp/paperReadTool.test.ts
unit/activatePaper/RetrievalService.test.ts
unit/codex/mcpConfig.test.ts
```

覆盖：

- `tools/list` 只返回 `paper_read`。
- unknown tool 返回 MCP error。
- schema 拒绝未知字段和错误类型。
- no active reader。
- snippet success。
- full text empty / unavailable / error 时返回空 snippets + warnings。
- 多个 chunks 命中时全部返回。
- result 不包含 PDF path。

命令：

```bash
npm run build
npm run lint:check
npm run test:unit
npm test
```

手测：

1. 打开有 Zotero full-text 的 PDF。
2. 问：`这篇论文的方法是什么？`
3. 确认真实触发 `paper_read`。
4. 确认回答基于 tool evidence。
5. 打开扫描 PDF 或未索引 PDF，确认回答包含限制说明。
6. 关闭 reader 后提问，确认不编造当前论文内容。

## 分阶段交付

### 5.1 MCP transport + Codex wiring

- 启动 localhost MCP endpoint。
- 实现 `initialize`、`tools/list`、`tools/call`。
- `tools/list` 只暴露 `paper_read`。
- `CodexBridge` 在 `thread/start.config.mcp_servers` 注入 MCP server。
- 用 Zotero Toolbox Console 验证 endpoint、tool list、manual tool call、Codex MCP startup/tool-call log。

### 5.2 paper_read evidence path

- 接入 `ZoteroContextGateway`。
- 接入 `ActivePaperRetrievalService` / `PaperReadingService`。
- 读取当前 PDF reader scope 下的 Zotero full-text 原材料。
- 做最小 chunking + lexical retrieval。
- 返回 snippets + provenance + warnings，不返回整篇 full text。
- 不做 snippet 预算控制；命中的 chunks 全部返回。
- metadata、abstract、selected text、full-text status 仅作为内部原材料或 tool-result warnings 的依据，不作为默认 answer context。
- 处理 no reader / no full text / scanned PDF。
- prompt 收薄为 MCP-first，只保留 user prompt + tool routing。

### 5.3 retrieval upgrade, optional

evidence path 可用后再做：

- 更好的 chunking。
- BM25 / RRF / query planning。
- section/page hint。
- semantic search。
- page capture / visual reading。

retrieval upgrade 仍不新增公开 `paper_search` tool。

## 暂不做

- 公开 `get_active_paper`。
- 公开 `paper_search`。
- 全库搜索。
- 多篇论文对比。
- 写 note。
- 改 metadata。
- 任意文件读取。
- OCR。
- page image rendering。
- multimodal figure/table understanding。
- embedding 服务。
- 外部 vector DB。
- durable conversation history。
- global chat / paper chat 持久化。

durable history、global chat、paper chat 属于 Step 6。OCR、page image、embedding/hybrid RAG 是后续质量增强，不阻塞 Step 5 的首条 evidence path。
