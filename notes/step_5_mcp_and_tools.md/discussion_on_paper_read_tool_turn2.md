我同意你的判断，而且这比前面那套更适合当前项目。

关键点是：**tool 设计不应该照搬 `llm-for-zotero` 的概念体系**。`overview / targeted / visual / capture` 是它为了覆盖复杂 agent platform 做出来的接口，不是 `zotero-copilot` 当前阶段必须继承的抽象。我们真正要设计的是：模型需要几个外部工具，才能稳定读取“当前 Zotero reader 里的这篇论文”。

在这个边界下，完全可以只保留一个 tool：

```text
paper_read
```

然后把 search/retrieval/chunk/ranking 全部放到底层实现里，而不是暴露成 `paper_search` tool。

## 为什么合并更合理

模型看到两个工具：

```text
paper_search
paper_read
```

它一定会遇到选择问题：

```text
问“这篇论文的方法是什么”该 search 还是 read？
问“有没有提到 reward model”该 search 还是 read？
问“总结一下方法部分”该 search 还是 read？
```

这不是理论风险，而是实际 agent tool 设计里很常见的问题：两个工具都能完成任务，但语义边界靠提示词维持，模型就会重复调用、错调用，或者先调用一个再调用另一个。

从产品语义上看，用户和模型真正想做的是“读论文”，不是“搜索论文”。搜索只是实现读论文的一种底层手段。所以外部 tool 应该贴近用户任务：

```text
paper_read = read relevant content from the current paper
```

内部可以有：

```text
ZoteroContextGateway
PaperTextLoader
Chunker
Retriever
Ranker
LocatorResolver
```

但这些不必成为模型可见工具。

## 更好的分层应该是

```text
模型可见：
paper_read

模型不可见：
ZoteroContextGateway
  -> getActivePaper()
  -> getPaperMetadata()
  -> getSelectedText()
  -> getAttachmentFullTextForTool()

ActivePaperRetrievalService
  -> buildOverviewContext()
  -> retrieveRelevantSnippets()
  -> resolvePageText()
  -> resolveSectionHint()
  -> buildWarnings()
```

也就是说，`paper_search` 不是消失，而是降级为内部函数：

```ts
retrieveRelevantSnippets(query, options);
```

它不再是 MCP tool。

这样设计更干净：

```text
tool API = 用户/模型意图层
service API = 工程实现层
```

## 合并后的 paper_read 应该怎么设计

我建议不要照搬 `mode` 体系，但仍然需要让输入表达“我要读什么”。可以设计成一个更自然的 schema：

```json
{
  "question": "这篇论文的训练目标是什么？",
  "locator": {
    "pages": "5-7",
    "sectionHint": "Method"
  },
  "includeSelection": false,
  "maxSnippets": 5,
  "maxChars": 6000
}
```

其中：

- `question`：用户问题或检索目标。存在时，内部走 retrieval。
- `locator.pages`：用户明确要求页码时使用。
- `locator.sectionHint`：只作为 hint，不承诺精确 section parser。
- `includeSelection`：如果用户说“解释我选中的内容”，读取 reader selection。
- `maxSnippets/maxChars`：限制返回体积。

如果用户只是说“总结这篇论文”，可以调用：

```json
{
  "question": "Summarize the current paper: problem, method, experiments, contributions.",
  "maxSnippets": 8,
  "maxChars": 8000
}
```

也可以允许空 question：

```json
{
  "maxChars": 8000
}
```

表示“读取当前论文的默认上下文”：metadata、abstract、开头若干 chunks、warnings。

我更倾向于保留 `question`，因为它让所有读取都变成“围绕用户问题构造上下文”，比 `mode=overview/targeted` 更统一。

## 返回结构

`paper_read` 返回的不是最终答案，而是“可引用的阅读材料”：

```json
{
  "paper": {
    "attachmentId": 123,
    "parentItemId": 456,
    "title": "..."
  },
  "metadata": {
    "title": "...",
    "authors": [],
    "year": "2025",
    "abstract": "..."
  },
  "snippets": [
    {
      "text": "...",
      "locator": {
        "type": "charRange",
        "charStart": 1200,
        "charEnd": 2400,
        "sectionHint": "Method"
      },
      "score": 0.72,
      "source": "zotero_fulltext"
    }
  ],
  "warnings": [
    "Section boundaries are inferred from text and may be imprecise."
  ]
}
```

