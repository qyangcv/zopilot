MCP tools 可以取代大部分“上下文拼接型 promptBuilder”，但不能简单替换成“mention PDF path，让 Codex 自己处理 PDF”。

更稳的结论是：

```text
让 MCP tool 成为 Zotero PDF 阅读器
Codex 通过 tool 按需读章节 / 页码 / 检索片段
promptBuilder 只保留极薄的任务路由
```

---

**一、为什么不把 PDF path 当主能力**

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

当前 app-server 协议里的 `mention` 是 `{ name, path }` 这类路径引用，不是 PDF 专用输入。真正要读 PDF，仍然需要某个执行者完成：

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

所以 `mention PDF path` 表面更简单，实际是把复杂度从插件代码转移给 Codex runtime，而且边界更不稳定。

---

**二、推荐架构**

推荐把 Step 4 和 Step 5 合并为一个 MCP-first 阶段：

```text
Sidebar
  -> CodexBridge
  -> codex app-server
  -> Zotero MCP tools
      -> ZoteroContextGateway
      -> Zotero full-text cache / PDF text extraction / attachment access
```

当前阶段的 scope 只来自 Zotero PDF reader：用户已经点击打开了一篇文献，zotero-copilot 只围绕该 reader 当前 PDF 工作。暂不读取 Zotero 主窗口文献列表中的 selected regular item 或 selected PDF attachment；主窗口 zotero-copilot 入口预留给未来 library 级别文献 QA / 全库对话。

`promptBuilder` 不再负责塞入大量论文内容，只负责“任务指令和路由提示”：

```text
You are answering questions about the current Zotero paper.
Use Zotero MCP tools when paper content is needed.
Current paper scope: itemID=...
User question: ...
```

真正的论文内容由 MCP tools 按需提供：

```text
get_active_paper()
get_paper_metadata()
read_selected_text()
paper_read({ section: "3" })
paper_read({ pageRange: "5-7" })
paper_search({ query: "method" })
```

这样用户不需要手动选中内容，可以直接问：

```text
分析第 3 节的方法
总结实验设置
解释 Figure 2 附近的论证
比较 Related Work 和 Method 的核心差异
```

但负责“读 PDF / 定位章节 / 返回文本”的应该是 Zotero MCP tool，而不是裸传 PDF path。

---

**三、metadata 为什么仍然有价值**

Zotero metadata 不一定要作为主要论文上下文塞给模型，但它适合作为轻量 scope：

```text
itemID
libraryID
attachmentID
title
year
DOI
PDF path
```

这些信息不是给模型“理解论文”的，而是给系统“确定读哪篇论文”的。尤其在 Zotero 里，一个 regular item 可能有多个附件，PDF title 也可能和 Zotero item title 不一致。

在当前 reader-only 阶段，regular item 只通过 reader 当前 PDF attachment 的 parent item 获得；不从主窗口 selection 读取 regular item，也不从主窗口选中的 regular item 反向猜主 PDF。

所以 metadata 应该服务于 scope 和 disambiguation，而不是取代 PDF 内容。

---

**四、实现顺序**

1. 实现 `ZoteroContextGateway`

职责：

```text
读取 PDF reader 当前 item
从 reader PDF attachment 回溯 parent item
确认当前 reader PDF attachment
读取 PDF path
读取 Zotero full-text cache
读取 reader selection
返回轻量 metadata / scope
```

2. 实现 MCP tools first

第一批只做 read-only tools：

```text
get_active_paper
get_paper_metadata
get_paper_text_status
read_selected_text
paper_search
paper_read
```

其中 `paper_search` 应优先于复杂的章节解析，因为 query-based retrieval 更稳。`paper_read({ section })` 和 `paper_read({ pageRange })` 可以逐步增强。

3. 保留 minimal `promptBuilder`

只传：

```text
当前 paper scope
可用工具说明
用户问题
必要的行为约束
```

不要再把 abstract、selected text、attachment preview 大段塞入 prompt，除非作为 MCP 失败后的 fallback。

4. 不优先使用 `mention PDF path`

`mention PDF path` 可以作为 debug 或 fallback，但不要作为主能力。主能力应该是 scope-bound Zotero MCP tools。

---

**五、PDF 读取策略**

不要自己从零实现 PDF parser。插件要实现的是读取编排、chunking、检索、缓存和错误处理。

优先级：

1. 使用 Zotero 已有 full-text content。
2. 对全文做 chunking 和缓存。
3. 用 `paper_search(query)` 返回相关片段。
4. 用启发式 heading 匹配支持 `paper_read(section)`。
5. 后续再用 PDF.js、`pdftotext`、PyMuPDF 等成熟工具支持 page-level fallback。

`paper_read` / `paper_search` 返回时要带 provenance 和 warning：

```json
{
  "paperId": "123",
  "attachmentId": "456",
  "locator": "section: 3",
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

PDF 解析永远不可能绝对稳定，所以 tool 应该显式处理：

```text
PDF 没有文本层
Zotero 尚未完成索引
章节标题找不到
页码和 PDF label 不一致
多附件无法判断主 PDF
扫描版需要 OCR
```

---

**六、完成标准**

合并后的 Step 4/5 完成标准：

```text
Codex 能通过 MCP 识别当前 Zotero paper scope
scope 来源是当前 PDF reader，而不是 Zotero 主窗口文献列表 selection
Codex 能调用 get_active_paper / paper_search / paper_read / read_selected_text
paper_search 能基于 Zotero full-text 返回相关片段
paper_read 能处理 section 或 pageRange，并在不确定时返回 warning
MCP tool 有 schema、错误处理、scope 限制和 timeout
MCP scope 限制当前 reader paper，不做全库 library search
sidebar 默认只显示最终回答，不显示 raw prompt / raw tool result
promptBuilder 只保留 minimal task routing
mention PDF path 不作为主路径
```

---

**一句话总结**

MCP tools 的确可以取代“大段上下文注入”的 promptBuilder；但不能简单替换成“mention PDF path”。更稳的做法是：让 Zotero MCP tool 成为 PDF 阅读器，Codex 通过 tool 按需读章节、页码或检索片段；`promptBuilder` 只保留极薄的一层任务路由。
