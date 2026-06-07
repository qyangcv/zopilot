我建议下一步不要直接做复杂 `paper_read(section/pageRange)`，而是按“先把工具通道打通，再做检索质量，再收薄 prompt”的顺序拆。

**推荐顺序**

1. 先做一个很小的 Step 4.1：补齐当前 gateway 的测试和小清理。
2. 再做 Step 5.1：实现 read-only MCP 最小闭环，只暴露 metadata/selection/scope。
3. 再做 Step 5.2：实现 `paper_search`，让 Codex 能按 query 读当前论文片段。
4. 最后做 Step 5.3：实现更高级的 `paper_read`，支持 overview / targeted / pageRange。
5. MCP 稳定后，再把 `promptBuilder` 收薄，避免 prompt 越来越重。

**Step 4.1：先补稳定性，不急着上 MCP**

目的：确认现在的 `ZoteroContextGateway` 边界足够稳。当前 gateway 已完成 Step 4，并为 Step 5 预留了 `getAttachmentFullTextForTool()`，但还缺单元测试和几个小 polish。

建议做：

- 给 `src/zotero/contextGateway.ts` 加 focused tests，mock Zotero item/reader：
  - active reader 不存在
  - reader item 不是 attachment
  - PDF attachment 有 parent item
  - PDF attachment 无 parent item
  - `attachmentText` 为空
  - `Zotero.Fulltext` / `Zotero.FullText` 不存在
- 把 `promptBuilder` 里的 `PDF full-text preview` 字段改掉。现在 prompt 路径不填 preview，通常显示 `(none)`，容易误导；建议改成：
  - `Full-text included in prompt: false`
  - `Full-text status: indexed/partial/...`
- 给 `window.__zcpLastPrompt` 加注释或后续 pref 控制，避免它长期像正式 API 一样存在。

验收：

- `npm run build`
- `npm run lint:check`
- 新增 tests 通过
- 手动在 Zotero reader 里确认 prompt debug 还能打印完整 context

**Step 5.1：MCP 最小闭环**

目的：先证明 Codex app-server 能看到 Zotero MCP tools，不要一开始做 retrieval。

第一批 tools 只做这三个：

```text
get_active_paper
get_paper_metadata
read_selected_text
```

先不要做 `paper_read`。原因很简单：如果 MCP endpoint、auth、scope、thread config 都还没跑通，直接做 PDF retrieval 会把问题混在一起。

建议新增：

```text
src/mcp/protocol.ts
src/mcp/server.ts
src/mcp/scope.ts
src/mcp/tools/getActivePaper.ts
src/mcp/tools/getPaperMetadata.ts
src/mcp/tools/readSelectedText.ts
src/codex/mcpConfig.ts
```

关键设计：

- MCP 只读。
- scope 只允许当前 reader paper。
- 每个 tool 返回 `warnings`。
- 不做全库读取。
- 不允许任意文件路径读取。
- tool result 不要直接返回本地 PDF path 给模型，除非作为诊断字段并受控。

验收：

- MCP initialize 成功。
- `tools/list` 能看到 3 个 tools。
- `tools/call get_active_paper` 返回当前 reader scope。
- 无 active PDF reader 时返回可读错误，不 crash。
- Codex turn 能感知这些 tools，至少能调用 metadata/selection tool。

**Step 5.2：先做 `paper_search`**

目的：让“问当前论文内容”从 prompt 注入升级为按需检索。

`paper_search` 应该优先用现有 gateway：

```text
paper_search(query)
  -> ZoteroContextGateway.getActivePaper()
  -> getAttachmentFullTextForTool()
  -> chunk
  -> score
  -> return snippets + provenance + warnings
```

第一版检索可以先朴素，不必上 embedding：

- normalize text
- 固定 chunk size，例如 1200-1800 chars
- chunk overlap，例如 150-250 chars
- query term matching + simple score
- 返回 top 3-5 snippets
- 每个 snippet 带 `charStart` / `charEnd`

返回结构建议：

```json
{
  "source": "zotero_fulltext",
  "attachmentId": 123,
  "query": "method",
  "snippets": [
    {
      "text": "...",
      "charStart": 1200,
      "charEnd": 2400,
      "score": 0.72
    }
  ],
  "warnings": []
}
```

验收：

- 问“这篇论文的方法是什么”，模型应该调用 `paper_search`。
- 未索引 / 空全文 / 扫描 PDF 时返回明确 warning。
- 返回内容有长度限制，不能把整篇论文作为 tool result 甩给模型。

**Step 5.3：再做 `paper_read`**

`paper_read` 不建议一开始设计成 `read_section("3")`。更稳的接口是语义模式：

```text
paper_read({ mode: "overview" })
paper_read({ mode: "targeted", query: "training objective" })
paper_read({ mode: "page", pageRange: "5-7" })
```

第一版可以只实现：

- `overview`：metadata + abstract + full-text 前几个高质量 chunks
- `targeted`：内部调用 `paper_search`
- `page`：先返回 unsupported 或 best-effort warning，等有 page boundary 再做

验收：

- “总结这篇论文”走 `overview`
- “解释第 3 节方法”可以先转成 targeted query，而不是假装精确 section parser
- 每次返回都带 `confidence` 和 `warnings`

**最后再收薄 promptBuilder**

等 MCP 可用后，`promptBuilder` 应从“塞上下文”改成“路由提示”：

```text
You are answering questions about the current Zotero paper.
Use Zotero MCP tools when paper content is needed.
Current scope: attachmentId=..., parentItemId=...
User question: ...
```

metadata/abstract 可以保留很少量作为 fallback，但不要继续扩大 prompt 注入。长期质量会主要来自 `paper_search` / `paper_read`，不是更长的 prompt。

我的推荐优先级：先做 `Step 4.1` 和 `Step 5.1`。这两个完成后，架构边界就定了；再做 `paper_search` 会更稳。
