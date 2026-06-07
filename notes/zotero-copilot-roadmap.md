可以。建议你按“先能用，再变聪明，再变可靠”的顺序做，不要一开始就复刻 `llm-for-zotero` 的完整 agent 系统。

**路线总览**
你的目标可以拆成 8 个里程碑：

1. 建立 Zotero 插件开发环境
2. 做出一个干净的右侧聊天 sidebar
3. 接入本机 Codex CLI / app-server
4. 先用“显式上下文注入”实现论文问答
5. 再做 read-only Zotero MCP tools
6. 做对话历史和论文级会话
7. 做你的核心 UI 哲学：隐藏 thinking/tool noise
8. 加安全、测试、打包发布

---

**1. 插件开发环境**

准备：

- 本机 Zotero 9。
- 你当前 repo：`/Users/yang/code/zotero/zotero-copilot`。
- Node/npm。
- 一个 Zotero 开发 profile，避免污染日常文献库。

要做：

- 清理模板示例代码。
- 保留插件生命周期：`onStartup`、`onMainWindowLoad`、`onShutdown`。
- 先让插件能在 Zotero 中稳定加载。

你能得到：

- 一个“空但可靠”的 Zotero 插件骨架。
- 菜单、偏好页、sidebar 后续都可以挂在这个骨架上。

如何验证：

- 运行：

```bash
npm start
```

- Zotero 启动后能看到插件。
- JS Console 没有启动错误。
- 关闭 Zotero 后插件能正常 unload，没有残留窗口或重复注册。

完成标准：

- 插件每次启动都稳定加载。
- 不再出现模板示例 UI。
- `onShutdown` 能清理所有注册项。

最小修改文件或目录（大致）：

- `src/hooks.ts`：删掉模板示例注册逻辑，保留干净 lifecycle。
- `src/addon.ts`：保留插件全局状态，后续挂载 runtime/sidebar/store。
- `src/modules/examples.ts`：删除或停止引用模板示例。
- `addon/manifest.json`、`package.json`：确认插件名、ID、描述、版本。
- `addon/prefs.js`、`addon/content/preferences.xhtml`：只保留必要偏好项入口。

当前实现状态：

- 已删除模板示例模块和示例 UI。
- `hooks.ts` 只保留实际使用的 startup/main-window/shutdown lifecycle。
- `package.json` 项目元数据已指向 `qyangcv/zotero-copilot`，不是上游 template。

---

**2. 做出最小 sidebar**

准备：

- 明确 sidebar 放在哪里：推荐先放 Zotero 主窗口右侧，不急着深度嵌入 PDF reader。
- 先不要接模型。

要做：

- 添加一个 sidebar 的 button：打开/关闭 “Zotero Copilot” sidebar。
- sidebar 内部只做 3 个区域：
  - 顶部和中间：对话区域（ai 输出区域）
  - 输入框：用户输入框
  - 输入框下方一行很小的状态栏：使用的模型名称，模型推理强度
- 使用占位文本，暂时不接入模型、不实现真实的功能代码

sidebar 模仿 vscode copilot sidebar 的优秀设计：

- 弹性高度用户输入框
  - 纯输入区域（除去顶部附件区域、底部状态栏）默认高度约为 1.5 倍字体高度
  - 当用户输入更多内容时，输入区域尺寸自适应变大，并有一个最大高度限制，约为 1/3 ～ 1/2 的侧边栏高度
- 高信息密度
  - 在相同尺寸的侧边栏视图中，通过对字体大小、行距、显示信息的优秀控制，展示更多有价值信息内容
- 富语言支持
  - 支持 latex 行内/行间公式、markdown 语法（具体哪一种参考 vscode copilot 的支持）、表格、链接等等元素的渲染

你能得到：

- 一个可交互的产品雏形。
- 你可以开始验证“同样窗口内显示更多有效内容”的 UI 思路。

如何验证：

- 能打开、关闭、重复打开，不产生多个重复 sidebar。
- 切换 Zotero item 时，顶部论文标题能更新。
- 能进行初步的对话；Step 2 阶段是固定占位回复，Step 3 后改为调用本机 Codex。

完成标准：

- UI 不依赖模型也能跑。
- sidebar 结构稳定。
- 小窗口内文本不溢出、不重叠。

最小修改文件或目录（大致）：

- `src/modules/sidebar/`：新增 sidebar controller，并把 constants、reader toolbar、selected item title、Markdown renderer 分模块维护。
- `src/hooks.ts`：在主窗口加载时注册 sidebar button/menu。
- `addon/content/zoteroPane.css`：新增 sidebar 布局、消息样式和 reader toolbar button 样式；主窗口和 PDF reader 共用同一个 chrome stylesheet。
- `addon/locale/*/addon.ftl`：新增按钮、标题、状态文案。
- `src/utils/window.ts`：如果需要，补充获取主窗口/当前 Zotero pane 的工具函数。

