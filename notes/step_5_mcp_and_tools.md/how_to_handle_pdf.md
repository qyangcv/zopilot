对大文档走 RAG / File Search

OpenAI File Search 文档说明它用上传文件构建 vector store，支持 semantic + keyword search，模型需要时调用 file_search 拿相关片段。典型流程是：

PDF upload
-> parse/extract text
-> chunk
-> embedding / keyword index
-> query rewrite
-> semantic + lexical retrieval
-> rerank
-> return snippets with citations
-> model answer

或者接一个自定义 MCP：

pdf_read({ path, question, pages, sectionHint })

对你的插件的启发

我建议你学成熟产品的“分层”，不要学它们的复杂度：

外部 tool:
paper_read

内部 service:
PDF text loader
chunker
BM25 / embedding retriever
reranker
page/section locator
warning/provenance builder

第一版不要做整篇 PDF 多模态输入。Zotero 已经给你
attachment.attachmentText，你的最佳路线是：

当前 reader PDF
-> attachment full text
-> chunk
-> lexical retrieval first
-> 返回 snippets + page/char locator + warning

之后再加 page image/OCR/visual analysis。成熟工具也是这个思想：短文档直接
读，长文档检索读，视觉信息按需补充。

---

可以这样划分：**`paper_read tool` 是模型可见的“意图接口”；内部 service 是模型不可见的“实现系统”**。

`paper_read` 不负责“怎么检索得更准”，它只负责把模型/用户的阅读意图变成一个受控请求；`ActivePaperRetrievalService` 才负责 chunk、retrieval、ranking、locator、warning、provenance。

## 总览

```text
LLM / Codex
  -> calls MCP tool: paper_read(input)
      -> PaperReadToolHandler
          -> ActivePaperRetrievalService.read(request)
              -> ZoteroContextGateway
              -> TextLoader
              -> Chunker
              -> Retriever
              -> Ranker
              -> EvidencePacker
          <- PaperReadResult
  <- tool result: readable evidence package
```

## 1. `paper_read tool` 的职责

`paper_read` 是外部 contract，面向模型。

它应该负责：

- 定义模型能调用的 schema。
- 校验输入，比如 `maxChars`、`maxSnippets`、`pages` 是否合理。
- 限定 scope：只能读当前 Zotero reader 里的当前 PDF。
- 做权限和安全边界：read-only，不写 note，不改 metadata，不读全库。
- 把模型输入转换成内部 typed request。
- 调用 `ActivePaperRetrievalService`。
- 把 service 结果包装成 MCP tool result。
- 把错误翻译成模型/用户能理解的 warning。

它不应该负责：

- chunking 算法。
- BM25 / embedding / rerank。
- section boundary 推断。
- page text extraction 细节。
- Zotero API 细节。
- cache 策略。
- LLM rerank prompt。
- debug 统计的具体计算。

也就是说，`paper_read tool` 的输入可以是：

```ts
type PaperReadToolInput = {
  question?: string;
  locator?: {
    pages?: string;
    sectionHint?: string;
  };
  includeSelection?: boolean;
  maxSnippets?: number;
  maxChars?: number;
};
```

输出是“模型可读的证据包”，不是最终回答：

```ts
type PaperReadToolOutput = {
  paper: {
    attachmentItemID: number;
    parentItemID?: number;
    title?: string;
  };
  metadata?: PaperMetadata;
  snippets: PaperSnippet[];
  warnings: string[];
};
```

调用方：

```text
LLM / Codex app-server / MCP client
```

## 2. `ActivePaperRetrievalService` 的职责

`ActivePaperRetrievalService` 是内部 application service，面向工程实现。

它负责真正“怎么读论文”：

- 决定读取策略：
  - 无 `question`：构造 overview context。
  - 有 `question`：走 retrieval。
  - 有 `locator.pages`：优先 page resolver。
  - 有 `sectionHint`：做 heading/section boost，但不承诺精确章节。
  - 有 `includeSelection`：读取 selection，并补充附近上下文。
