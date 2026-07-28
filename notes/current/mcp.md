## 支持更多 MCP 工具

- [x] 将单一 `paper_read` 拆为职责互斥的论文阅读工具：
  - `get_outline`：返回完整层级大纲、整篇论文 locator 和章节 locator。
  - `search`：在位置未知时检索论文，只返回短 preview 和 locator。
  - `read`：读取 `get_outline` 或 `search` 返回的 locator，不执行检索。
  - `view_page`：返回一个指定 PDF 物理页的 PNG，不返回解析文本。
- [x] 使用紧凑、自包含的 opaque locator 串联工具，格式分别为
      `doc.<source>.<revision>`、`section.<source>.<revision>.<ordinal>` 和
      `chunk.<source>.<revision>.<ordinal>`。revision 是由内部材料坐标版本与
      PDF hash 生成的 96-bit token；结构化工具输出不再额外暴露完整 PDF hash。
      `read` 不接受自然语言问题，也不允许模型自行构造 locator。
- [x] PDF helper 0.3.0 使用固定版本的 PyMuPDF4LLM Layout 生成按阅读顺序排列的
      `blocks.jsonl` 和 `outline.json`。大纲优先使用 PDF embedded Outline，
      没有时使用 layout 识别出的 section header；不再维护标题白名单、字体阈值
      或虚构 confidence。
- [x] `search` 的检索 chunk 保存原始 block 引用，`read` 根据 locator 回到
      Document IR 读取原文，不直接把 RAG chunk 当作论文原文。
- [x] `get_outline`、`search`、`read` 以符合 output schema 的
      `structuredContent` 作为唯一模型输出；协议容器中的 `content` 为空数组，
      不维护重复文本 projection。Codex 与 BYOK 均选择 structured result，
      长 `read` 在完整 block 边界分页。
- [x] `view_page` 是明确的多模态例外：不声明结构化 output schema，PNG 和简短
      来源说明通过 `content` 传给模型，非模型元数据写入 MCP `_meta`，避免
      structured result 遮蔽图片。
- [x] Tool Trace 只显示当前 backend 实际采用的结果；没有结构化结果时，文本
      摘要仍明确标识截断。
- [x] Codex 与 BYOK 继续使用同一个 Zopilot MCP HTTP server 和同一组工具定义。
      模型指令遵循 `get_outline/search -> read`，需要视觉证据时使用
      `view_page`。
- [ ] 构建并发布 PDF helper 0.3.0 的 macOS arm64、macOS x64 和 Windows x64
      运行时归档与 manifest。
- [ ] 接入三方 MCP: web search, github, arxiv, google scholar 等，用于扩充 zopilot 能力：获取论文源代码、查询引用数量、查找基线工作/后续工作
