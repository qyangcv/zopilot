我先说明一个文件差异：当前 [notes/zotero-copilot-implementation.md](/Users/yang/code/zotero/zotero-copilot/notes/zotero-copilot-implementation.md:1) 只有 Step 1/2，没有 Step 3/4。真正包含 Step 3/4 规划的是 [notes/zotero-copilot-roadmap.md](/Users/yang/code/zotero/zotero-copilot/notes/zotero-copilot-roadmap.md:130)。下面按这个实际内容讲。

**一、llm-for-zotero 接入 Codex 的核心原理**

[notes/llm-for-zotero-implementation.md](/Users/yang/code/zotero/zotero-copilot/notes/llm-for-zotero-implementation.md:1) 的核心结论是：`llm-for-zotero` 不是把 Codex Desktop App 的界面塞进 Zotero，而是让 Zotero 插件启动/连接本机的 `codex app-server`，再把 Zotero 的文献能力通过 MCP 暴露给 Codex。

可以把它理解成三层：

```text
Zotero 插件 UI
  -> Codex app-server 通信桥
    -> Codex 模型/runtime + Zotero MCP tools
```

关键术语逐一解释：

`Codex Desktop App`：你本机登录过的 Codex 应用/运行环境。这里重要的不是它的可视化界面，而是它背后可被本地程序调用的能力。

`codex app-server`：Codex CLI 提供的本地服务模式。插件可以启动它，然后用协议和它通信。它相当于“本机 Codex 后端入口”。

`native runtime`：意思是“不走浏览器网页、不抓 ChatGPT 页面”，而是调用本机 Codex 运行时。`native` 在这里强调本机进程/本地协议。

`codex login`：让本机 Codex CLI 获得登录态。这样插件不需要自己保存 OpenAI API key，而是复用 Codex 的登录环境。

`legacy direct backend`：旧路线，直接打 ChatGPT/Codex 的内部 backend URL。笔记里说不推荐，因为这种接口不稳定、非正式、容易变化。

`Subprocess`：Zotero 基于 Mozilla/Firefox 平台，插件可以用它启动外部进程。这里就是由 Zotero 插件启动：

```bash
codex app-server --stdio
```

`stdio://`：standard input/output，也就是标准输入输出。插件把请求写到 Codex 进程的 stdin，再从 stdout 读回结果。优点是简单，不需要开放网络端口。

`unix://`：Unix domain socket，本机进程间通信方式。比 TCP 端口更偏本地化。

`ws://IP:PORT`：WebSocket 通信方式。适合网络端口连接，但本地插件初版没必要优先用。

`JSON-RPC`：一种“用 JSON 表示函数调用”的协议。大概长这样：

```json
{"id":1,"method":"turn/start","params":{...}}
```

返回：

```json
{"id":1,"result":{...}}
```

所以插件和 Codex app-server 不是随便传字符串，而是在互相发送结构化 request/response。

`line messages`：每条 JSON-RPC 消息按行分隔。也就是一行一个 JSON 对象，方便从 stdout 流里解析。

`turn/start`：一次用户提问就是一个 turn。`turn/start` 就是告诉 Codex：“开始处理这一轮对话”。

`text delta`：流式回答中的增量文本。模型不是一次性返回完整答案，而是一小段一小段吐出来，UI 可以边生成边显示。

`reasoning`：模型推理过程或推理摘要。产品上通常不应该默认占据主聊天区，适合放到 diagnostics 里。

`usage`：token 使用量、消耗统计等。

`item/tool events`：Codex 在处理过程中可能产生事件，例如创建一条 assistant message、调用工具、工具返回结果、需要审批等。

`thread id`：Codex runtime 里的对话线程 ID。保存它之后，下次可以继续同一段上下文，而不是每次都重新开始。

`conversation key`：Zotero 插件自己定义的会话键。例如“全局聊天”一个 key，“某篇论文聊天”一个 key。它负责把 Zotero 侧的语义会话映射到 Codex 的 thread id。

`global chat`：不绑定单篇论文的聊天，面向整个 Zotero library。