- 读取全文原材料。
- 切 chunk。
- 做 keyword/BM25/embedding 检索。
- 做 heading boost、position boost、caption/table boost。
- rerank 和去重。
- 合并相邻 chunk。
- 控制 token/char budget。
- 生成 provenance：`charStart`、`charEnd`、`pageHint`、`sectionHint`、`source`。
- 生成 warnings：例如全文未索引、章节边界不可靠、页码无法精确映射。

它的输入不应该是 MCP schema，而应该是内部 request：

```ts
type PaperReadRequest = {
  scope: PaperScope;
  question?: string;
  pages?: PageRange;
  sectionHint?: string;
  includeSelection: boolean;
  limits: {
    maxSnippets: number;
    maxChars: number;
  };
  debug?: boolean;
};
```

它的输出也应该是内部结构化结果：

```ts
type PaperReadResult = {
  paper: PaperIdentity;
  metadata: PaperMetadata;
  snippets: Array<{
    text: string;
    score: number;
    locator: {
      type: "charRange" | "pageRange" | "selection";
      charStart?: number;
      charEnd?: number;
      pages?: string;
      sectionHint?: string;
    };
    source: "zotero_fulltext" | "selection" | "page_text" | "metadata";
  }>;
  warnings: string[];
  debug?: RetrievalDebug;
};
```

调用方：

```text
paper_read tool handler
未来也可以被内部 diagnostics、unit tests、dev console 调用
```

## 3. `ZoteroContextGateway` 的职责

它再低一层，是 Zotero 数据来源边界。

它只负责从 Zotero 拿原材料：

```text
getActivePaper()
getPaperMetadata()
getSelectedText()
getAttachmentFullTextForTool()
```

它不应该知道什么是 BM25、RAG、rerank，也不应该决定“这个问题该读 Method 还是 Abstract”。

职责边界是：

```text
ZoteroContextGateway = 数据获取
ActivePaperRetrievalService = 阅读/检索策略
paper_read tool = 模型可见接口
```

## 4. 最清晰的边界判断规则

如果某个逻辑是“模型需要知道并选择的行为”，才放进 `paper_read tool` schema。

如果某个逻辑是“为了完成读取而采用的工程策略”，放进 `ActivePaperRetrievalService`。

例如：

- `question`：放 tool input，因为模型需要表达“我要问什么”。
- `sectionHint`：放 tool input，因为用户可能明确说“Method 部分”。
- `BM25`：不放 tool input，这是内部 retrieval 策略。
- `chunkSize`：不放 tool input，这是内部调参。
- `embeddingModel`：不放 tool input，这是内部实现。
- `maxChars`：可以放 tool input，因为它影响返回预算。
- `debug`：默认不放，开发期可以通过 pref 或 dev flag 控制。

## 5. 对当前项目的推荐划分

外部 MCP tools 保持：

```text
get_active_paper
paper_read
```

内部模块：

```text
src/mcp/tools/paperRead.ts
  - 解析 MCP input
  - 校验 schema
  - resolve current scope
  - 调 ActivePaperRetrievalService

src/paperReading/ActivePaperRetrievalService.ts
  - read()
  - buildOverviewContext()
  - retrieveRelevantSnippets()
  - resolvePageText()
  - resolveSectionHint()
  - buildWarnings()

src/paperReading/retrieval/
  - chunker
  - bm25Retriever
  - hybridRetriever
  - ranker
  - evidencePacker

src/zotero/contextGateway.ts
  - Zotero 原材料读取
```

一句话总结：

```text
paper_read tool 决定“模型能请求什么”。
ActivePaperRetrievalService 决定“系统如何把请求变成可靠证据”。
ZoteroContextGateway 决定“从 Zotero 哪里拿原材料”。
```

这样设计后，模型不会看到 `paper_search`、`chunk`、`ranker` 这些工程细节，但你的内部实现仍然可以逐步从 keyword retrieval 升级到 hybrid RAG、page image、OCR、reranker。
