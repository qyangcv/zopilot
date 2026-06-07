**结论**

基于 commit `db260ee05df16abdf48d750a0de3cd9ee9f31217`，`ZoteroContextGateway` 已完成 Step 4 所需的 reader-only 论文上下文读取，并已经接入 sidebar 提交流程。它基本满足原设计目的：把 Zotero reader、PDF attachment、parent item metadata、全文索引状态、reader selection 和 warning 统一收口，避免这些不稳定 Zotero API 调用散落到 sidebar 或 Codex bridge 中。

当前实现还没有完成 Step 5 MCP tools。`ZoteroContextGateway.getAttachmentFullTextForTool()` 已为后续 `paper_search` / `paper_read` 预留完整全文读取路径，但本 commit 没有实现 MCP endpoint、tool schema、scope token、tool call dispatch 或 Codex thread MCP config 注入。

当前阶段的产品范围仍只覆盖 PDF reader 场景：用户已经在 Zotero PDF reader 中打开了一篇文献，然后在该 reader 上下文里使用 zotero-copilot 提问。暂不读取 Zotero 主窗口文献列表中的 selected regular item 或 selected PDF attachment。主窗口入口只作为未来 library 级别文献 QA / 全库对话的预留入口，不纳入 Step 4/5 当前验收。

**实现核查**

已落地文件：

- `src/zotero/contextGateway.ts`：reader scope、metadata、PDF attachment、全文状态/全文读取、reader selection、prompt context 聚合。
- `src/zotero/types.ts`：`PaperScope`、`PaperMetadata`、`PdfAttachment`、`PaperTextResult`、`SelectedTextResult`、`PaperPromptContext`。
- `src/codex/promptBuilder.ts`：把 gateway 返回的结构化上下文组织成 Codex prompt。
- `src/modules/sidebar/index.ts`：在 submit 时调用 `contextGateway.getPromptContext()`，再调用 `buildPaperQuestionPrompt()`，最后把增强后的 prompt 发送给 `CodexBridge.sendPrompt()`。

当前调用链是：

```text
Sidebar submit
  -> ZoteroContextGateway.getPromptContext(activeReader)
  -> buildPaperQuestionPrompt(userQuestion, promptContext)
  -> CodexBridge.sendPrompt(prompt)
```

这说明 Step 4 的核心链路已经从“直接发送用户输入”升级为“发送带当前 Zotero paper context 的 prompt”。

**逐项验收**

`识别 active paper scope`：已满足。

- `getActivePaper(reader?)` 只从 PDF reader 当前 `itemID` 出发。
- scope 明确标记 `source: "reader"`，包含 `readerItemID`、`attachmentItemID`、`attachmentKey`、`parentItemID`、`libraryID`、`readerType`。
- 没有从主窗口 selection 反向猜论文，符合 reader-only 范围。

`从 PDF attachment 回溯 parent regular item`：已满足。

- `getActivePaper()` 读取 `attachment.parentItem`。
- 没有 regular parent 时返回 warning，而不是抛错。
- `getMetadataItem()` 优先使用 parent item，无法取得 parent 时退回 attachment 本身，保证降级可用。

`读取 metadata`：已满足。

- `getPaperMetadata()` 读取 title、creators、date/year、DOI、abstract、itemID、libraryID、key、itemType。
- 读取前 best-effort 调用 `loadAllData()`，失败进入 warning。
- creator 读取优先 `getCreatorsJSON()`，无结果时 fallback 到 `firstCreator`。

`确认当前 PDF attachment`：已满足。

- `getPrimaryPdfAttachment()` 返回 attachment id、library id、key、title、content type、path、isPdf、exists、readable、warnings。
- path 优先 `getFilePathAsync()`，再 fallback 到 `getFilePath()`。
- 非 PDF、无本地路径、文件不存在都进入 warning。

`读取 Zotero full-text`：部分满足，且实现上做了职责拆分。

- 为后续 tool/retrieval 提供了 `getAttachmentFullTextForTool()`，会读取完整 `attachment.attachmentText`，返回 `text`、`preview`、`length`、`indexedState`、`status`。
- Prompt 路径使用 `getAttachmentTextStatusForPrompt()`，只读取全文索引状态，不把全文 preview 塞进普通 prompt。
- 这与早期“prompt 中可放 text preview”的设想不同，但更符合后续 MCP-first 方向：普通 prompt 轻量化，完整全文留给 `paper_search` / `paper_read`。

