我看了 `llm-for-zotero` 当前源码，检出版本是 `27c25386dcd2bc132a0d909e71064fb147e6e199`。结论先说：它的 Codex 集成不是“嵌入 Codex App UI”，而是把本机 `codex app-server` 当作 native runtime，用 Zotero 插件启动/连接它，再通过本地 MCP 把 Zotero library、paper、note 等能力暴露给 Codex。你要做类似插件，可以学它的边界设计，但不建议学它的复杂度。

**它怎么接入 Codex**

1. 偏好项里区分两条 Codex 路线：legacy direct ChatGPT/Codex backend 和推荐的 `Codex App Server`。源码说明新用户应使用 `codex app-server`，并先 `codex login`：[preferenceScript.ts](/tmp/llm-for-zotero-analysis/src/modules/preferenceScript.ts:177)。
2. 插件用 Zotero/Firefox 的 `Subprocess` 启动本地 Codex CLI，默认通过 `stdio://` 和 app-server 交换 JSON-RPC line messages：[codexAppServerProcess.ts](/tmp/llm-for-zotero-analysis/src/utils/codexAppServerProcess.ts:149)。我也在本机确认了 `codex app-server` 存在，支持 `stdio://`、`unix://`、`ws://IP:PORT`。
3. 每次对话 turn 通过 `turn/start` 发给 app-server，回调里接收 text delta、reasoning、usage、item/tool events，并把 thread id 持久化：[nativeClient.ts](/tmp/llm-for-zotero-analysis/src/codexAppServer/nativeClient.ts:2004)。
4. 它维护 Codex conversation key、global chat、paper chat、thread resume、full/delta/thin context injection。也就是说，Zotero 侧负责“上下文生命周期”，Codex 侧负责模型推理和工具调度：[nativeClient.ts](/tmp/llm-for-zotero-analysis/src/codexAppServer/nativeClient.ts:2200)。
5. Zotero 能力通过本地 MCP 暴露：`/llm-for-zotero/mcp`，带 bearer token 和 scope header，工具包括 `library_search`、`library_read`、`library_retrieve`、`paper_read`、`literature_search`，也有写入/删除类工具：[server.ts](/tmp/llm-for-zotero-analysis/src/agent/mcp/server.ts:41)。
6. app-server thread config 里会关闭 shell tool，并注入 Zotero MCP server config：[mcpSetup.ts](/tmp/llm-for-zotero-analysis/src/codexAppServer/mcpSetup.ts:528)。
7. UI 上它没有隐藏所有过程信息，而是把 reasoning、tool call、tool result、pending approval 都整理成 agent trace；reasoning 默认是可折叠的 `<details>`：[render.ts](/tmp/llm-for-zotero-analysis/src/modules/contextPanel/agentTrace/render.ts:2889)。

**可学习的设计模式**

- Runtime Adapter：把 Codex、Claude、普通 API provider 分开，不把 UI 直接绑死在某个 provider 上。
- Context Gateway：Zotero 侧统一负责选中文本、论文全文、引用、note、screenshot、attachment 的上下文提取。
- Scoped MCP：每个 turn 给 MCP 一个 scope token，让工具调用绑定当前 library/paper/conversation，避免模型读错库。
- Conversation Registry：不要只存 chat message，要存 `conversationKey -> runtimeThreadId -> paper/library scope`。
- Delta Context：首次注入完整上下文，后续只注入资源变化或 thin follow-up，节省上下文窗口。
- HITL Approval：写入 Zotero、删除、运行命令这类操作必须走用户确认。

**它的设计优点**

- 不需要 OpenAI API key，主要依赖 `codex login` 后的本机 Codex 登录态，更接近你说的“用 GPT Subscription”。
- 比网页自动化稳定：不是抓 ChatGPT 页面 DOM，而是走 app-server 协议。
- MCP 边界清晰：Zotero 数据读取/写入是工具，不是塞进 prompt 的一团文本。
- 能做真正 agent workflow：搜索文献、读 PDF、写 note、修改 library，都可以统一走工具。
- 有 preflight、token、scope、approval，工程上考虑了本地安全边界。

**它的问题**

- 复杂度很高。`nativeClient`、store、MCP、agent trace、history migration、controller 拆分都很重，不适合你从零做一个更简洁插件时照搬。
- app-server 仍是实验性入口。本机 `codex app-server --help` 也标记为 experimental，所以协议兼容性需要防守式设计。
- UI 信息密度不一定好。它虽然折叠 reasoning，但仍把大量工具事件、状态、trace、审批卡片作为一等内容展示，和你“同样侧边栏尺寸显示更多有效回答内容”的目标有冲突。
- legacy direct `chatgpt.com/backend-api/codex/responses` 路线不应作为主设计。源码自己也把它标为 legacy：[codexResponses.ts](/tmp/llm-for-zotero-analysis/src/agent/model/codexResponses.ts:26)。
- MCP 写工具风险大。初版如果开放 `library_delete`、`run_command`、`file_io`、`zotero_script`，安全和 UX 成本会很高。

**我建议你的实现路线**

- 主路线：`Zotero plugin -> Codex app-server stdio -> Codex logged-in runtime`。不要做 ChatGPT 网页抓取，也不要依赖 legacy backend URL。
- 初版只做 read-only MCP：`library_search`、`paper_read`、`note_read`、`selection_read`。写 note、改 metadata、删除 item 后面再加。
- UI 做“信息过滤器”，不要做完整 agent trace：
  - 默认只显示 assistant answer、引用/证据、当前使用的 context chips。
  - reasoning、tool call、raw MCP result 放到可展开的 diagnostics drawer。
  - 工具运行中只显示一行紧凑状态，比如“Reading 3 papers...”。
  - 失败时再展开必要错误，不把正常 tool noise 占用主聊天区。
- 架构上保留三个独立模块：`RuntimeBridge`、`ZoteroContextGateway`、`ChatSidebarPresenter`。这样你能学习它的边界，但代码完全独立。
- 你的当前 repo 已经从 `zotero-plugin-template` 示例阶段清理成轻量 lifecycle + sidebar controller。下一步可以在现有 sidebar 边界内接入 `RuntimeBridge` 和 `ZoteroContextGateway`，不需要继承 `llm-for-zotero` 那套庞大状态机。

避免抄袭的实际原则：不要复制文件、函数、命名体系、CSS class、SQL schema 或控制器结构。可以写一份自己的产品规格：Codex app-server bridge、read-only Zotero MCP、dense sidebar rendering、hidden diagnostics，然后按这个规格独立实现。
