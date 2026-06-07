# Zotero Copilot 实现笔记

## Step 1 插件骨架

- 插件入口仍是 `src/index.ts`，全局实例名来自 `package.json` 的 `config.addonInstance`：`ZoteroCopilot`。
- 生命周期集中在 `src/hooks.ts`：`onStartup` 等待 `Zotero.initializationPromise`、`Zotero.unlockPromise`、`Zotero.uiReadyPromise`，然后初始化 locale、注册偏好页，并对已有主窗口执行 `onMainWindowLoad`。
- `addon.data.initialized = true` 是 scaffold startup test 判断插件加载完成的标记，不要删除。
- 当前已移除模板示例 UI：没有右键菜单、额外列、快捷键、item pane section、reader section、红色样式或示例弹窗。
- 当前 `hooks.ts` 的真实生命周期入口是 `onStartup`、`onShutdown`、`onMainWindowLoad`、`onMainWindowUnload`。`onNotify`、`onPrefsEvent`、`onShortcuts`、`onDialogEvents` 属于模板预留扩展 hook，当前只保留日志占位，不承载业务逻辑。
- `src/modules/examples.ts` 已删除。后续如果需要 Zotero UI 功能，应新建模块实现，不要恢复模板示例。
- 偏好页注册在 `src/modules/preferenceScript.ts`，当前把 `addon/content/preferences.xhtml` 挂到 Zotero Preferences。
- `addon/content/preferences.xhtml` 当前显示插件状态/build 信息，并暴露 Codex CLI path 与 request timeout 设置。
- 插件默认 pref 包括 `enabled`、`codex.path`、`codex.timeoutMs`、`sidebar.width`，定义在 `addon/prefs.js`，生成类型见 `typings/prefs.d.ts`。
- Zotero 兼容范围在 `addon/manifest.json`：`strict_min_version` 为 `9.0`，`strict_max_version` 为 `9.0.*`，对应当前 Zotero 9.0.4 开发验证范围。
- `package.json` 的 repository、bugs、homepage、author 已从 `zotero-plugin-template` 改为当前 `qyangcv/zotero-copilot` 项目信息；`zotero-plugin.config.ts` 会把这些字段写入 build define/manifest。
- 验证过的基础命令：`npm run build`、`npm start`、`npm test`。其中 `npm test` 的 startup test 会确认 `Zotero.ZoteroCopilot.data.initialized` 可用。

## Step 2 准备

- Sidebar 图标资源：`addon/content/icons/message-circle.svg`。
- 运行时 chrome URL：`chrome://zotero-copilot/content/icons/message-circle.svg`。
- 当前同一个 SVG 会用于 sidebar toggle、偏好页图标、ProgressWindow 默认图标，以及 `manifest.json` 的 icon entries。
- Sidebar 图标不需要准备多个尺寸。当前资源是 SVG，可按按钮尺寸缩放；后续实现 sidebar 按钮时直接引用这个 `24x24` 图标即可。
- `manifest.json` 里的 `48`/`96` 是插件管理器或发布元信息用的 icon entries，不是 sidebar 按钮的尺寸要求。当前先用同一个 SVG 填这两个 entry；如果后续需要更稳妥的发布包外观，再从 SVG 生成 `48x48` 和 `96x96` PNG。
- 图标来源：Tabler Icons 的 `message-circle`。
- 授权处理：已记录在 `THIRD_PARTY_NOTICES.md`；下载的 SVG 文件本身没有内嵌 license 注释。

## Step 2 实现

- `src/modules/sidebar/` 负责 Zotero Copilot sidebar，当前拆分如下：
  - `index.ts`：窗口级 controller，只负责注册、挂载、打开/关闭、输入提交和上下文刷新编排。
  - `constants.ts`：DOM id、chrome stylesheet/icon URL、HTML namespace。
  - `readerToolbar.ts`：创建 PDF reader toolbar button，并给 reader document 注入共享 chrome stylesheet。
  - `selectedItem.ts`：读取当前 Zotero selection 或 reader attachment parent 的标题。
  - `markdown.ts`：Step-2 原型用的最小 Markdown/公式占位 renderer。