模型再基于这些材料回答用户。

## 这种合并方案的优点

第一，模型 action space 更小。
只要需要论文内容，就调用 `paper_read`。没有 `search vs read` 的选择成本。

第二，接口更贴近产品语义。
用户不是在使用搜索引擎，而是在让 Copilot 读当前论文。

第三，内部实现仍然可扩展。
以后可以加入 keyword search、embedding、caption boost、page extraction、PDF.js、OCR，但外部 tool 不变。

第四，测试更清楚。
你测试 `paper_read` 的几类输入即可：

```text
无 question：默认读取当前 paper context
有 question：返回相关 snippets
有 pages：优先页码读取
有 sectionHint：作为 retrieval hint
有 selection：返回选中文本
全文不可用：返回 warning
```

第五，避免把工程细节暴露给模型。
`paper_search` 其实是 implementation detail。把它暴露出去，会让模型参与“检索策略选择”，但模型并不一定比你的 service 层更适合做这个决策。

## 合并方案的风险

合并后最大风险是 `paper_read` 变成万能大工具。这个要靠 schema 克制。

不要把它设计成：

```json
{
  "mode": "...",
  "target": "...",
  "visual": true,
  "capture": true,
  "library": true,
  "writeNote": true,
  "search": true
}
```

这会重新变成复杂 platform。

当前阶段只限定：

```text
当前 reader paper
只读
文本为主
metadata / abstract / selection / fulltext snippets
不做全库
不做写入
不做 shell
不做复杂 visual page render
```

另一个风险是调试 retrieval 不方便。因为没有 `paper_search` tool，不能单独让模型调用 search。解决方法不是暴露给模型，而是做 diagnostics：

```text
paper_read result.retrievalDebug
开发 pref 控制
或 window.__zcpLastPaperRead
或 Zotero debug log
```

比如开发期返回：

```json
{
  "debug": {
    "retrievalMethod": "keyword",
    "chunkSize": 1600,
    "overlap": 200,
    "candidateChunks": 42
  }
}
```

正式结果里默认隐藏。

## 我会怎么改文档里的设计

把原来的：

```text
get_active_paper
get_paper_metadata
read_selected_text
paper_search
paper_read
```

收敛成：

```text
paper_read
```

这里的 `get_active_paper` 能力仍然需要保留，但不作为 MCP tool 暴露给模型。它应该下沉为 `paper_read` 的内部前置步骤：每次 `paper_read` 调用都先确认当前 active PDF reader scope，再读取 metadata / selection / fulltext / snippets。

最终推荐：

```text
MCP tools:
1. paper_read
```

其中：

```text
paper_read = 唯一论文内容读取入口，内部完成 active paper scope 解析、metadata/status、selection/fulltext/retrieval/page/section hint
```

这样比五个工具干净很多，也比 `get_active_paper + paper_read` 更少一次 tool-choice 分叉。调试“当前读的是哪篇论文”应通过 `paper_read` result 的 scope summary、开发期 diagnostics、`window.__zcpLastActivePaper` 或 Zotero debug log 完成，而不是额外公开一个模型可见 tool。

## 结论

你的方向是对的：`paper_search` 和 `paper_read` 的边界确实不够硬。既然本项目当前目标是“读当前 Zotero PDF”，不是构建完整文献 agent platform，那么外部只暴露 `paper_read` 更合理。

我会把设计原则改成：

```text
Do not expose retrieval as a separate model tool unless the user-facing task truly requires search as a distinct action.
For current-paper QA, expose one read tool and keep retrieval internal.
```

对应到当前项目：

```text
paper_read = 唯一论文内容读取入口
retrieval/search = ActivePaperRetrievalService 内部实现细节
ZoteroContextGateway = 数据来源边界
```

这比 `paper_search + paper_read` 更简洁，也更不容易让模型混淆。
