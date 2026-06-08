# Step 5 MCP 与 paper_read 实施计划

## 0. 最终边界

Step 5 的目标不是做全库 agent，也不是照搬 `llm-for-zotero` 的工具集合，而是在已经完成 Step 1-4 的基础上，让 Codex 能按需、只读地读取当前 Zotero PDF reader 里的论文内容。

采用 `discussion_on_paper_read_tool_turn2.md` 的结论：

```text
公开 MCP tools:
1. paper_read

不公开:
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

`get_active_paper` 不删除其能力，而是作为 `paper_read` 的内部前置步骤：每次读取论文内容前都先由 `ZoteroContextGateway.getActivePaper()` 锁定当前 reader scope，再读取 metadata / text status / full text。`paper_search` 也不删除其能力，而是降级为 `ActivePaperRetrievalService` 内部的 retrieval 函数。`how_to_handle_pdf.md` 中关于 RAG、chunk、BM25、embedding、rerank、locator、warning/provenance 的经验仍然可用，但它们属于 `paper_read` 的内部实现，不再是模型可见的工具边界。

完整逻辑链：

```text
用户问题
  -> sidebar sendPrompt()
    -> buildPaperQuestionPrompt()
      -> 提示模型当前 scope，并要求需要论文内容时使用 paper_read
    -> CodexBridge
      -> codex app-server --stdio
      -> thread/start 注入 Zotero MCP server 配置
      -> turn/start
    -> Codex runtime decides to call MCP tool
      -> Zotero MCP endpoint / bridge handler
        -> tool registry
          -> paper_read
            -> ZoteroContextGateway
              -> getActivePaper()
            -> ActivePaperRetrievalService
              -> fulltext / metadata
              -> chunk / retrieve / rank / pack evidence
    <- tool result: evidence package
  <- assistant answer based on evidence
```

核心安全边界：

- 只读。
- 只读当前 active PDF reader 对应的 attachment。
- 不读全库。
- 不接受任意本地文件路径。
- 不暴露 PDF path 给模型，除非仅在开发 diagnostics 中受控展示。
- 不写 note、不改 metadata、不删除 item、不执行 shell。

`## 0. 最终边界` 是 Step 5 的**范围锁定**，不是单纯的功能愿望清单。

Step 5 只做一件事：在 Step 1-4 已经能打开 sidebar、接入 Codex、拿到当前 PDF reader context 的基础上，让 Codex 通过 MCP **按需、只读地读取当前 Zotero PDF reader 里的这篇论文**。

关键点有四个：

1. **公开 MCP tool 只保留一个**：`paper_read`。
   `getActivePaper()` 是内部 scope resolver，不作为模型可见 MCP tool。`paper_read` 每次调用都先确认当前 reader scope，再读取当前论文相关内容并返回 evidence package。

2. **`get_active_paper` / `paper_search` 等能力不是不要，而是不对模型公开**。
   scope 解析留在 `ZoteroContextGateway`，search、chunk、BM25、embedding、rerank、locator、provenance、warnings 留在 `ActivePaperRetrievalService`。它们都不应该变成模型可见的多个 tool。模型只需要理解“读当前论文”，不需要在 `get_active_paper` / `paper_search` / `paper_read` / `chunk_read` 之间做选择。

3. **scope 必须锁死在 current active PDF reader attachment**。
   不读 Zotero 主窗口 selection，不读全库，不接受任意 `itemId` / `libraryId` / local path，不暴露 PDF path 给模型。也不写 note、不改 metadata、不删 item、不执行 shell。

4. **`paper_read` 返回的是阅读材料，不是最终回答**。
   逻辑是：用户提问 -> prompt 提醒模型当前 scope、需要论文内容时调用 `paper_read` -> Codex runtime 调 MCP -> Zotero 侧读取当前 reader paper -> 返回 evidence -> assistant 基于 evidence 回答。

---

## 1. 协议与接入方式确认

**目标**

确认当前 `codex app-server` 版本如何挂接 MCP server，避免在错误协议假设上实现工具。

**在完整链路中的作用**

这是 `CodexBridge -> app-server -> Zotero MCP tools` 的入口。当前 `src/codex/bridge.ts` 只会拒绝 app-server 发来的 server request；Step 5 必须先明确哪些请求要继续拒绝，哪些通知要记录，MCP tool call 是由 app-server 自己转发到外部 MCP server，还是需要插件处理某类 request。