当前实现状态：

- 主界面 `#zotero-items-toolbar` 和 PDF reader `renderToolbar` 均有 toggle 入口。
- 侧栏挂在 Zotero 主布局右侧，不使用 `ItemPaneManager.registerSection()`。
- 输入提交已接入本机 Codex；还没有拼接真实论文上下文。

---

**3. 接入本机 Codex CLI / app-server**

准备：

- 确认本机 Codex CLI 可用：

```bash
command -v codex
codex --help
codex app-server --help
```

- 用户需要先登录：

```bash
codex login
```

要做：

- 在 Zotero 插件中用 Firefox/Zotero 的 `Subprocess` 启动：

```bash
codex app-server --stdio
```

- 写一个 `CodexBridge` 模块，只负责：
  - 启动进程
  - 发送 JSON-RPC request
  - 接收 JSON-RPC response / notification
  - 处理 timeout
  - 进程崩溃后报错，并允许后续请求重新启动

你能得到：

- Zotero 插件和 Codex 本机 runtime 的通信通道。
- 这一步还不需要懂 MCP，也不需要读论文。

如何验证：

- app-server 能 initialize。
- 能 initialize、启动一个 ephemeral thread，并发起一个最小 `turn/start`。
- Codex 进程退出时，sidebar 显示明确错误，而不是卡死。

完成标准：

- `CodexBridge.start()` 成功完成 `initialize` / `initialized` 握手。
- `CodexBridge.sendPrompt(prompt)` 可复用，内部通过 JSON-RPC 发起 `thread/start` / `turn/start`。
- 所有 request 有超时和错误提示。
- 多次发送消息不会并发打乱。初期可以简单做 queue，一次只跑一个 turn。

最小修改文件或目录（大致）：

- `src/codex/bridge.ts`：新增 Codex app-server 进程启动和 JSON-RPC 通信。
- `src/codex/types.ts`：定义 request、response、notification、turn event 和 Subprocess 边界类型。
- `src/codex/binaryPath.ts`：解析 `codex` 路径和用户自定义路径。
- `src/modules/sidebar/`：接入 bridge 状态，显示启动失败/未登录/运行中。
- `addon/prefs.js`、`addon/content/preferences.xhtml`：增加 Codex path、request timeout、sidebar width 等配置。

当前实现状态：

- 已新增 `src/codex/bridge.ts`、`src/codex/types.ts`、`src/codex/binaryPath.ts`。
- `resolveCodexBinaryPath()` 优先使用 `codex.path`，为空时依次搜索 PATH、`~/.local/bin/codex`、`/opt/homebrew/bin/codex`、`/usr/local/bin/codex`。
- `CodexBridge.start()` 使用 Zotero/Mozilla `Subprocess` 启动 `codex app-server --stdio`，通过 line-delimited JSON-RPC 完成 `initialize` / `initialized`。
- `sendPrompt()` 会确保存在一个 ephemeral thread，再发 `turn/start`；`item/agentMessage/delta` 会流式更新 assistant message，`turn/completed` 后写入最终文本。
- prompt turn 通过 `promptQueue` 串行化，避免多个用户输入并发打乱同一个 `activeTurn`。
- request timeout 来自 `codex.timeoutMs`，默认 `180000` ms；异常、warning、app-server exit 会传到 sidebar。
- shutdown 时调用 `shutdownCodexBridge()` 停止本机 app-server 进程。
- 当前还没有 Step 4 的 Zotero metadata / PDF selection context 注入，也没有 MCP tools、conversation registry、thread resume 或模型选择 UI。

---

**4. 先做“显式上下文注入”的论文问答**

这一步不要急着做 MCP。对新手更稳。

准备：

- 先只支持“当前选中的 Zotero item”。
- 先只读标题、作者、年份、摘要、PDF 选中文本。
- 不做全库搜索。

要做：

- 写 `ZoteroContextGateway`：
  - `getActiveItem()`
  - `getItemMetadata()`
  - `getSelectedTextFromReader()`
  - `getAttachmentTextPreview()`

- 用户提问时，把上下文拼成一段清晰 prompt：

```text
Current Zotero paper:
Title: ...
Authors: ...
Abstract: ...

Selected text:
...

User question:
...
```

- 发给 Codex app-server。

你能得到：

- 第一个真正有用的版本：用户选中论文，直接问 Codex。
- 还没有复杂工具调用，所以容易 debug。

如何验证：

- 选中一篇有摘要的文献，问：“这篇论文主要贡献是什么？”
- 选中 PDF 中一段文字，问：“解释这段。”
- 回答中应该明显使用了当前论文/选中文本，而不是泛泛回答。