- Step 4/5 设计范围已收窄为 PDF reader 内的单篇论文 QA。`selectedItem.ts` 里的主窗口 selection 标题读取只是当前 UI chip 的展示能力，不作为 `ZoteroContextGateway` 的上下文来源；主窗口 zotero-copilot 入口预留给未来 library 级别文献 QA / 全库对话。
- 2026-06-07 调整：放弃 `Zotero.ItemPaneManager.registerSection()` / item-pane sidenav 方案，因为它无法可靠隔离 item details 的纵向 section scroll。当前入口是主界面 `#zotero-items-toolbar` 和 PDF reader `renderToolbar` 注入按钮；点击后打开挂在 Zotero 主布局里的独立右侧 Copilot pane，和 Zotero 内置 item pane sections 使用不同 DOM 容器。
- UI 采用 VS Code Copilot Chat sidebar 的几个可迁移原则：一个高价值侧栏、紧凑标题与消息密度、输入区承载上下文 chip、模型和推理强度状态、textarea 按内容自动增高且有最大高度。
- Step 2 的固定 assistant 占位回复已被 Step 3 的真实 Codex 请求路径替换；`placeholder.ts` 和对应 locale key 已删除。
- 内置最小 Markdown renderer 位于 `src/modules/sidebar/markdown.ts`，覆盖 Step-2 原型需要的段落、列表、链接、表格、代码块、行内公式和行间公式占位；后续接模型后可替换为正式 renderer。
- 文案放在 `addon/locale/*/addon.ftl`，因为 `getString()` 当前初始化的是 addon 级 FTL。
- 样式集中在 `addon/content/zoteroPane.css`。主窗口通过 XML stylesheet processing instruction 注入；PDF reader document 通过 `<link rel="stylesheet">` 注入同一个 chrome stylesheet，避免 TypeScript 内联一份 reader toolbar CSS。
- `src/hooks.ts` 在主窗口加载时注册 sidebar，在窗口卸载和插件 shutdown 时清理；sidebar 注册异常会被记录但不会阻断插件 startup test。
- 验证命令：`npm run build`、`npx eslint src/modules/sidebar/index.ts src/hooks.ts src/utils/locale.ts`、`npm test`。`npm test` 已通过 startup 用例，但 scaffold 测试进程在报告完成后不会自动退出，本次已手动清理 `.scaffold/test` 进程。

## Step 3 Codex app-server bridge

- Step 3 的目标是接通本机 Codex runtime，不读取 Zotero 论文内容，也不实现 MCP。
- `src/codex/binaryPath.ts` 负责解析 Codex CLI：
  - 优先使用 `codex.path` 偏好值。
  - 未配置时依次尝试 PATH、`~/.local/bin/codex`、`/opt/homebrew/bin/codex`、`/usr/local/bin/codex`。
  - 找不到时提示用户把 `command -v codex` 的完整路径写入 `codex.path`。
- `src/codex/types.ts` 定义 JSON-RPC message、prompt result/options、bridge status、Codex account 结果，以及 Zotero/Mozilla `Subprocess` 的最小边界类型。
- `src/codex/bridge.ts` 是唯一的 Codex runtime adapter：
  - `start()` 启动 `codex app-server --stdio`，使用 line-delimited JSON-RPC 调用 `initialize`，随后发送 `initialized` notification。
  - `ensureThread()` 为当前 bridge 创建一个 ephemeral thread，默认 cwd 为用户 HOME。
  - `sendPrompt()` 通过 `promptQueue` 串行执行 turn，避免多个输入同时写入同一个 `activeTurn`。
  - `runPrompt()` 调用 `turn/start`，监听 `item/agentMessage/delta` 更新流式文本，并在 `turn/completed` 后 resolve `{ threadId, turnId, text }`。
  - `error` / `warning` notification 会进入 sidebar notice 或最终错误；`willRetry` 的 error 只作为 notice 显示。
  - app-server exit 会清空进程、thread、pending request 和 active turn；后续请求可重新 start。
  - request 写入失败、timeout、JSON-RPC error 都会清理 pending request，避免遗留 promise。
- `src/modules/sidebar/index.ts` 当前在提交时先构造 Zotero paper prompt，再调用 `getCodexBridge().sendPrompt(prompt)`：
  - 用户消息立即追加到 chat log。
  - assistant message 先显示“正在启动本机 Codex...”。
  - `ZoteroContextGateway.getPromptContext(activeReader)` 读取当前 PDF reader paper context。
  - `buildPaperQuestionPrompt(value, promptContext)` 把用户问题和 Zotero context 组织成 prompt。
  - delta 到达时用 `renderMarkdown()` 重新渲染 assistant body。
  - 完成但无文本时显示 empty response 文案。
  - 失败时用 fenced code block 展示错误消息。