**实现步骤**

1. 用本机 CLI 生成 app-server 协议类型：

   ```bash
   tmp=$(mktemp -d)
   codex app-server generate-ts --out "$tmp"
   ```

2. 记录与 Step 5 相关的协议形状：
   - `ThreadStartParams.config`
   - `mcpServerStatus/list`
   - `config/mcpServer/reload`
   - `mcpServer/tool/call`
   - `item/mcpToolCall/progress`
   - `mcpServer/startupStatus/updated`
   - `McpServerToolCallResponse`

3. 做一个最小 spike：
   - 通过 `thread/start.config` 临时注入一个 dummy MCP server，或通过 `codex mcp add` 配置一个 dummy server。
   - 调用 `mcpServerStatus/list` 确认 app-server 能看到 server 和 tools。
   - 发一个可诱导工具调用的 turn，确认 app-server 是否自行连接外部 MCP server。

**预期结果**

明确采用哪条正式接入路线：

```text
优先路线:
Zotero 插件启动/暴露本地 MCP endpoint
CodexBridge 在 thread/start.config 注入该 MCP server

备选路线:
要求用户或插件写入 Codex MCP 配置后 reload

不推荐路线:
让模型调用 app-server 的 mcpServer/tool/call 再由 Zotero 插件模拟 MCP server
```

**验收标准**

- 有一段写入本 note 或实现 PR 的协议结论：当前版本使用哪种 MCP 配置字段、server 名称、transport 形式。
- app-server 能列出 dummy MCP server。
- dummy tool 能被 Codex turn 调用，或者能通过 `mcpServer/tool/call` 手动调用。
- `bridge.ts` 对未知 server request 仍能安全拒绝，不影响普通对话。

---

## 2. 建立 Zotero MCP 只读服务骨架

**目标**

先打通 `tools/list` 和 `tools/call` 的 MCP 最小闭环，不实现复杂 PDF retrieval。

**在完整链路中的作用**

这是 Codex runtime 和 Zotero 数据边界之间的稳定接口。后续 `paper_read` 质量如何变化，都不应该影响 MCP protocol 层。

**建议新增模块**

```text
src/mcp/protocol.ts
src/mcp/server.ts
src/mcp/toolRegistry.ts
src/mcp/tools/paperRead.ts
src/codex/mcpConfig.ts
```

如果最终选择 HTTP endpoint，还需要：

```text
src/mcp/httpServer.ts
```

如果最终选择 stdio subprocess，则需要评估 Zotero 插件是否适合被 Codex 作为 stdio server 启动；通常不适合，因为工具必须访问正在运行的 Zotero reader 状态。

**实现步骤**

1. 定义内部 tool registry：

   ```ts
   type ZoteroMcpTool = {
     name: string;
     description: string;
     inputSchema: JsonSchema;
     call(input: unknown): Promise<McpToolResult>;
   };
   ```

2. 实现 MCP 基础方法：
   - `initialize`
   - `tools/list`
   - `tools/call`
   - 对 resources/prompts 可先返回空集合或不支持。

3. 统一 tool result 形状：

   ```ts
   type McpToolResult = {
     content: Array<{ type: "text"; text: string }>;
     structuredContent?: JsonValue;
     isError?: boolean;
     _meta?: JsonValue;
   };
   ```

4. 所有错误转换为结构化 warning 或 `isError: true`，不要让异常穿透到 app-server。

5. server 名称固定为：

   ```text
   zotero-copilot
   ```

**预期结果**

Codex 只能看到一个工具：

```text
paper_read
```

此时 `paper_read` 可以先在内部完成 active reader scope 解析，并返回 metadata、abstract、fulltext status，不做 retrieval。

**验收标准**

- `tools/list` 返回且只返回 Step 5 公开工具。
- `tools/list` 中只有 `paper_read`。
- `tools/call paper_read` 在 active reader 中返回 scope summary、metadata、text status。
- 无 active reader 时返回可读 warning 或 `isError: true`，不 crash。
- 工具结果同时有 `content` 和 `structuredContent`，便于模型读和测试断言。
- `npm run build` 通过。
- `npm run lint:check` 通过。
- 新增 unit tests 覆盖 registry、schema validation、错误包装。

---

## 3. 实现内部 active paper scope resolver

**目标**

提供 `paper_read` 内部使用的 scope 确认能力，让读取动作始终锁定“当前 Zotero PDF reader 里的这篇论文”。