`paper chat`：绑定某一篇论文的聊天。这样你切换论文时，对话不会串。

`thread resume`：恢复之前的 Codex thread，继续上下文。

`full context injection`：第一次提问时，把完整上下文塞给模型，例如标题、作者、摘要、选中文本。

`delta context injection`：后续只补充变化的部分，例如用户又选了另一段 PDF 文本。

`thin context injection`：更轻量的上下文，只给最必要的信息，减少 token 使用。

`MCP`：Model Context Protocol。简单理解：给模型提供工具的标准协议。不是把所有文献内容一次性塞进 prompt，而是给模型工具，例如 `paper_read`、`library_search`，模型需要时自己调用。

`MCP tool`：一个可被模型调用的函数。例如：

```text
paper_read(paper_id, section)
library_search(query)
read_selected_text()
```

`read-only MCP`：只读工具，只能读论文、读选中文本、搜索文献，不能删除、写 note、运行命令。初版更安全。

`bearer token`：访问 MCP endpoint 的令牌。作用是防止随便一个本地请求都能调用 Zotero 工具。

`scope header`：给每次工具调用限定范围，例如“只能访问当前 library / 当前 paper / 当前 conversation”。这是为了防止模型读错库或跨会话访问。

`shell tool`：让模型运行 shell 命令的能力。笔记里建议关掉，因为 Zotero 插件初版不需要模型执行系统命令，风险高。

`thread config`：启动 Codex thread 时传入的配置，例如可用模型、是否启用 shell、要挂载哪些 MCP server。

`agent trace`：agent 执行过程记录，包括 reasoning、tool call、tool result、approval 等。`llm-for-zotero` 会把这些整理进 UI，但你的设计目标是主界面少展示这些噪音。

`<details>`：HTML 折叠块。reasoning 默认折叠，用户点开才看。

`Runtime Adapter`：运行时适配层。意思是 UI 不直接依赖 Codex，后面如果换 Claude、OpenAI API、本地模型，只换 adapter。

`Context Gateway`：Zotero 上下文入口。统一负责读当前 item、metadata、PDF 选中文本、note、attachment 等。

`Scoped MCP`：带作用域限制的 MCP。每轮对话生成一个 scope，避免工具无限制访问 Zotero 数据。

`Conversation Registry`：会话注册表。保存 `conversationKey -> runtimeThreadId -> paper/library scope` 的关系。

`Delta Context`：上下文增量更新机制。目的是省 token、减少重复输入。

`HITL Approval`：human-in-the-loop approval，人类确认。写 note、删除 item、修改 metadata 这类操作必须用户确认后执行。

**二、这套方案为什么比网页抓取稳定**

网页抓取是让插件去控制 ChatGPT/Codex 网页 DOM，例如找输入框、点按钮、读页面文本。这很脆弱，因为网页结构一改就坏。

`app-server` 路线是协议通信：

```text
插件发送 JSON-RPC -> Codex 返回结构化事件 -> 插件渲染 UI
```

所以它更像“插件调用本机 Codex 后端”，不是“插件模拟人在网页里操作”。

**三、llm-for-zotero 的可借鉴点和不该照搬点**

可借鉴的是边界设计：

```text
UI 层：sidebar 怎么显示
Runtime 层：怎么和 Codex 通信
Context 层：怎么读 Zotero 内容
Tool 层：怎么把 Zotero 能力暴露给模型
```

不该照搬的是复杂度。它有 heavy `nativeClient`、store、MCP、agent trace、history migration、controller 拆分。对你的插件来说，初版目标应该是：

```text
干净 sidebar
+ Codex app-server bridge
+ 当前论文上下文注入
+ 最终回答显示
```

不要一开始做完整 agent 系统。

**四、Step 3 的当前实现：接入本机 Codex CLI / app-server**

Step 3 位于 [notes/zotero-copilot-roadmap.md](/Users/yang/code/zotero/zotero-copilot/notes/zotero-copilot-roadmap.md:130)。

它的目的只有一个：让 Zotero 插件能和本机 Codex runtime 通信。当前代码已经完成基础通信通道，但还没有把 Zotero 论文上下文注入 prompt。

