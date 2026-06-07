**当前结论**

基于 commit `db260ee05df16abdf48d750a0de3cd9ee9f31217`，Step 4 已经实现：Zotero Copilot 会在用户提交问题时读取当前 PDF reader paper 的 metadata、attachment、全文索引状态、reader selection 和 warning，并把这些结构化上下文拼入发给 Codex app-server 的 prompt。

Step 5 还没有实现：当前没有 MCP endpoint、没有 read-only tools、没有 Codex thread MCP config 注入，也没有 `paper_search` / `paper_read`。因此现在的状态不是“MCP-first 已完成”，而是：

```text
Step 4 explicit context injection: done
Step 5 scoped read-only MCP tools: pending
```

这并不推翻之前的架构判断：MCP tools 仍然应该取代大部分“上下文拼接型 promptBuilder”，但不能简单替换成“mention PDF path，让 Codex 自己处理 PDF”。更稳的长期方向仍是：

```text
让 MCP tool 成为 Zotero PDF 阅读器
Codex 通过 tool 按需读章节 / 页码 / 检索片段
promptBuilder 只保留极薄的任务路由
```

---

**一、Step 4 已实现什么**

当前调用链：

```text
Sidebar submit
  -> ZoteroContextGateway.getPromptContext(activeReader)
  -> buildPaperQuestionPrompt(userQuestion, promptContext)
  -> CodexBridge.sendPrompt(prompt)
```

新增实现：

- `src/zotero/contextGateway.ts`
- `src/zotero/types.ts`
- `src/codex/promptBuilder.ts`
- `src/modules/sidebar/index.ts` 中 submit 流程接入 gateway 和 promptBuilder

已满足的 Step 4 目的：

- 只基于当前 PDF reader 识别 paper scope，不读取主窗口文献列表 selection。
- 从 reader 当前 PDF attachment 回溯 parent regular item。
- 读取 title、authors、year、DOI、abstract、itemID、libraryID、key。
- 读取当前 PDF attachment 的 content type、path、exists、readable。
- 读取 Zotero full-text indexed state。
- best-effort 读取 reader selected text。
- 无 active reader、无 parent item、非 PDF、无 selection、全文 API 不可用等情况返回 warning。
- sidebar 仍只显示用户问题和最终回答，不显示 raw prompt。
- 通过 `window.__zcpLastPrompt` / `window.__zcpLastPromptContext` 保留开发期调试入口。

需要注意的实现取舍：

- Prompt 路径现在只读取全文索引状态，不读取完整 PDF full text，也不注入 text preview。
- 完整全文读取留在 `getAttachmentFullTextForTool()`，作为 Step 5 `paper_search` / `paper_read` 的数据源。
- 因此当前 `promptBuilder` 中 `PDF full-text preview` 通常会是 `(none)`；后续应删掉该字段或改成“prompt path omitted full text”。

---

**二、为什么仍然不把 PDF path 当主能力**

`mention` PDF path 只是告诉 `codex app-server`：

```text
这里有一个本地路径：/path/to/paper.pdf
```

它不等于：

```text
Codex 已经理解这篇 PDF
Codex 能稳定抽取第 3 节
Codex 能按页码 / 章节定位
Codex 能访问 Zotero attachment
Codex 能处理 Zotero scope / 权限 / 多附件
```

真正要读 PDF，仍然需要某个执行者完成：

```text
打开 PDF
抽取文本
定位章节
返回相关片段
```

如果这个执行者不是 Zotero MCP tool，就只能依赖 Codex 自己的文件读取或 shell 能力。这会带来几个问题：

1. PDF 解析不是 `codex app-server` 的明确 PDF input contract。
2. 可能需要 shell、`pdftotext`、Python parser 或其他外部工具，不适合默认开放。
3. Zotero attachment 路径可能不在 Codex 当前 `cwd` 或 sandbox 权限内。
4. 很难自然处理 Zotero 的 item、parent item、多 PDF、snapshot、supplementary files。
5. scope 限制更难做，模型可能读到用户没打算暴露的本地文件。
6. 错误提示更难做：路径不可读、PDF 无文本层、解析失败、章节定位失败会混在一起。