**在完整链路中的作用**

`getActivePaper()` 是内部能力，不作为 MCP tool 公开。它主要用于：

- `paper_read` 每次读取前确认当前 reader scope。
- 调试 active reader 识别问题。
- 后续 Step 6 做 paper chat persistence 时复用 scope identity。

它不接受模型输入，也不接受 `itemId`、`path`、`libraryId`，避免模型绕过当前 reader scope。

**输出结构**

```ts
type ActivePaperScopeSnapshot = {
  scope: {
    source: "reader";
    readerItemID: number;
    attachmentItemID: number;
    attachmentKey: string;
    parentItemID?: number;
    libraryID: number;
    readerType?: string;
  } | null;
  metadata: {
    itemID: number;
    title: string;
    creators: string[];
    year?: string;
    doi?: string;
  } | null;
  textStatus: {
    status: PaperTextStatus;
    length: number;
    indexedState?: number;
  } | null;
  warnings: string[];
};
```

**实现步骤**

1. 调用 `ZoteroContextGateway.getActivePaper()`。
2. 有 scope 时调用：
   - `getPaperMetadata(scope)`
   - `getAttachmentTextStatusForPrompt(scope)`
3. 生成 `paper_read` 可复用的 scope snapshot。
4. 删除不应进入模型可见 tool result 的字段：
   - local file path
   - hidden/debug object
5. 将 compact scope summary、metadata、text status、warnings 合并进 `paper_read` 的 structured output。

**预期结果**

`paper_read` 的结果能告诉 Codex：

```text
当前 reader 是 PDF attachment 123，parent item 456，title/year/doi 是什么，全文索引状态是什么。
```

**验收标准**

- active PDF reader: 返回 `scope != null`、title、attachment id、parent id。
- active reader 不是 PDF: 返回 scope 但带 warning。
- 无 reader: 返回 `scope: null` 和明确 warning。
- 不返回 PDF path。
- scope snapshot 不单独注册为 MCP tool。
- unit tests 覆盖 active / no reader / non-PDF / no parent。

---

## 4. 定义 paper_read v1 contract

**目标**

把 `paper_read` 固化为唯一论文内容读取入口，并让输入表达“读什么”，而不是暴露底层检索策略。

**在完整链路中的作用**

`paper_read` 是模型可见的 semantic facade。模型只需要知道“要读当前论文内容时调用它”，不需要决定 search、chunk、BM25、embedding、rerank、page parser。

**输入 schema**

```ts
type PaperReadToolInput = {
  question?: string;
};
```

字段含义：

- `question`: 用户问题。v1 仅用于记录调用意图和帮助模型理解 tool result，不改变读取范围；v2 lexical retrieval 再用它作为检索目标。

**输出结构**

```ts
type PaperReadToolOutput = {
  paper: {
    attachmentItemID: number;
    parentItemID?: number;
    title?: string;
  };
  metadata: PaperMetadata;
  fullText: {
    text: string;
    length: number;
    status: PaperTextStatus;
    indexedState?: number;
    source: "zotero_fulltext";
  } | null;
  warnings: string[];
  debug?: RetrievalDebug;
};
```

**实现步骤**

1. 在 `src/mcp/tools/paperRead.ts` 中只做：
   - schema validation
   - 转换为 `PaperReadRequest`
   - 调用 `ActivePaperRetrievalService.read()`
   - 包装 MCP result
2. 不在 tool handler 中写 chunking/ranking。
3. 对外描述写清楚：

   ```text
   Read relevant evidence from the currently open Zotero PDF. Use this when answering questions about the paper content, method, experiments, or contributions.
   ```

4. 明确不要公开 `paper_search`。

**预期结果**

模型看到的 action space 很小：

```text
需要当前论文内容或状态 -> paper_read
```

**验收标准**

- schema 拒绝未知字段和错误类型。
- `question` 为空或存在时都读取同一份完整 full text，不启动场景化 retrieval。
- tool output 不包含最终答案，只包含证据材料。
- unit tests 覆盖 validation、full-text result wrapping、error wrapping。

---

## 5. 建立 ActivePaperRetrievalService

**目标**

把 PDF 阅读/RAG 逻辑放到内部 service，作为 `paper_read` 的实现系统。

**在完整链路中的作用**

它连接 `paper_read` 的用户意图和 `ZoteroContextGateway` 的原材料，是 Step 5 的核心业务层。