完成标准：

- 能回答当前论文相关问题。
- 无选中文本时不会报错。
- 当前 item 没有 PDF 时也能用 metadata/abstract 回答。
- sidebar 中只显示最终回答，不显示底层 prompt。

最小修改文件或目录（大致）：

- `src/zotero/contextGateway.ts`：新增当前 item、metadata、PDF 选中文本读取。
- `src/codex/promptBuilder.ts`：把论文上下文和用户问题组织成 prompt。
- `src/modules/sidebar/`：把用户输入、上下文读取、Codex turn 串起来。
- `src/shared/types.ts`：定义 `PaperContext`、`ChatMessage` 等轻量类型。
- `src/utils/zoteroItems.ts` 或 `src/utils/window.ts`：如果需要，封装 Zotero API 访问。

---

**5. 加 read-only MCP tools**

MCP 可以理解为：你给 Codex 提供一组“工具”，例如 `paper_read`，模型需要时主动调用，而不是你一次性把所有上下文塞进 prompt。

准备：

- 先只做 read-only tools。
- 不做删除、写 note、运行命令。
- 工具名字保持少而清晰。

建议第一批 tools：

- `get_active_paper`
- `read_selected_text`
- `paper_read`
- `library_search`

要做：

- 在 Zotero 本地 HTTP server 上注册一个 MCP endpoint。
- 给 endpoint 加 bearer token。
- 每次 Codex turn 生成一个 scope，例如当前 library、当前 paper、当前 conversation。
- Codex app-server thread config 里注入这个 MCP server。

你能得到：

- Codex 可以自己决定何时读取论文、搜索库、读取选中文本。
- 上下文不必全部塞进 prompt，后续可扩展性更好。

如何验证：

- 问：“这篇论文第 3 节讲了什么？”
- 模型应该调用 `paper_read`，而不是瞎猜。
- 问：“我的库里有没有和 RAG evaluation 相关的论文？”
- 模型应该调用 `library_search`。

完成标准：

- MCP initialize 成功。
- tools/list 返回你的工具。
- 每个 tool 有 schema、错误处理、scope 限制。
- 工具调用失败时，sidebar 给用户一句可理解的错误。

最小修改文件或目录（大致）：

- `src/mcp/server.ts`：新增本地 MCP endpoint 和 JSON-RPC dispatch。
- `src/mcp/protocol.ts`：定义 MCP initialize、tools/list、tools/call 的协议常量和类型。
- `src/mcp/tools/`：新增 `get_active_paper`、`read_selected_text`、`paper_read`、`library_search`。
- `src/codex/mcpConfig.ts`：把 MCP server 配置注入 Codex app-server thread。
- `src/zotero/contextGateway.ts`：复用已有 Zotero 读取逻辑给 MCP tools。

---

**6. 做对话历史和论文级会话**

准备：

- 明确两类 conversation：
  - Global chat：和整个 Zotero library 相关
  - Paper chat：绑定某一篇论文

要做：

- 建一个本地 store，可以先用 Zotero prefs 或 SQLite。
- 每条 message 至少存：
  - conversation id
  - paper item id
  - role
  - text
  - timestamp
  - runtime thread id
- Codex app-server 返回 thread id 后保存起来，下次继续 resume。

你能得到：

- 每篇论文有自己的聊天历史。
- 重新打开 Zotero 后可以继续之前的讨论。

如何验证：

- 对论文 A 问两轮问题。
- 切到论文 B，历史不同。
- 回到论文 A，历史恢复。
- 重启 Zotero 后历史还在。

完成标准：

- 不同 paper 的对话不会串。
- 删除/新建 conversation 功能可用。
- app-server thread id 丢失时，可以退回新建 thread，不崩溃。

最小修改文件或目录（大致）：

- `src/store/conversations.ts`：新增 conversation/message/thread id 持久化。
- `src/store/schema.ts` 或 `src/store/migrations.ts`：如果用 SQLite，放表结构和迁移。
- `src/shared/conversation.ts`：定义 global chat、paper chat、conversation id 规则。
- `src/modules/sidebar/`：新增历史加载、切换、新建、删除 UI。
- `addon/prefs.js`：如果先用 prefs 存储，增加必要 key；长期更建议 SQLite。

---

**7. 实现你的 UI 哲学：隐藏 thinking/tool noise**

准备：

- 定义哪些内容是“主内容”，哪些是“诊断内容”。

建议规则：

- 默认显示：
  - 用户问题
  - assistant 最终回答
  - 引用/证据 chips
  - 当前上下文来源
- 默认隐藏：
  - reasoning summary
  - tool call args
  - raw MCP result
  - app-server protocol event
  - token usage
- 只在用户点开 Diagnostics 时显示底层细节。

