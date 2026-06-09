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

1. 当前仓库已实现 `5.1 MCP HTTP skeleton`。
   - `src/mcp/httpServer.ts` 注册 Zotero 本地 HTTP MCP endpoint：`/zotero-copilot/mcp`。
   - `src/mcp/protocol.ts` 定义 MCP / JSON-RPC 基础类型与响应 helper。
   - `src/mcp/toolRegistry.ts` 只注册并暴露 `paper_read`。
   - `src/mcp/tools/paperRead.ts` 实现 `paper_read` skeleton：校验输入，解析当前 active reader scope，返回 scope/status，占位说明全文读取会在 5.2 接入。
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
   - `item/mcpToolCall/progress`、`mcpServer/startupStatus/updated` 是真实 app-server notifications。

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

## 5.1 实现记录

已完成：

- 插件 startup 时调用 `startMcpHttpServer()`，在 Zotero 内置 HTTP server 上注册 `/zotero-copilot/mcp`；shutdown 时删除 endpoint。
- HTTP MCP endpoint 支持 `initialize`、`initialized`、`ping`、`tools/list`、`tools/call`。
- endpoint 使用随机 bearer token；请求会校验 `Authorization`、`Host`、`Origin`、HTTP method 和 JSON body。
- `tools/list` 只返回 `paper_read`，不公开 `get_active_paper`、`paper_search` 或任何写操作。
- `paper_read` 当前是 skeleton：输入只接受 `question?: string` 和 `maxChars?: number`；输出当前 reader scope/status、warnings 和 `_meta`，不读取全文、不返回 PDF path。
- `CodexBridge.ensureThread()` 在 `thread/start` 时注入 MCP server config，并在 thread 创建后调用 `mcpServerStatus/list` 记录 app-server 侧可见状态。
- `CodexBridge.handleNotification()` 已记录 `mcpServer/startupStatus/updated`、`item/mcpToolCall/progress`，以及包含 `mcpToolCall` 的 `item/started` / `item/completed`。
- `promptBuilder` 已加入 tool routing 指令：论文内容不足时调用 Zotero MCP tool `paper_read`，并把 tool result 当作 evidence。

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
  - 组织 metadata / text status / full text / warnings
  - 控制 maxChars
  - 生成 evidence package
  - 后续内部扩展 lexical retrieval

ZoteroContextGateway
  - 只负责从 Zotero 取原材料
  - 已有 getActivePaper()
  - 已有 getPaperMetadata()
  - 已有 getAttachmentTextStatusForPrompt()
  - 已有 getAttachmentFullTextForTool()
```

## paper_read v1 contract

输入保持克制：

```ts
type PaperReadToolInput = {
  question?: string;
  maxChars?: number;
};
```

字段：

- `question`: 用户问题或阅读意图。v1 可记录并用于 result 说明；不做复杂 retrieval。
- `maxChars`: 返回正文预算。需要默认值和上限。

不放入 v1：

```text
mode
pages
sectionHint
includeSelection
maxSnippets
debug
path
itemId
libraryId
```

输出：

```ts
type PaperReadToolOutput = {
  paper: {
    attachmentItemID: number;
    parentItemID?: number;
    title?: string;
  } | null;
  metadata: PaperMetadata | null;
  fullText: {
    text: string;
    length: number;
    returnedChars: number;
    truncated: boolean;
    status: PaperTextStatus;
    indexedState?: number;
    source: "zotero_fulltext";
  } | null;
  warnings: string[];
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

`paper_read` 返回 evidence，不返回最终答案。

## v1 读取策略

1. 调 `ZoteroContextGateway.getActivePaper()`。
2. 无 active reader：返回 `isError: true` 和明确 warning。
3. 有 scope：读取 metadata。
4. 调 `getAttachmentFullTextForTool(scope)`。
5. 无全文、扫描 PDF、API error：返回 metadata + warning。
6. 有全文：按 `maxChars` 截断后返回。

默认建议：

```text
default maxChars: 20000
hard maxChars: 50000
```

不要在 v1 承诺“完整论文全文一定全部返回”。真实实现必须处理长文截断和 token 预算。

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

3. `handleNotification()` 增加最小处理：
   - `mcpServer/startupStatus/updated`
   - `item/mcpToolCall/progress`
   - `item/started` / `item/completed` 中的 `mcpToolCall` item 可后续用于 UI diagnostics

4. 继续安全拒绝无关 server request。

暂不需要：

- 让 Zotero 插件处理 `mcpServer/tool/call` request。
- 写入用户全局 `~/.codex/config.toml`。
- 要求用户手动 `codex mcp add`。

## Prompt 改动

`src/codex/promptBuilder.ts` 只增加 tool routing 指令，不注入全文：

```text
When paper-specific content beyond the metadata, abstract, selected text, and full-text status is needed, call the Zotero MCP tool `paper_read`. Treat `paper_read` results as evidence, not as final answers.
```

保留：
- active reader scope
- title/authors/year/DOI
- abstract
- selected text
- full-text status
- warnings

不放回：
- full text preview
- PDF path
- retrieval debug

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
- full text success。
- full text empty / unavailable / error。
- `maxChars` 截断。
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

### 5.1 MCP HTTP skeleton

- 启动 localhost MCP endpoint。
- 实现 `initialize`、`tools/list`、`tools/call`。
- `paper_read` 先返回占位 scope/status。
- app-server 能通过 `thread/start.config.mcp_servers` 看到 `paper_read`。

### 5.2 paper_read v1

- 接入 `ZoteroContextGateway`。
- 返回 metadata、full-text status、受 `maxChars` 控制的 text。
- 处理 no reader / no full text / scanned PDF。

### 5.3 Bridge 与 UI 状态

- 注入 MCP config。
- 记录 MCP startup/tool progress。
- UI 默认只显示简洁状态，不展示大段 JSON。

### 5.4 v2 lexical retrieval

v1 稳定后再做：

- chunker
- lexical retriever
- ranker
- evidence packer
- snippets/provenance

v2 仍不新增公开 `paper_search` tool。

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

durable history、global chat、paper chat 属于 Step 6。OCR、page image、embedding/hybrid RAG 是后续质量增强，不阻塞 Step 5 v1。