**建议新增模块**

```text
src/paperReading/types.ts
src/paperReading/ActivePaperRetrievalService.ts
```

v2 lexical retrieval 再新增：

```text
src/paperReading/chunker.ts
src/paperReading/retriever.ts
src/paperReading/ranker.ts
src/paperReading/evidencePacker.ts
```

**内部 request**

```ts
type PaperReadRequest = {
  question?: string;
  debug: boolean;
};
```

**读取策略**

1. 先 resolve scope：
   - `getActivePaper()`
   - 无 scope 直接返回 `isError` 或 `fullText: null` + warning。

2. 读取 metadata：
   - title、authors、year、doi、abstract。
   - abstract 随 metadata 返回。

3. 读取全文：
   - 调用 `getAttachmentFullTextForTool(scope)`。
   - `status` 是 `empty/error/unavailable` 时返回 metadata + warning。
   - `status` 是 `unindexed` 但有 text 时仍继续，因为 Zotero 有时状态和可读文本不完全一致。

4. 决定策略：
   - v1: 不做检索，直接返回当前 PDF 的完整 Zotero full text。
   - v2: 再根据 `question` 做 model-free lexical retrieval。

**预期结果**

v1 `paper_read` 能把当前 PDF 的完整纯文本交给模型：

```text
这篇论文的方法/训练目标/实验设置/数据集是什么？
```

但 tool 本身只返回 evidence package，最终回答由模型完成。

**验收标准**

- service 可在 Node unit tests 中 mock gateway 测试。
- 无全文时仍返回 metadata/abstract，不直接失败。
- 有全文时返回完整 PDF full text。
- warnings 明确说明全文状态。
- retrieval debug 默认不出现在正式结果中。

---

## 6. v1 retrieval: full text

**目标**

先用最简单、最直接的方式打通 `paper_read`：`ActivePaperRetrievalService` 直接返回当前 PDF 的完整 Zotero full text。

**在完整链路中的作用**

Step 4 已经在 `notes/step_4_context_gateway.md/context-gateway-imple.md` 中确认 `ZoteroContextGateway.getAttachmentFullTextForTool()` 可读取完整 `attachment.attachmentText`，并返回 `text`、`preview`、`length`、`indexedState`、`status`。v1 直接复用这个接口，不先引入 chunk/retrieve/rank/pack。

**实现步骤**

1. `ActivePaperRetrievalService.read()`
   - resolve active paper scope。
   - 读取 metadata / abstract。
   - 调用 `getAttachmentFullTextForTool(scope)`。
   - 将完整 `text` 作为 tool evidence 返回。

2. `paper_read` tool
   - 无论 `question` 是否存在，都获得完整论文纯文本。
   - tool result 中保留 metadata、abstract、full-text status、length、warnings。
   - 不做 lexical retrieval、不切 chunk、不排序。

**设计依据**

一般会议论文约 20 页，PDF 纯文本约 20K tokens。对 GPT-5.5 等长上下文模型，这个长度仍在可接受范围内。v1 先采用完整全文返回，能最小化工程复杂度，并更快验证 MCP tool 调用、scope 限制、full-text 读取、warning 和 UI tool status。

**预期结果**

第一版不追求检索精度优化，而是保证：

```text
paper_read -> 当前 active PDF 的完整 Zotero full text -> 模型基于完整论文内容回答
```

**验收标准**

- `paper_read` 调用 `getAttachmentFullTextForTool()`。
- 有全文时 tool result 包含完整 `text`，不是 snippet 子集。
- 无全文、扫描 PDF、full-text API 不可用时返回 metadata/abstract + warning。
- `question` 不改变 v1 的读取范围；模型始终拿到完整论文内容。
- unit tests 覆盖 full text success、empty/unavailable/error full text、长度 warning。

---

## 7. v2 retrieval: lexical first

**目标**

在 v1 full text 闭环稳定后，再用稳定、可测试、无外部模型依赖的 lexical retrieval 优化 `paper_read(question)`。

**在完整链路中的作用**

这是 `paper_read` 的内部 `paper_search` 能力，但不暴露给模型。v2 用它减少返回 token、提升相关 evidence 的密度。

**实现步骤**

1. `chunker.ts`
   - 输入 normalized full text。
   - 默认 chunk size: 1200-1800 chars。
   - overlap: 150-250 chars。
   - 输出 `text`, `charStart`, `charEnd`, `index`。

