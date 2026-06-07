这里的“四种模式”不是用户手动点 UI 切换，而是模型调用 `paper_read` tool 时传入的 `mode` 参数。代码里默认逻辑是：如果没传 mode，`normalizeMode()` 会把它当成 `overview`。

```ts
type PaperReadMode = "overview" | "targeted" | "visual" | "capture";
```

见 `paperRead.ts` 的 mode 定义和 schema：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L38-L52>
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L421-L490>

**1. `overview`：用于“先整体理解这篇论文”**

典型问题：

```text
总结这篇论文
这篇论文主要贡献是什么？
这篇 paper 讲什么？
main message 是什么？
```

调用形态大概是：

```json
paper_read({ "mode": "overview" })
```

它的执行路径是：

1. 先解析默认目标 paper：如果 tool 没传 `target/targets`，就从当前 Zotero request 的 paper context 里找。
2. 对每个 target，优先读 MinerU 生成的 `full.md`。
3. 如果 MinerU 不可用，就读 raw PDF text chunks。
4. 如果 PDF 文本不可抽取，再 fallback 到 Zotero metadata / abstract。

对应代码在 `paperRead.ts`：

```ts
if (input.mode === "overview") {
  const mineru = await tryReadMineruOverview(...)
  ...
  await pdfService.getOverviewExcerpt(...)
  ...
  buildMetadataOverview(...)
}
```

源码：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L622-L659>

这里的重点是：`overview` 不追求定位某一句证据，而是给模型一个“论文整体结构 + 开头 + 结论附近内容 + metadata/abstract fallback”。所以它适合第一轮理解，但不适合回答“第 3 节具体怎么做”这种精确问题。

**2. `targeted`：用于“针对具体问题找证据片段”**

典型问题：

```text
它用了什么 dataset？
实验设置是什么？
作者在哪里解释 Figure 2？
第 3 节的方法具体是什么？
它有没有提到 reward model？
```

调用形态大概是：

```json
paper_read({
  "mode": "targeted",
  "query": "training data and dataset construction",
  "sections": ["Method", "Experiments"],
  "topK": 5
})
```

它的执行路径是：

1. 如果传了 `pages`，优先走显式页码读取，返回这些页的 page text。
2. 如果没传 `pages`，就把 `query + sections` 拼成检索问题。
3. 调用 `retrievalService.retrieveEvidence()`。
4. retrieval 层会基于 PDF chunks、query plan、embedding 可用性、cache，返回 top passages。
5. 结果会按 paper group 聚合，并生成 quote citation anchors。

核心代码：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L661-L704>

retrieval 层：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/services/retrievalService.ts#L81-L178>

所以 `targeted` 不是正则找 `Abstract` 到 `Introduction`，而是“问题驱动检索”。`sections` 在这里更像检索 hint，会拼进 question，而不是可靠的 section parser。

**3. `visual`：用于“需要看 PDF 页面图像/版面/图表”**

典型问题：

```text
解释 Figure 3
这个表格说明了什么？
看一下第 5 页的图
这个公式推导在页面上是怎么呈现的？
```

调用形态可能是：

```json
paper_read({
  "mode": "visual",
  "query": "Figure 3 ablation results"
})
```

或：

```json
paper_read({
  "mode": "visual",
  "pages": "p5"
})
```

它的执行路径是：

1. `paper_read` 发现 mode 是 `visual`，直接转给 `view_pdf_pages`。
2. 如果传了 `pages`，渲染指定页。
3. 如果只传了 `query/question`，先用 `pdfPageService.searchPages()` 找相关页，再渲染。
4. 输出的是页面图像 artifact，给模型做视觉分析。

代码入口：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/paperRead.ts#L565-L610>

`view_pdf_pages` 逻辑：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/viewPdfPages.ts#L35-L104>
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/viewPdfPages.ts#L334-L360>

`visual` 的定位是：文本检索不够时，读页面图像。比如 figure、table、layout、公式、图中文字，不能只依赖 PDF text layer。

**4. `capture`：用于“读取当前 Zotero Reader 正在看的页面”**

典型问题：

```text
解释我现在看到的这一页
帮我看当前页面的图
这个页面上的公式是什么意思？
```

调用形态大概是：

```json
paper_read({
  "mode": "capture"
})
```

或带邻近页：

```json
paper_read({
  "mode": "capture",
  "neighborPages": 1
})
```

它和 `visual` 的区别是：

```text
visual = 通过 query/pages 找并渲染页面
capture = 直接截取当前 reader 可见页
```

执行路径：

1. `paper_read` 发现 mode 是 `capture`，转给 `view_pdf_pages`。
2. `view_pdf_pages` 设置 `capture: true`。
3. `pdfPageService.captureActiveView()` 找当前 Zotero Reader、当前页、页面文本和页面截图。
4. 后续 follow-up message 会要求模型只根据当前页文本和图像回答。

相关代码：
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/viewPdfPages.ts#L156-L192>
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/viewPdfPages.ts#L304-L331>
<https://github.com/yilewang/llm-for-zotero/blob/27c25386dcd2bc132a0d909e71064fb147e6e199/src/agent/tools/read/pdfToolUtils.ts#L300-L340>

**简化决策表**

```text
用户问“这篇论文讲什么？”             -> overview
用户问“方法/实验/某个 claim 在哪？”    -> targeted
用户问“Figure/Table/公式/页面布局”      -> visual
用户问“我当前看到的页面”               -> capture
用户明确说“第 3-5 页”                  -> targeted + pages 或 visual + pages
```

对本项目的启发是：`paper_read` 不应该设计成 `read_section("Abstract")` 这种脆弱接口，而应该设计成语义入口：

```text
overview: 先理解
targeted: 按问题检索证据
page: 按页读文本
visual/capture: 看页面图像
```

初版可以先做 `overview + targeted + pages text`，暂缓 `visual/capture`，因为后两者需要 PDF page render、artifact 传递和 UI 预览，工程量明显更大。
