**结论**

`ZoteroContextGateway` 值得实现，而且应作为 Step 4/5 的基础设施先落地。它的必要性不在于“多一个抽象层”，而在于把 Zotero 侧的不稳定上下文读取统一收口：reader 当前 item、parent item、PDF attachment、metadata、全文文本、reader selection、scope 都不应该散落在 sidebar、CodexBridge 或 MCP tools 里。

当前代码中 [src/modules/sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:413) 直接把用户输入传给 `CodexBridge.sendPrompt()`；[src/modules/sidebar/selectedItem.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/selectedItem.ts:1) 只负责标题展示。这说明 Step 4/5 需要一个新的 Zotero 读取边界，而不是继续扩写 sidebar。

当前阶段的产品范围只覆盖 PDF reader 场景：用户已经在 Zotero PDF reader 中打开了一篇文献，然后在该 reader 上下文里使用 zotero-copilot 提问。暂不读取 Zotero 主窗口文献列表中的 selected regular item 或 selected PDF attachment。主窗口入口只作为未来 library 级别文献 QA / 全库对话的预留入口，不纳入 Step 4/5 验收。

**是否值得**

值得，但要控制职责。

`ZoteroContextGateway` 应该做：

- 识别 active paper scope：只基于 PDF reader 当前打开的 reader item。
- 从 reader 对应的 PDF attachment 回溯 parent regular item。
- 读取 metadata：title、creators、year、DOI、abstract、itemID、libraryID、key。
- 确认当前 reader 的 PDF attachment：attachmentID、path、content type、是否可读。
- 读取 Zotero full-text：优先 `attachment.attachmentText`，并返回 indexed/empty/partial 等状态。
- 读取 reader selection：第一版可以先做 best-effort，失败不影响 metadata 问答。
- 给 Step 5 MCP tools 复用同一套 scope 和读取逻辑。

不应该做：

- 不负责启动 Codex app-server。
- 不负责拼接最终 prompt。
- 不负责 MCP JSON-RPC dispatch。
- 不负责 LLM 回答策略。
- 不做复杂 section parser；section/page 读取应在 retrieval/tool 层做，并带 warning。

**预计实现**

建议第一步实现为：

```text
src/zotero/contextGateway.ts
src/zotero/types.ts 或 src/shared/types.ts
```

核心接口可以先保持小而稳定：

```ts
class ZoteroContextGateway {
  constructor(private win: Window) {}

  getActivePaper(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<PaperScope | null>;
  getPaperMetadata(scope: PaperScope): Promise<PaperMetadata>;
  getPrimaryPdfAttachment(scope: PaperScope): Promise<PdfAttachment | null>;
  getAttachmentText(scope: PaperScope): Promise<PaperTextResult>;
  getSelectedText(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<SelectedTextResult>;
  getPromptContext(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<PaperPromptContext>;
}
```

第一版 Step 4 可以直接用：

```text
Sidebar submit
  -> ZoteroContextGateway.getPromptContext()
  -> promptBuilder.buildPaperQuestionPrompt()
  -> CodexBridge.sendPrompt()
```

Step 5 再复用：

```text
MCP tool paper_search / paper_read
  -> ZoteroContextGateway.getActivePaper()
  -> getAttachmentText()
  -> chunk/search/read
```

这样 Step 4 的显式 prompt 注入和 Step 5 的 MCP-first 都不会重复实现 Zotero 读取逻辑。

**目标功能**

第一阶段目标应是“当前论文上下文可用”，不是完整 agent platform：

- sidebar 能识别当前 PDF reader 中打开的论文。
- 有 abstract/metadata 时，用户问“这篇论文主要贡献是什么”能明显围绕当前 paper 回答。
- 有 PDF full-text 时，能提供 preview 或给 `paper_search` 做数据源。
- 没有 PDF、没有摘要、没有选中文本时，返回结构化 warning，而不是抛异常。
- 后续 MCP tools 可以直接调用 gateway，不需要自己理解 Zotero item/attachment 关系。

**验收标准**

建议分两层验收。

Step 4 gateway + prompt 验收：

- 在 PDF reader 中打开 PDF 时，能从 `reader.itemID` 找到当前 PDF attachment。
- 能从当前 PDF attachment 回溯到 parent regular item，并拿到 title/authors/year/abstract。
- Zotero 主窗口文献列表中的 selected regular item / selected PDF attachment 不属于当前阶段验收。
- 无 PDF 时不报错，仍可基于 metadata/abstract 构造 prompt。
- PDF 有全文索引时能读取 text preview 或 text status。
- sidebar 只显示用户问题和最终回答，不显示 raw prompt。
- `npm run build`、`npm run lint:check`、`npm test` 通过。

Step 5 MCP 复用验收：

- `get_active_paper` 返回 gateway 生成的同一份 scope。
- `get_paper_metadata`、`read_selected_text`、`paper_search`、`paper_read` 不重复写 Zotero item 查找逻辑。
- tool 返回值带 `source`、`locator`、`confidence`、`warnings`。
- 多附件、无文本层、未索引、扫描 PDF、无 active PDF reader 都有可读错误。
- MCP scope 限制当前 reader paper，不允许工具任意读整个 library 或本地文件系统。

我的建议是：先实现一个薄但类型清楚的 `ZoteroContextGateway`，再接 `promptBuilder` 完成 Step 4；等它稳定后，Step 5 的 MCP tools 直接复用它。不要先做完整 MCP server，否则读取边界和协议边界会混在一起，调试成本会明显变高。