2. `retriever.ts`
   - normalize query。
   - tokenize query。
   - 支持短语匹配、term frequency、heading/caption/table 关键词 boost。
   - 可识别常见论文线索：
     - `abstract`
     - `introduction`
     - `method`
     - `experiment`
     - `dataset`
     - `ablation`
     - `table`
     - `figure`
     - `conclusion`

3. `ranker.ts`
   - score = lexical score + heading boost + position boost。

4. `evidencePacker.ts`
   - 去重。
   - 合并相邻 chunk。
   - 截断到 `maxChars`。
   - 保留 `charStart/charEnd`。

**预期结果**

v2 对这些 query 应可用：

```text
method
training objective
dataset
experiment setup
ablation
reward model
Table 1
Figure 3
contribution
```

**验收标准**

- 对固定 mock paper text，query 能命中预期 chunk。
- 同一结果不重复返回高度重叠文本。
- `maxChars` 严格生效。
- 返回 snippet 带 `charRange` provenance。
- 扫描 PDF / 空全文时返回 warning 而不是空泛回答。
- unit tests 覆盖 chunk overlap、query match、ranking、packing。

---

## 8. Prompt 收薄与 tool 使用提示

**目标**

把 Step 4 的 prompt 从“直接塞上下文”逐步改为“scope + tool routing”，避免 prompt 随论文全文能力膨胀。

**在完整链路中的作用**

Step 4 当前已经只放 metadata/abstract/text status 等轻量上下文。Step 5 后，论文内容读取应该主要由 `paper_read` 完成，prompt 负责告诉模型什么时候用 tool。

**实现步骤**

1. 更新 `src/codex/promptBuilder.ts`：
   - 保留 current scope、metadata、abstract。
   - 增加一句工具使用指令：

     ```text
     When paper-specific content beyond this prompt is needed, call the Zotero paper_read tool. Treat paper_read results as evidence content, not final answers.
     ```

2. 不把全文 preview 加回 prompt。

**预期结果**

普通 metadata 问题可直接答；需要论文正文依据的问题，模型调用 `paper_read`。

**验收标准**

- prompt 不包含 full text。
- prompt 不出现旧的 `paper_search` 指令。
- paper-specific method/experiment 问题会触发 `paper_read`。
- 没有 active reader 时模型明确说明缺少当前论文，而不是编造。

---

## 9. Bridge 扩展与 tool event UI

**目标**

让 sidebar 能稳定处理 MCP tool 状态，不把 tool noise 淹没主回答。

**在完整链路中的作用**

Step 5 后 Codex turn 不再只有 assistant delta，还会出现 tool progress/status。UI 需要有最小可见反馈和 debug 出口。

**实现步骤**

1. 扩展 `CodexBridge.handleNotification()`：
   - 记录 `item/mcpToolCall/progress`。
   - 记录 `mcpServer/startupStatus/updated`。
   - warning/error 继续走 `onNotice`。

2. 扩展 `CodexPromptOptions`：

   ```ts
   onToolStatus?: (status: ToolStatusNotice) => void;
   ```

3. sidebar UI：
   - 主聊天区只显示紧凑状态，如 `Reading current paper...`。
   - raw arguments/result 放到 diagnostics，不默认展示。

4. 开发 diagnostics：
   - `window.__zcpLastPaperRead`
   - `window.__zcpLastMcpToolCall`
   - 或 Zotero debug log。

**预期结果**

用户能看到系统正在读论文，但不会看到大段 JSON tool result。

**验收标准**

- tool running/completed/failed 状态不会破坏 answer streaming。
- tool failure 以简短 notice 呈现。
- raw tool result 默认不显示在主聊天内容里。
- 普通无 tool 对话行为不回归。

---

## 10. 测试矩阵

**目标**

把 Step 5 的风险拆成可自动测试和需要 Zotero 手测的两层。

**在完整链路中的作用**

MCP + Zotero reader + app-server 三者组合复杂，必须把纯逻辑尽量留在 Node unit tests，把 Zotero 运行时部分留给集成手测。

**Node unit tests**

放在 `unit/`，用 `npm run test:unit` 跑：

- `mcp/toolRegistry.test.ts`
- `mcp/paperReadTool.test.ts`
- `paperReading/activePaperScope.test.ts`
- `paperReading/ActivePaperRetrievalService.test.ts`

覆盖：

