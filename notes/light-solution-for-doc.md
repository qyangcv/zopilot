# Light 论文处理管道方案

本文档描述 Zopilot 的单阶段轻量级论文处理方案，只关注技术选型、组件搭配和整体流程，不涉及实现代码。

## 目标与边界

当前 `paper_read` 依赖 Zotero attachment full text，再做简单切分和词法打分。它能验证 tool 形态，但不能作为长期论文阅读 source：Zotero full text 更像搜索索引，不稳定保留章节、页码、表格、图片和公式结构。

本方案目标：

- 将 PDF 快速转换为可持久化的 Markdown/TXT/JSON。
- 抽取或渲染图片资产，并能把图片路径返回给 Codex。
- 支持基本表格抽取，格式能让 AI 读懂即可。
- 支持 `Table 1`、`Figure 2`、公式编号、页面和章节类问题。
- 本地运行，保持轻依赖。

明确不做：

- 不把 Zotero full text 当作主 source。
- 不做 OCR、图片理解、embedding、语义检索、向量数据库、本地 reranker。
- 不引入 SQLite FTS5、Docling 或长期运行的 sidecar service。

## 固定技术选型

- PDF 解析：`PyMuPDF4LLM`
- PDF 页面渲染和局部截图：`PyMuPDF`
- 本地存储：Zopilot cache 目录中的 Markdown、JSONL、assets、manifest
- Chunking：Markdown section-aware chunker
- Artifact registry：自定义图、表、公式、页面资产索引
- Retrieval：`FlexSearch`
- 结果融合：RRF
- 去重与覆盖控制：MMR
- 最终理解与回答：Codex

## 整体流程

```text
Zotero PDF attachment
  -> resolve PDF path and metadata
  -> parse with PyMuPDF4LLM
  -> persist Markdown / text / page chunks / image assets
  -> build chunks and artifact registry
  -> build FlexSearch index
  -> route query
  -> retrieve multiple result sets
  -> RRF + structural boost + MMR
  -> pack context
  -> Codex answers
```

Zopilot 负责材料化、定位、检索和证据打包。Codex 负责文本理解、图片理解、推理和最终回答。

## 组件职责

### 1. Source Resolver

从当前 Zotero reader 绑定的 attachment 出发，确认 PDF 文件路径，读取 parent item metadata，并记录 attachment key、library ID、mtime、PDF hash。Zotero full text 只作为 fallback，不进入主解析链路。

### 2. PDF Parser

主工具是 `PyMuPDF4LLM`，用于输出 Markdown、TXT、JSON/page chunks、基础表格和图片引用。配置上关闭 OCR，开启图片写出，将图片或图形区域保存到本地 assets 目录。

`PyMuPDF` 负责补充页面级能力：整页 PNG 渲染、bbox crop、按页或按区域返回图片文件。复杂图片和公式不在插件内理解，只保证 Codex 能拿到对应图片和上下文。

解析目标不是完美还原 PDF，而是稳定产出可读 Markdown、页级结构、基本表格、caption、周边文本和图片路径。

### 3. Material Cache

PDF 解析结果必须持久化，避免每次问答重复解析。建议产物：

- `paper.md`：整篇 Markdown。
- `paper.txt`：纯文本 fallback。
- `pages.jsonl`：逐页文本、页码、layout boxes、图片和表格信息。
- `chunks.jsonl`：检索单元。
- `artifacts.json`：图、表、公式、页面图片索引。
- `assets/`：图片、页面渲染和局部 crop。
- `manifest.json`：来源、版本、hash 和构建状态。

`manifest.json` 记录 Zotero attachment identity、PDF hash、parser/version、schema version、页数、构建时间和失败状态。PDF hash、parser version、schema version 变化或用户手动 reindex 时重建。

### 4. Chunking

采用 Markdown section-aware chunking，不直接按固定字符数切全文。先按 heading 建 section tree，section 过长时按段落继续切。每个 chunk 保留 section path、page span、Markdown span、kind 和关联 artifact IDs。

title、abstract、caption、table 是高价值 chunk。References 默认降权，除非 query 明确询问引用、相关工作或参考文献。chunk 目标约 500-1200 tokens，overlap 保持较小，避免重复检索结果挤占上下文。

### 5. Artifact Registry

Artifact registry 处理 `Table 1`、`Figure 2`、公式编号和页面图片问题。索引对象包括 figure、table、equation、page image、caption 和 optional crop。

每个 artifact 记录 artifact ID、类型、label、页码、bbox、caption、image path、surrounding chunk IDs 和 confidence/source note。

典型路径：

```text
用户问 Figure 2
  -> query router 识别 figure locator
  -> artifact registry 找 Figure 2
  -> 返回 caption、附近正文、图片路径和页码
  -> Codex 读取图片并解释
```

### 6. Retrieval: FlexSearch

Retrieval 固定使用 `FlexSearch`。选择理由是 JS 生态友好、速度快、零依赖、适合 Zotero 插件环境，并且能对单篇或少量论文的本地 chunks 做快速内存检索。

FlexSearch index 建议覆盖字段：`text`、`title`、`sectionPath`、`caption`、`kind`、`page`、`artifactLabel`。

检索拆成多路，而不是只搜正文：

- 正文 search。
- section/title search。
- caption search。
- artifact label search。
- metadata search。

这些结果统一交给 RRF 合并。

### 7. Query Router

Query router 用规则判断用户意图，再选择检索路径。主要类型包括 summary、method/contribution、experiment/result、table locator、figure locator、equation locator、page locator、selected text explanation、metadata/citation。

初版规则即可覆盖高频场景：`Table 1`、`Tab. 1`、`表 1`、`Figure 2`、`Fig. 2`、`图 2`、`Equation 3`、`Eq. 3`、`Formula 1.1`、`公式 1.1`、`page 5`、`第 5 页`、`abstract`、`method`、`experiment`、`conclusion`。

### 8. RRF / MMR / Structural Boost

RRF 合并多路 FlexSearch 结果，避免比较不同字段和不同检索路径的原始分数。

Structural boost 提升 title、abstract、section heading、caption、table/figure artifact 精确命中，以及 query 指向的 page 或 section。

MMR 控制重复和覆盖，避免 top results 全部来自同一页或相邻 chunk。在总结、比较、实验分析类问题中，MMR 比单纯取 top-k 更稳。

不引入本地模型 reranker。最终少量候选的语义选择交给 Codex。

### 9. Context Packing

Context packer 不简单拼接 top chunks，而是按证据类型组织。优先级为 exact artifact match、caption/table markdown、surrounding paragraphs、section heading/path、page/source locator、image path、fallback text chunks。

返回给 Codex 的上下文应包含证据类型、页码、section path、图片路径、匹配原因和解析不确定性 warning。Context packer 还要控制最大字符数、最大 chunk 数、最大 artifact 数、同页重复数量，以及是否包含 References。

## 最终边界

这是一条单阶段、轻依赖的 PDF-to-context 管道：`PyMuPDF4LLM + PyMuPDF` 负责材料化，`FlexSearch` 负责轻量 lexical retrieval，RRF/MMR/结构权重负责提高召回稳定性和上下文覆盖，Codex 负责最终理解与回答。
