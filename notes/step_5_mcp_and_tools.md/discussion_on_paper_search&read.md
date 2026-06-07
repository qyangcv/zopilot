是的，但要说精确一点：

`notes/llm-for-zotero-philosophy.md` 采用的是**“高层 paper_read 作为 semantic facade，底层 retrieval 负责找证据”**这个设计思想。

不过它不完全等于“公开暴露 `paper_search` + `paper_read` 两个工具”。笔记里说，`llm-for-zotero` 的 `paper_read` 有 `overview / targeted / visual / capture` 模式，其中 `targeted` 会走 retrieval 层。也就是说：

```text
llm-for-zotero 原实现更像：
paper_read(targeted)
  -> retrievalService.retrieveEvidence(...)
```

而我们在 `notes/step4.5-5.md` 里的建议是把这个底层 retrieval 能力也显式做成一个 tool：

```text
paper_search(query)
  -> chunk + score + snippets

paper_read(targeted)
  -> 内部调用 paper_search(query)
```

所以答案是：**采用了同一个分层思想，但本项目笔记把底层检索能力显式拆成了 `paper_search`，这是对 llm-for-zotero 思路的简化和工程化改造。**

**这种设计的优点**

第一，职责清楚。

`paper_search` 只负责找证据：

```json
{
  "query": "training objective",
  "topK": 5
}
```

返回：

```json
{
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

`paper_read` 负责按阅读意图组织内容：

```json
{
  "mode": "overview"
}
```

或：

```json
{
  "mode": "targeted",
  "query": "training objective"
}
```

返回的是更像“阅读包”的东西：metadata、abstract、snippets、locator、confidence、warnings。

第二，便于分阶段实现。

先做 `paper_search`，你只需要验证：

```text
当前 PDF -> 全文 -> chunk -> ranking -> snippets
```

这条链路是否稳定。

再做 `paper_read`，才处理更复杂的语义：

```text
overview 怎么取？
targeted 怎么调 search？
pageRange 怎么处理？
section 是否只是 hint？
```

如果一开始只做一个巨大的 `paper_read`，调试会很痛苦。你不知道问题出在 MCP、scope、全文读取、chunking、ranking、mode routing，还是 section/page 解析。

第三，对 Zotero 的真实能力更诚实。

Zotero 能比较稳定地给你：

```text
当前 PDF attachment
parent item metadata
attachmentText 全文纯文本
selection
annotation 原材料
```

但 Zotero 不稳定提供：

```text
章节树
Abstract 到 Introduction 的精确边界
第 5 页到第 7 页的纯文本边界
Figure/Table 的视觉内容
```

所以 `paper_search` 先基于纯文本检索，是现实可行的。`paper_read(section/page)` 必须带 `confidence/warnings`，不能假装 Zotero 已经给了结构化论文。

第四，模型调用时更自然。

用户问：

```text
这篇论文主要贡献是什么？
```

应该走：

```json
paper_read({ "mode": "overview" })
```

用户问：

```text
它的 reward model 是怎么训练的？
```

可以走：

```json
paper_read({ "mode": "targeted", "query": "reward model training" })
```

或者直接：

```json
paper_search({ "query": "reward model training" })
```

这比暴露 `read_pdf_chunk(offset=...)` 这种底层接口更适合 LLM。

**这种设计的缺点**

最大问题是：`paper_search` 和 `paper_read(targeted)` 容易语义重叠。

如果两个都是公开 tool，模型可能困惑：

```text
我应该调用 paper_search？
还是 paper_read({ mode: "targeted" })？
```

尤其是用户问“它用了什么数据集？”这种问题，两者都能做。工具描述如果写得不好，会导致模型乱选、重复调用，甚至先 `paper_read(targeted)`，再 `paper_search`，浪费 token。

第二，`paper_read` 容易变成大杂烩。

一旦把这些都塞进 `paper_read`：

```text
overview
targeted
page
section
visual
capture
selected text
figure/table
```

它会变成一个非常宽的 facade。好处是入口统一，坏处是内部逻辑越来越复杂，测试矩阵爆炸。

第三，`overview` 模式有误导风险。

`overview` 常常会读 abstract、开头、结论、若干 chunks。但如果当前 paper scope 错了，或者全文 chunk 混了附近 item，overview 会给出看似完整但其实错误的摘要。你之前的 Zotero paper reading 经验里也出现过 overview 混入附近论文的问题，所以 targeted/page anchored 反而有时更可靠。

第四，`section` 和 `page` 很容易伪精确。

比如：

```json
paper_read({ "mode": "targeted", "sections": ["Method"] })
```

如果 `sections` 只是检索 hint，却被用户理解成“精确读取 Method section”，那就是 UX 风险。返回结果必须明确：

```json
{
  "locator": {
    "type": "section_hint",
    "value": "Method"
  },
  "confidence": "medium",
  "warnings": [
    "Section boundaries are inferred from text headings, not provided by Zotero."
  ]
}
```

否则模型回答时会过度自信。

第五，底层 search 质量会决定上层 read 质量。

如果第一版 `paper_search` 只是 keyword match，它对这些 query 可能还可以：

```text
dataset
reward model
Table 1
Figure 3
ablation
```

但对这些就可能很差：

```text
作者为什么这样设计？
这个训练阶段的动机是什么？
和 baseline 的核心区别是什么？
```

这些需要 query expansion、heading/caption boost、embedding、rerank，甚至 page visual support。

**我建议的改进**

我会把设计调整成三层，而不是只说两个工具：

```text
1. retrieval core
   内部模块，不一定暴露给模型
   chunk / score / rerank / cache / provenance