要做的事：

1. 确认本机 `codex` 可用：

```bash
command -v codex
codex --help
codex app-server --help
```

2. 用户先登录：

```bash
codex login
```

3. 插件里启动：

```bash
codex app-server --stdio
```

4. 当前已新增 `CodexBridge`，职责保持在通信层：

```text
启动 Codex 进程
发送 JSON-RPC request
接收 response / notification
处理 timeout
进程退出后报错，并允许后续请求重新启动
```

已落地文件：

```text
src/codex/bridge.ts
src/codex/types.ts
src/codex/binaryPath.ts
```

这一步不要关心论文内容，也不要做 MCP。它只是在修“通信管道”。

当前真实逻辑是：

```text
resolveCodexBinaryPath() 解析用户配置或常见 codex 路径
CodexBridge.start() 启动 codex app-server --stdio
start() 完成 initialize / initialized 握手
sendPrompt() 确保有一个 ephemeral thread
sendPrompt() 调用 turn/start
item/agentMessage/delta 流式更新 sidebar assistant message
turn/completed 返回 threadId、turnId、最终文本
promptQueue 保证同一 bridge 内一次只运行一个 turn
timeout、JSON-RPC error、warning、进程退出都会反馈到 sidebar
```

偏好项也已落地：

```text
codex.path       可选；为空时自动搜索 PATH、~/.local/bin、Homebrew 等常见路径
codex.timeoutMs  默认 180000 ms
sidebar.width    保存用户调整后的右侧栏宽度
```

需要注意的边界：

```text
当前 sidebar 直接把用户输入发给 Codex
还没有拼接 Zotero item 标题、作者、摘要、PDF 选中文本
还没有 MCP、conversation registry、thread resume 或模型选择 UI
CodexBridge.request() 是 bridge 内部方法；UI 层使用 sendPrompt()
```

**五、Step 4 的实现计划：显式上下文注入论文问答**

Step 4 位于 [notes/zotero-copilot-roadmap.md](/Users/yang/code/zotero/zotero-copilot/notes/zotero-copilot-roadmap.md:191)。

它的目的：让用户选中一篇 Zotero 论文后，能问出真正基于这篇论文的问题。

这一步仍然不做 MCP，而是先用最直观的 prompt 拼接。

要做的事：

1. 新建 `ZoteroContextGateway`：

```text
getActiveItem()
getItemMetadata()
getSelectedTextFromReader()
getAttachmentTextPreview()
```

2. 用户提问时，把上下文拼成 prompt：

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

3. 把这个 prompt 发给 Step 3 已经做好的 `CodexBridge`。

建议文件：

```text
src/zotero/contextGateway.ts
src/codex/promptBuilder.ts
src/modules/sidebar/
src/shared/types.ts
```

完成标准是：

```text
能回答当前论文相关问题
没有 PDF 时也能基于 metadata/abstract 回答
没有选中文本时不报错
sidebar 只显示最终回答，不显示底层 prompt
```

**六、Step 3 和 Step 4 的目的区别**

一句话区别：

```text
Step 3 解决“Zotero 怎么连上 Codex”
Step 4 解决“Codex 怎么知道当前 Zotero 论文是什么”
```

更具体地说：

`Step 3` 是基础设施层。它不理解论文、不读 Zotero item、不构造 prompt。只负责启动 Codex、发消息、收消息、处理错误。

`Step 4` 是产品能力层。它开始读取 Zotero 当前 item、标题、作者、摘要、PDF 选中文本，并把这些内容组织成 Codex 能理解的上下文。

所以依赖关系是：

```text
Step 2 sidebar
  -> Step 3 CodexBridge：能发问
    -> Step 4 ContextGateway + PromptBuilder：问得和当前论文有关
```

Step 3 成功后，你得到的是“能聊天，但还不懂 Zotero”。
Step 4 成功后，你得到的是“能围绕当前论文问答”。

后面的 Step 5 MCP 才是再进一步：不再每次把上下文显式塞进 prompt，而是让模型按需调用 `paper_read`、`library_search` 这类工具。