`读取 reader selection`：已满足第一版 best-effort。

- `getSelectedText(reader?)` 依次尝试 `activeReader._iframeWindow`、`activeReader._window`、当前 Zotero window 的 selection。
- 选中文本会被 normalize 并限制在 `8000` 字符。
- 无 selection 或读取失败都会返回结构化状态和 warning。

`结构化 warning，不抛异常`：已满足。

- 无 active reader、非 attachment、非 PDF、无 parent item、无本地 PDF、全文 API 不可用、selection 不可用等场景都有 warning。
- `getPromptContext()` 汇总 scope、metadata、attachment、text、selection 的 warning，并去重。

`给 Step 5 MCP tools 复用同一套读取逻辑`：基础已满足，MCP 未实现。

- Gateway 已有 `getActivePaper()`、`getPaperMetadata()`、`getSelectedText()`、`getAttachmentFullTextForTool()` 这些可复用入口。
- 但还没有 `src/mcp/`、tool schema、scope token、timeout 或 Codex MCP config 注入。

**与原设计的偏差**

- 原接口草案里的 `getAttachmentText()` 没有按同名实现；当前拆成 `getAttachmentTextStatusForPrompt()` 和 `getAttachmentFullTextForTool()`。这是合理拆分：避免 Step 4 每次提交都读取并注入大段全文，同时保留 Step 5 retrieval 的完整全文能力。
- `promptBuilder` 当前仍会注入 metadata、abstract、selection、attachment 状态和 warning；它不是 Step 5 目标中的 minimal router。等 MCP tools 落地后，`promptBuilder` 应再收薄，只保留 scope、工具使用提示和用户问题。
- `promptBuilder` 目前会渲染 `PDF full-text preview` 字段，但 prompt 路径不填 preview，所以通常显示 `(none)`。建议后续改成 `Full-text preview: omitted for prompt; use paper_search/paper_read when available` 或在无 preview 时不输出该段。

**代码规范性**

整体代码边界清楚，符合当前阶段：

- Zotero API 访问集中在 `src/zotero/contextGateway.ts`。
- prompt 拼接独立在 `src/codex/promptBuilder.ts`。
- sidebar 只负责编排，不直接理解 Zotero item/attachment 关系。
- 类型定义集中在 `src/zotero/types.ts`，比把 `PaperContext` 混进 sidebar 更利于扩展。
- 失败路径采用结构化 `warnings`，比 UI 层 try/catch 拼字符串更稳。

需要注意的规范性问题：

- `getCurrentReader()` fallback 读取 `Zotero.Reader._readers`，这是私有字段，只适合作为 best-effort fallback；正式依赖仍应优先 `Zotero.Reader.getByTabID()`。
- `PromptDebugWindow.__zcpLastPrompt` / `__zcpLastPromptContext` 是调试入口，适合开发期保留；后续发布前应考虑挂到 diagnostics 或受 pref 控制。
- `PaperTextResult.text` 在 tool 路径可能承载完整全文，后续 MCP 返回时不能直接无界输出给模型，需要 chunk、limit、provenance 和 timeout。

**可扩展性判断**

当前实现为 Step 5 打好了合理基础，但还不是 MCP-first 架构：

- 好的部分：scope、metadata、selection、attachment、full-text 已经形成稳定读取边界；MCP tools 可以复用，不需要重写 Zotero item 查找。
- 未完成部分：缺少 `paper_search` 的 chunk/retrieval、`paper_read` 的 locator/section/page 语义、MCP auth/scope、tool result provenance。
- 下一步建议先实现 read-only MCP：`get_active_paper`、`get_paper_metadata`、`read_selected_text`、`paper_search`，再做复杂 `paper_read(section/pageRange)`。

一句话：commit `db260ee` 已经完成 Step 4 的“当前论文上下文可用”，并以可复用方式铺好了 Step 5 的 gateway 基础；但 Step 5 MCP tools 仍是下一阶段工作。
