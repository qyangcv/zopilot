# 论文处理技术方案

本文档描述 v0.3.0 的论文解析、索引、检索和上下文组织方案。

## 目标

- 用稳定的本地文档处理流程替代当前 `paper_read` 的临时全文切分和词法打分。
- Zopilot 负责解析、Material 生成、Retrival 构建、检索、重排和 Context 组织。
- Agent 只通过 tool 读取 Context，不直接处理 PDF 路径和底层索引。
- 方案优先支持本地离线运行，并为未来替换 parser、embedding、vector store、reranker 保留接口。

## 总体链路

`Zotero PDF -> Source -> Docling -> Material -> structured chunks -> Retrival -> retrieve/rerank -> Context -> Agent`

## 核心依赖

- PDF 文档解析：Docling。
- 图片提取：Docling。
- Embedding 模型：`nomic-embed-text-v1.5` GGUF F16，约 262 MiB / 274 MB。
- Embedding runtime：`llama.cpp` 原生 CPU/Metal 二进制，不默认引入 GPU runtime。
- 稀疏检索：Tantivy。
- 向量存储：sqlite-vec。
- Rerank：RRF + MMR + 结构权重。
- OCR：v0.3.0 不引入 OCR 模型；扫描 PDF 先标记为能力不足，不做重型 OCR 兜底。

## Source -> Material

- Source 表示 Zotero 中的原始资料资产，如 PDF attachment。
- Source 只保存来源身份、Zotero item/attachment 信息、文件 hash、mtime 和派生状态。
- Material 是 Source 经 Docling 处理后的稳定内部文档表示。
- Material 保存正文、阅读顺序、页码范围、章节层级、段落、列表、表格、公式、图片引用和 locator。
- Material 不绑定检索算法，也不保存向量或 Tantivy 内部结构。
- Material 必须带 `schemaVersion`、`parser`、`parserVersion`、`sourceHash`，方便重建和迁移。

## Chunking

- 采用“固定生成可复现的结构化 chunk，查询时动态扩展”。
- 索引时以 Docling block 为基础，优先按 section、paragraph、table、figure caption 组织。
- chunk 目标长度约 350-800 tokens，最大约 1000-1200 tokens。
- overlap 控制在约 50-120 tokens，或通过相邻 block 引用实现。
- table、figure caption、abstract、title、section heading 作为可加权结构单元。
- chunk 记录 `chunkId`、`materialId`、`sourceId`、`nodeIds`、`pageSpan`、`sectionPath`、`text`、`kind`。
- 查询命中后可动态补充相邻 chunk、上级 section heading、图表 caption 和页码信息。

## Material -> Retrival

- Retrival 表示围绕 Material 建立的可替换检索资产和查询能力。
- Tantivy 保存稀疏索引，字段包括 text、title、section、caption、kind、page、sourceId、materialId。
- sqlite-vec 保存 dense embedding，向量来自 `nomic-embed-text-v1.5`。
- 文档 embedding 使用 `search_document:` 前缀，查询 embedding 使用 `search_query:` 前缀。
- Retrival 内部可包含 chunk 表、向量表、Tantivy index、index metadata 和构建任务状态。
- 对外只暴露稳定查询接口，不暴露 Tantivy schema 或 sqlite-vec 表结构。

## 查询与重排

- Context Builder 接收 workspace、用户问题和 `@` 选择的 sources。
- Retrival 在限定 material 集合内并行执行 Tantivy 稀疏检索和 sqlite-vec 向量检索。
- 用 RRF 合并稀疏结果和向量结果。
- 用 MMR 控制重复片段，避免返回大量相邻或语义重复 chunk。
- 结构权重用于提升 abstract、title、section heading、caption、table、query 命中标题等结果。
- 最终输出 Context，包含文本片段、source 信息、locator、pageSpan、sectionPath、score 和 chunk provenance。

## 图片与图表

- Docling 提取图片和图表引用，Material 保存图片 asset 引用和定位信息。
- v0.3.0 不默认把所有图片注入 agent 上下文。
- 先索引 caption、figure/table 周边文本和 locator；只有查询需要时再返回图片引用或提取图片。
- 图片缓存必须受 sourceHash 和派生数据清理策略控制。

## 生命周期

- Source、Material、Retrival 跨 workspace 共享。
- Workspace 只决定会话归属、默认资料范围和可选择的 source universe。
- 当 sourceHash、parserVersion、schemaVersion、embeddingModel 或 retrivalVersion 变化时，相关派生数据需要重建。
- 索引任务需要支持后台执行、进度、取消、失败状态、重试和重建。
- 初版按需索引当前使用的资料，不默认扫描整个 library。

## 存储边界

- 论文处理产物按 Source、Material、Retrival 管理，不能和会话历史文件混放。
- 用户视角可以按 Zotero item 展示解析和索引状态；底层存储按可复用资料资产组织。
- 删除会话不应删除 Material 或 Retrival；重建索引也不应影响会话历史。

## 分发原则

- Zotero 插件保持薄层，重型依赖放在本地 sidecar engine 或按需下载的 runtime 中。
- 默认分发 CPU/Metal `llama.cpp`，单平台压缩体积约 10-17 MiB；不默认分发 CUDA/ROCm/OpenVINO。
- 模型和解析依赖应有独立缓存目录、版本记录和清理入口。
- Docling、`llama.cpp`、Tantivy、sqlite-vec 和模型文件由 Zopilot 管理，不能安装到系统全局环境，也不直接塞进 Zotero 插件 JS 环境。
- Tool、Workspace、Source、Material、Retrival、Context 必须保持解耦，便于以后替换算法和模型。

## 安装策略

- 开发阶段采用手动安装，不在 `pnpm install` 或插件启动时自动下载重型依赖。
- 提供安装说明或脚本入口，由开发者自行处理网络、平台、版本和缓存目录问题。
- 开发环境应能通过配置项指定 engine、模型和缓存路径，便于复用已有本地安装。
- 用户真实使用阶段后续在 preference tab 提供带进度条的一键安装按钮。
- 用户安装按钮负责检测缺失组件、下载、校验、显示进度、支持取消和重试。