- `addon/content/preferences.xhtml` 暴露 Codex CLI path 和 request timeout；`addon/prefs.js` 默认 `codex.timeoutMs = 180000`。
- `src/hooks.ts` shutdown 阶段会调用 `shutdownCodexBridge()` 停止 app-server；模板预留 hook 暂时保留，后续接 notifier、shortcut、dialog 或 preference 事件时再接入真实注册逻辑。
- 当前实现边界：
  - 已能把带当前 Zotero PDF reader paper context 的 prompt 发送给本机 Codex。
  - 还没有 conversation registry、thread resume、model selector、approval UI、MCP tools 或最终回答/trace 分离。

## Step 4 ZoteroContextGateway + 显式上下文注入

- commit `db260ee05df16abdf48d750a0de3cd9ee9f31217` 已实现 Step 4 的 reader-only 论文上下文读取。
- 当前产品范围仍只覆盖 PDF reader 场景：用户已经在 Zotero PDF reader 中打开一篇文献，然后在该 reader 上下文中使用 zotero-copilot。主窗口文献列表 selection 不作为 `ZoteroContextGateway` 的上下文来源。
- `src/zotero/types.ts` 定义 Step 4/5 共享类型：
  - `PaperScope`：reader scope，包含 reader item、attachment、parent item、library 和 warning。
  - `PaperMetadata`：parent item metadata，包含 title、creators、year、DOI、abstract 等。
  - `PdfAttachment`：当前 reader PDF attachment 的 path/content type/readable 状态。
  - `PaperTextResult`：全文索引/全文读取结果。
  - `SelectedTextResult`：reader selection 读取结果。
  - `PaperPromptContext`：promptBuilder 使用的聚合上下文。
- `src/zotero/contextGateway.ts` 是唯一的 Zotero paper context 读取边界：
  - `getActivePaper(reader?)` 只从 PDF reader 当前 `itemID` 识别 paper scope。
  - `getPaperMetadata(scope)` 优先从 PDF attachment 的 parent regular item 读取 metadata，失败时返回 warning 并降级。
  - `getPrimaryPdfAttachment(scope)` 读取当前 attachment 的 PDF 类型、本地路径、文件存在性和 readable 状态。
  - `getAttachmentTextStatusForPrompt(scope)` 只读取 Zotero full-text indexed state，不读取完整全文。
  - `getAttachmentFullTextForTool(scope)` 读取完整 `attachment.attachmentText`，用于后续 Step 5 `paper_search` / `paper_read`。
  - `getSelectedText(reader?)` best-effort 读取 reader iframe/window selection，限制长度为 `8000` 字符。
  - `getPromptContext(reader?)` 并行读取 metadata、attachment、text status，并汇总去重 warning。
- `src/codex/promptBuilder.ts` 把 `PaperPromptContext` 和用户问题组织成 prompt：
  - 明确要求模型只在上下文足够时回答 paper-specific facts，不足时说明限制。
  - 注入 title、authors、year、DOI、abstract、attachment 状态、full-text status、selected text、warnings。
  - 当前不会注入完整 PDF full text；`PDF full-text preview` 通常为 `(none)`，后续接 MCP 后应删掉或改成 omitted 说明。
- `src/modules/sidebar/index.ts` 当前 submit 流程：
  - 追加用户消息。
  - 读取 `promptContext`。
  - 调用 `buildPaperQuestionPrompt()`。
  - 通过 `CodexBridge.sendPrompt(prompt)` 发起 turn。
  - 将 `prompt` 和 `promptContext` 暂存到 `window.__zcpLastPrompt` / `window.__zcpLastPromptContext`，便于开发期在 Zotero console 检查完整 prompt。
- Step 4 目的满足情况：
  - 能识别当前 PDF reader 中打开的论文。
  - 能从 reader PDF attachment 回溯 parent regular item。
  - 能用 metadata/abstract/selection 增强用户问题。
  - 无 selection、无 parent item、非 PDF、无本地文件、全文 API 不可用时都返回 warning，不阻断提问。
  - sidebar 不显示 raw prompt，只显示用户问题和最终回答。
- 当前未实现：
  - Step 5 MCP endpoint 和 read-only tools。
  - `paper_search` chunking/retrieval/cache。
  - `paper_read` section/page/overview 语义。
  - MCP scope token、bearer token、tool schema、timeout、provenance。