所以 `mention PDF path` 可以作为 debug 或 fallback，但不应作为主能力。

---

**三、Step 5 推荐架构**

下一步仍建议把 Step 5 做成 scoped read-only MCP：

```text
Sidebar
  -> CodexBridge
  -> codex app-server
  -> Zotero MCP tools
      -> ZoteroContextGateway
      -> Zotero full-text cache / chunking / retrieval
```

当前阶段 scope 仍只来自 Zotero PDF reader：用户已经点击打开了一篇文献，zotero-copilot 只围绕该 reader 当前 PDF 工作。暂不读取 Zotero 主窗口文献列表中的 selected regular item 或 selected PDF attachment；主窗口 zotero-copilot 入口预留给未来 library 级别文献 QA / 全库对话。

Step 5 后，`promptBuilder` 应收薄为任务路由：

```text
You are answering questions about the current Zotero paper.
Use Zotero MCP tools when paper content is needed.
Current paper scope: attachmentID=..., parentItemID=...
User question: ...
```

真正的论文内容由 MCP tools 按需提供：

```text
get_active_paper()
get_paper_metadata()
read_selected_text()
paper_search({ query: "method" })
paper_read({ mode: "overview" })
paper_read({ mode: "targeted", query: "training objective" })
paper_read({ pageRange: "5-7" })
```

---

**四、PDF 读取策略**

不要自己从零实现 PDF parser。插件要实现的是读取编排、chunking、检索、缓存和错误处理。

优先级：

1. 使用 Zotero 已有 full-text content：`attachment.attachmentText`。
2. 对全文做 chunking 和缓存。
3. 用 `paper_search(query)` 返回相关片段。
4. 用启发式 heading 匹配支持 `paper_read(mode="targeted", sections?)`。
5. 后续再用 PDF.js、`pdftotext`、PyMuPDF 等成熟工具支持 page-level fallback。

`paper_read` / `paper_search` 返回时要带 provenance 和 warning：

```json
{
  "paperId": "123",
  "attachmentId": "456",
  "locator": "query: method",
  "source": "zotero_fulltext",
  "confidence": "medium",
  "snippets": [
    {
      "text": "...",
      "charStart": 12031,
      "charEnd": 15320
    }
  ],
  "warnings": ["Section boundary is heuristic."]
}
```

必须显式处理：

```text
PDF 没有文本层
Zotero 尚未完成索引
章节标题找不到
页码和 PDF label 不一致
多附件无法判断主 PDF
扫描版需要 OCR
```

---

**五、当前完成标准核查**

已完成：

- reader-only `ZoteroContextGateway`。
- 当前 PDF reader paper scope 识别。
- parent metadata 读取。
- PDF attachment path/status 读取。
- reader selected text best-effort 读取。
- full-text indexed state 读取。
- tool/retrieval 用完整全文读取入口预留。
- sidebar 默认只显示最终回答，不显示 raw prompt / raw context。

未完成：

- MCP initialize。
- `tools/list` / `tools/call`。
- `get_active_paper` / `get_paper_metadata` / `read_selected_text` / `paper_search` / `paper_read`。
- tool schema、错误处理、timeout、scope token、bearer token。
- Codex thread config 注入 MCP server。
- `paper_search` chunking/retrieval/cache。
- `paper_read` section/page/overview 语义。

---

**一句话总结**

commit `db260ee` 已经把 Step 4 从普通聊天升级为“围绕当前 Zotero PDF reader paper 的显式上下文问答”；Step 5 仍应按 scoped read-only MCP 推进，让 Zotero MCP tools 成为受控 PDF 阅读器，而不是把 PDF path 裸传给 Codex。