- schema validation。
- no active reader。
- empty/unindexed/error full text。
- full text success。
- full text length/status/warnings。

v2 lexical retrieval 再补：

- `paperReading/chunker.test.ts`
- `paperReading/retriever.test.ts`
- `paperReading/evidencePacker.test.ts`
- targeted retrieval。
- maxSnippets/maxChars。
- chunk overlap、query match、ranking、packing。

**Zotero 手测**

1. 打开一个有 Zotero full-text 的 PDF。
2. sidebar 问：
   - `这篇论文的方法是什么？`
   - `它用了什么数据集？`
3. 打开扫描 PDF 或未索引 PDF。
4. 关闭 reader 后从 sidebar 发问。

**验收标准**

- `npm run build`。
- `npm run lint:check`。
- `npm run test:unit`。
- `npm test`。
- 手测时 Codex 至少一次真实调用 `paper_read`。
- 扫描 PDF/无全文时回答包含限制说明。

---

## 11. 分阶段交付顺序

### Step 5.1 协议 spike

目标：确认 app-server MCP 接入方式。

预期结果：dummy MCP server 可被 app-server 发现和调用。

验收标准：有可复现命令或代码路径；不改动核心阅读逻辑。

### Step 5.2 MCP skeleton

目标：实现 Zotero MCP server/tool registry 和唯一公开工具 `paper_read` 的占位 handler。

预期结果：Codex 只能看到占位 `paper_read`。

验收标准：无 active reader 和 active PDF reader 都通过 `paper_read` 稳定返回 scope summary / warnings。

### Step 5.3 paper_read v1 shell

目标：实现 `paper_read` contract、schema validation、metadata/abstract/fulltext status 返回。

预期结果：工具通道稳定，结果结构稳定。

验收标准：tool result 形状和 warnings 完整。

### Step 5.4 ActivePaperRetrievalService + full text retrieval

目标：实现 v1 full text retrieval，直接复用 `getAttachmentFullTextForTool()` 返回完整 PDF 纯文本。

预期结果：`paper_read(question)` 获得当前 active PDF 的完整 Zotero full text。

验收标准：真实 PDF 能把完整论文纯文本送入 tool result；扫描 PDF/无全文时返回限制说明。

### Step 5.5 v2 lexical retrieval

目标：在 v1 闭环稳定后，实现内部 chunk/retrieve/rank/pack。

预期结果：`paper_read(question)` 可返回更短、更相关的 snippets。

验收标准：mock paper tests 能命中预期证据；真实 PDF 能回答方法/实验/数据集类问题。

### Step 5.6 prompt 与 UI 收敛

目标：让 prompt 指向 `paper_read`，UI 隐藏 tool noise。

预期结果：主聊天体验保持简洁，诊断信息可追踪。

验收标准：普通回答流不回归；tool 状态不污染主消息。

---

## 12. 暂不做的内容

这些不要混入 Step 5：

- 公开 `get_active_paper` tool。
- 公开 `paper_search` tool。
- 全库搜索。
- 多篇论文对比。
- 写 note。
- 修改 Zotero item metadata。
- 删除/移动 attachment。
- 任意文件路径读取。
- OCR。
- page image rendering。
- multimodal figure/table understanding。
- embedding 服务、外部 vector DB。
- durable conversation history。
- global chat / paper chat 持久化。

其中 durable history、global chat、paper chat 属于 Step 6；embedding/hybrid RAG 属于 Step 5 后续质量增强，不是 v1 闭环。model-free lexical retrieval 属于 v2，不阻塞 v1 full text 闭环。

---

## 13. 成功标准

Step 5 完成时应满足：

1. Codex 能在当前 Zotero PDF reader scope 下调用 `paper_read`。
2. v1 `paper_read` 能返回 metadata、abstract、完整 PDF full text、warnings、provenance。
3. v1 不公开 `get_active_paper` / `paper_search`，也不做 chunk/retrieve/rank；active paper scope 解析和 v2 retrieval/search 逻辑都留在内部实现。
4. 无 active reader、无全文、扫描 PDF 时都有明确 warning。
5. Prompt 不再承担全文注入职责，只负责 scope 和 tool routing。
6. UI 默认只显示最终回答和简洁 tool 状态，不显示大段 tool JSON。
7. 自动测试覆盖 MCP schema、service、full-text result、warnings。
8. 手测证明真实 PDF Q&A 能稳定触发并使用 `paper_read`。