要做：

- 写一个 `MessagePresenter`，不要把 runtime event 直接渲染到 UI。
- runtime event 先进入 reducer：
  - `message_delta` 合并成 assistant text
  - `tool_started` 变成一行状态
  - `tool_completed` 默认不显示，只更新 citation/context
  - `reasoning` 存起来但默认隐藏
- sidebar 中给每条 assistant message 一个很小的 `Details` 按钮。

你能得到：

- 和 `llm-for-zotero` 区分明显的产品体验。
- 同样 sidebar 尺寸下，主要空间留给回答和证据。

如何验证：

- 运行一个会调用多个工具的问题。
- 主聊天区不应该被 tool call 刷屏。
- 用户仍然能在 Diagnostics 中看到“模型读了什么、调用了什么”。

完成标准：

- 默认 UI 中无大段 reasoning/tool JSON。
- 状态提示简短。
- 错误时能展开诊断。
- 回答内容密度比普通 agent trace UI 高。

最小修改文件或目录（大致）：

- `src/modules/sidebar/messagePresenter.ts`：把 runtime events 转成用户可见消息。
- `src/modules/sidebar/eventReducer.ts`：合并 streaming delta，隐藏 reasoning/tool noise。
- `src/modules/sidebar/diagnosticsPanel.ts`：只在用户展开时显示底层事件。
- `addon/content/zoteroPane.css`：优化紧凑消息、context chips、Diagnostics 样式。
- `src/shared/types.ts`：补充 `RuntimeEvent`、`PresentedMessage` 等展示层类型。

---

**8. 加写入能力和安全确认**

这一步不要太早做。

准备：

- 先选择一个低风险写操作：写 Zotero note。
- 不要一开始支持删除 item、运行 shell、任意 JS。

要做：

- 增加 `note_write_draft`，先只生成草稿。
- sidebar 显示 diff 或 preview。
- 用户点击 Apply 后才写入 Zotero note。
- 每个写工具都要有确认卡片。

你能得到：

- 从“问答助手”升级到“文献工作流助手”。
- 例如：生成阅读笔记、总结 contribution、整理 related work。

如何验证：

- 让模型生成 note draft。
- Apply 前 Zotero note 不变化。
- Apply 后 note 写入正确位置。
- Cancel 不产生任何修改。

完成标准：

- 所有写操作必须显式确认。
- 有 undo 或至少有清晰 preview。
- 没有用户确认时，模型不能直接改库。

最小修改文件或目录（大致）：

- `src/mcp/tools/note_write_draft.ts`：新增只生成草稿/preview 的写入工具。
- `src/zotero/noteWriter.ts`：封装真正写入 Zotero note 的逻辑。
- `src/modules/sidebar/confirmationCard.ts`：新增 Apply/Cancel 确认卡片。
- `src/store/pendingActions.ts`：保存待确认写入动作，避免刷新后误执行。
- `addon/content/zoteroPane.css`：新增 diff/preview/confirmation 样式。

---

**9. 测试和打包**

准备：

- 列出核心场景，不要只测 happy path。

建议测试清单：

- Zotero 无 item 选中
- item 无 PDF
- PDF 有选中文本
- Codex 未登录
- Codex app-server 启动失败
- MCP tool 超时
- 重启 Zotero 后恢复历史
- 多次打开关闭 sidebar
- 写 note 前取消

要做：

- 单元测试：context parser、message reducer、store。
- 手动测试：Zotero UI、PDF reader、Codex bridge。
- 打包 `.xpi`。

你能得到：

- 一个可以长期迭代的插件，而不是一次性 demo。

如何验证：

- `npm run build` 通过。
- 安装 `.xpi` 后不依赖 dev server。
- 新 profile 里能从零配置并使用。

完成标准：

- 构建无 TypeScript 错误。
- 插件可安装、可卸载。
- 常见失败路径都有用户可读提示。

最小修改文件或目录（大致）：

- `test/`：新增 context、bridge、message reducer、store 的单元测试。
- `package.json`：补充或调整 `test`、`build`、`lint` scripts。
- `zotero-plugin.config.ts`：确认打包、版本、资源路径配置。
- `doc/` 或 `notes/`：记录安装、登录 Codex、常见问题。
- `addon/locale/*`：补全错误提示和设置页文案。

---

**推荐的最小可用版本范围**
第一版不要做完整 agent。做到这些就够：

- Zotero sidebar
- Codex app-server bridge
- 当前论文 metadata + selected text 注入
- 最终回答流式显示
- 隐藏 reasoning/tool noise
- 简单 conversation history

这版已经能体现你的设计哲学。之后再加 MCP、library search、note writing。这样风险低，也能保证你写出来的是自己的插件，而不是 `llm-for-zotero` 的复杂复刻。