2. paper_search
   证据检索 tool
   面向“找原文依据”

3. paper_read
   阅读语义 tool
   面向“总结/解释/按模式读取”
```

也就是说，真正的依赖关系应该是：

```text
paper_read
  -> retrieval core

paper_search
  -> retrieval core
```

而不是一定让：

```text
paper_read -> paper_search
```

这样更干净。`paper_search` 是 retrieval core 的一个公开包装，`paper_read` 是另一个公开包装。它们共享底层实现，但不一定互相调用。

更推荐的关系图：

```text
ZoteroContextGateway
  -> PaperTextStore
      -> Chunker
      -> Retriever
          -> paper_search
          -> paper_read(targeted)
      -> OverviewBuilder
          -> paper_read(overview)
      -> PageTextReader
          -> paper_read(page)
```

**工具层可以这样改**

保留 `paper_search`，但把它定位得非常窄：

```text
paper_search = find evidence snippets in the current paper
```

输入：

```json
{
  "query": "training objective",
  "topK": 5,
  "maxSnippetChars": 1200,
  "hints": {
    "sections": ["Method", "Training"],
    "pages": "5-7"
  }
}
```

注意 `hints` 只是 hint，不保证精确。

返回：

```json
{
  "source": "zotero_fulltext",
  "query": "training objective",
  "snippets": [],
  "warnings": [],
  "retrieval": {
    "method": "keyword",
    "chunkSize": 1600,
    "hasEmbeddings": false
  }
}
```

`paper_read` 则更高层：

```json
{
  "mode": "overview",
  "maxChars": 6000
}
```

```json
{
  "mode": "targeted",
  "question": "How is the reward model trained?",
  "evidenceBudget": "focused"
}
```

```json
{
  "mode": "page",
  "pages": "5-7",
  "includeNeighborPages": 1
}
```

返回：

```json
{
  "mode": "targeted",
  "reading": {
    "summary": null,
    "snippets": []
  },
  "locator": {},
  "confidence": "medium",
  "warnings": []
}
```

这里我建议 `paper_read` 不要直接生成 summary。它应该返回“阅读材料”，最终自然语言总结仍交给模型。否则 tool 和 model 的职责又混了。

**是否应该两个都暴露给模型？**

有两种路线。

路线 A：只公开 `paper_read`，把 `paper_search` 做成内部模块。

优点：模型不会困惑，用户意图全部走一个入口。

缺点：调试检索质量不方便，也不利于回答“给我找原文依据”这种问题。

路线 B：两个都公开，但描述强约束。

我更推荐本项目初期用路线 B，因为你现在还在搭 Step 5，需要可调试性。

工具描述要写死：

```text
Use paper_search when you need evidence snippets for a specific query.
Use paper_read overview when the user asks for a general summary.
Use paper_read targeted when the user asks to read around a question with context.
Do not use paper_read page unless the user explicitly asks for pages.
```

这样模型选择会稳定很多。

**我的结论**

`notes/llm-for-zotero-philosophy.md` 的核心设计是：`paper_read` 是语义入口，`targeted` 内部走 retrieval。它没有把 `paper_search` 作为重点讨论的同级公开工具。

本项目把 `paper_search` 单独拆出来是合理的，原因是当前阶段需要先验证 retrieval 质量、scope、安全边界和 provenance。长期看，最好的设计不是让两个工具平级竞争，而是：

```text
paper_search = 专门找证据
paper_read = 按阅读意图组织上下文
二者共享同一个 retrieval core
```

如果要再收敛一点，我建议文档里明确写一句：

```text
paper_search is a low-level evidence retrieval tool.
paper_read is a high-level reading facade.
They are not parallel alternatives; paper_read may use the same retrieval core as paper_search.
```
