# 使用 OpenAI-compatible providers 支持 BYOK

## 目标

Zopilot 不应再把 Codex CLI 作为唯一的 AI agent runtime。用户应该可以
使用自己的 API key 和 OpenAI-compatible Base URL，直接接入 DeepSeek、
GLM/Z.AI、MiniMax 等明确提供 OpenAI-compatible API 的 hosted providers。

本方案选择引入 OpenAI Agents SDK JS 作为 BYOK providers 的 agent
runtime。Codex CLI 继续作为可选 backend 支持，但不再是产品运行的必要
条件。

期望的产品结果：

- 未安装 Codex CLI 的用户也能完整使用 Zopilot sidebar 功能。
- 每个 provider profile 相互独立，不共享 key、状态或配置。
- Codex CLI 只是多个 provider/backend 之一，不再是架构边界；迁移后它作为
  default provider 出现在 Provider 配置界面中。
- 不同 provider/model 产生的 session history 由 Zopilot 统一管理。用户切换
  provider 或 model 后，仍能看到同一 workspace 下的历史对话，并可以在
  Zopilot 兼容策略允许时继续对话。
- 论文阅读、selected source mentions、attachments、streaming answers、
  cancellation、model selection、session history 都是 Zopilot 自己的功能，
  不是 Codex-only 功能。

## 来源假设

OpenAI Agents SDK JS 适合作为 BYOK runtime layer，因为它已经提供
built-in agent loop、tool invocation、tool result round-tripping、
sessions、streaming、MCP tool support、tracing 和 retries。官方文档将
SDK 描述为由 agents、instructions、tools、built-in agent loop、
function tools、MCP tools、sessions 和 streaming 等能力组成：

- OpenAI Agents SDK overview:
  https://openai.github.io/openai-agents-js/
- Tools:
  https://openai.github.io/openai-agents-js/guides/tools/
- Streaming:
  https://openai.github.io/openai-agents-js/guides/streaming/
- Sessions:
  https://openai.github.io/openai-agents-js/guides/sessions/
- Models and non-OpenAI providers:
  https://openai.github.io/openai-agents-js/guides/models/
- Agents SDK AI SDK integration:
  https://openai.github.io/openai-agents-js/extensions/ai-sdk/

对于 OpenAI-compatible providers，优先使用 Vercel AI SDK 的
OpenAI-compatible provider adapter，再通过 Agents SDK AI SDK integration
接入 OpenAI Agents SDK。AI SDK OpenAI-compatible provider 支持自定义
`baseURL`、`apiKey`、streaming、tool calling、structured outputs
（启用时）、reasoning content、system messages，以及 provider-dependent
multimodal inputs：

- AI SDK OpenAI-compatible providers:
  https://ai-sdk.dev/providers/openai-compatible-providers

因此，除非 SDK 路线在 runtime compatibility spike 中失败，Zopilot 不应
手写一个通用 multi-provider agent loop。

## 非目标

- 不重新实现 Codex app-server。
- 不考虑支持 local gateway 或 self-hosted endpoint。
- 不把 LiteLLM、OpenRouter routing、enterprise proxy 或用户自建 gateway
  作为本阶段目标。
- 不把 provider-side thread/session APIs 纳入 Zopilot core model。
- 不承诺与 Codex CLI 内部语义完全一致，例如 Codex `thread/start`、
  `turn/start` 或 Codex-specific MCP event names。
- 不让 OpenAI Agents SDK、AI SDK 或 provider-specific data shapes 泄漏到
  React UI、conversation storage 或 Zopilot public types。
- 不在第一版解决所有 provider capability。第一版只支持保守 baseline。

## 架构方向

引入一个由 Zopilot 自己拥有的 generic agent layer：

```text
Sidebar / Preferences / Conversation Store
        |
        v
Zopilot AgentBackend interface
        |
        +-- CodexCliBackend
        |
        +-- OpenAICompatibleAgentsBackend
        |       |
        |       v
        |   OpenAI Agents SDK JS
        |       |
        |       v
        |   AI SDK OpenAI-compatible provider
        |
        +-- Future backend implementations
```

核心边界是 `AgentBackend`。Zopilot UI 只应该关心 "available backend
status"、"available models"、"send prompt" 和 "cancel turn"。UI 不应知道
当前 backend 是 Codex CLI、OpenAI Agents SDK，还是未来的其他 runtime。

OpenAI Agents SDK 位于该边界之下，用于避免自研以下困难 runtime 逻辑：

- streaming model output；
- 检测并执行 tool calls；
- 将 tool outputs 回传给 model；
- 维护 run state；
- 基础 session integration；
- retry hooks；
- event stream inspection；
- 可选 MCP tool integration；
- 面向未来 diagnostics 的 tracing hooks。

Zopilot 仍然自己负责：

- provider profile persistence 和 validation；
- 面向用户的 backend selection；
- API key storage 和 redaction；
- paper/context tool definitions；
- conversation history 和 migration；
- context budget policy；
- capability matrix；
- normalized errors；
- UI status 和 cancellation semantics。

## BYOK baseline 产品行为

第一版 BYOK 应支持：

- provider profiles，包含 display name、provider kind、Base URL、API key、
  model ID 和 capability flags；
- preference 新增 Provider 界面，用于统一管理 Codex CLI backend 和 BYOK
  providers，并替代现有 Connection 界面；
- 支持多个 provider groups 的 create/update/delete、connection test 和
  available models query；
- 手动填写 model，因为许多 OpenAI-compatible providers 不提供可靠的
  model list，或返回 provider-specific metadata；
- 支持时可选 fetching model list；
- sidebar 输入框的 model selection 与 Provider 配置共享同一份 source of
  truth，并在 preference 修改后实时同步；
- text-only chat with streaming output；
- `paper_read` 作为第一批支持的 tool；
- source mentions 能路由到 tool 和 prompt context；
- PDF/image local attachment handling 仅在 selected model profile 声明支持
  时启用；
- 通过 request abort / stream cancellation 实现 cancellation；
- local Zopilot conversation history 是 durable source of truth；
- session history 不按 provider 隔离。Provider/model 是 message metadata，
  不是 conversation partition key；
- provider-specific failures 归一化为一小组 user-facing diagnostics。

## 已完成的现有耦合移除

重构前代码把 Codex 当成 backend boundary；现在已经完成以下迁移：

- `src/integrations/codex/` 分别维护 Bridge、thread manager、turn registry 和
  Codex backend adapter。
- `src/features/sidebar/chat/TurnCoordinator.ts` 通过 application backend
  manager 调用选中的 backend，不再直接调用 Codex Bridge。
- `src/domain/conversation.ts` 只定义持久化 contract；Codex thread/turn 字段
  作为 adapter metadata 保持兼容。
- `src/features/preferences/ui/providers/ProviderPanel.tsx` 统一管理 Codex CLI
  与 BYOK provider，不再存在 Codex-only Connection panel。
- `addon/prefs.js` 存储 Codex-specific model 和 reasoning prefs。
- locale strings 和 UI status names 使用 Codex-specific labels。

上述 migration targets 已完成；保留的 Codex-specific prefs 和 locale 只用于
Codex adapter 自身能力，不再决定整个 agent/backend 边界。

## 模块级目标结构

已落地的 module layout：

```text
src/
  domain/agent/                 # contracts、capabilities、errors、model catalog
  application/agent/           # BackendManager、BackendRegistry、prompt policy
  application/providers/       # profile service、repository、secret store、codec
  integrations/codex/          # Codex adapter、Bridge、thread/turn lifecycle
  integrations/byok/           # OpenAI-compatible adapter 与隔离 runtime
  integrations/mcp/            # paper_read 与 workspace binding
  features/sidebar/            # backend-neutral chat orchestration
  features/preferences/        # unified provider management
```

这是概念结构。最终文件拆分可以遵循本仓库既有风格，但 ownership 应保持
清晰：

- `types.ts`：稳定的 Zopilot-owned interfaces。
- `registry.ts`：将 configured backend/profile IDs 映射到 backend instances。
- `backendManager.ts`：selected backend resolution、lifecycle、shutdown。
- `capabilities.ts`：capability flags 和 provider support matrix。
- `errors.ts`：将 SDK/provider/Codex errors 映射为 Zopilot diagnostics。
- `modelCatalog.ts`：default provider presets 和 model metadata。
- `providerProfiles.ts`：profile validation、persistence、migration。
- `backendManager.ts` 也负责向 sidebar 和 preferences 发布 provider/model
  配置变更事件，避免两处 UI 各自维护状态。
- `codexCliBackend.ts`：existing Codex bridge 的 adapter。
- `openaiCompatibleAgentsBackend.ts`：OpenAI Agents SDK backed runtime。
- `paperReadTool.ts`：暴露给 agent runtime 的 Zopilot paper tool。
- `zopilotSession.ts`：Agents SDK session concepts 和 Zopilot conversation
  storage 之间的 adapter。
- `contextPolicy.ts`：history selection、truncation、future summarization。
- `backendDiagnostics.ts`：各 backend family 的 connection checks。

## AgentBackend contract

Backend contract 应保持小而产品导向：

- `id`：稳定的 backend 或 provider-profile ID。
- `label`：UI display label。
- `kind`：`codex-cli`、`openai-compatible` 或 future values。
- `capabilities`：streaming、tools、images、cancellation、model listing、
  reasoning、structured output、usage metadata。
- `checkStatus`：校验 local CLI 或 remote provider connectivity。
- `listModels`：可用时返回 normalized model entries。
- `sendPrompt`：启动一轮 turn，并通过 callbacks streaming text/tool status。
- `cancelTurn`：best-effort cancellation。
- `dispose`：释放 subprocesses、SDK clients、sessions 或 connections。

这个 contract 应避免 Codex terms，例如 `thread/start` 或 `turn/interrupt`。
必要时可以暴露 Zopilot-level `conversationId`、`runId` 和 `turnId`。

## Provider profiles

Provider profile 是用户可见的 BYOK 配置单元。一个 profile 应该独立，并可
跨 session 使用：

- profile ID；
- provider preset：DeepSeek、GLM/Z.AI、MiniMax；
- display name；
- Base URL；
- API key reference；
- default model ID；
- optional model list；
- capability overrides；
- timeout 和 retry policy；
- enabled/disabled state。

Provider group 是 preference 中的管理单元。一个 provider group 可以包含：

- 一个 backend kind，例如 `codex-cli` 或 `openai-compatible`；
- 一个 provider preset，例如 Codex CLI、DeepSeek、GLM/Z.AI、MiniMax；
- 一组 connection settings；
- 一个 available models cache；
- 一个 default model；
- 当前 connection status 和 last checked time；
- 多个 UI-visible actions：edit、delete、test connection、refresh models。

Codex CLI backend 在 migration 后应被建模为默认 provider group。这样用户在
Preference 中看到的是统一的 Provider 管理体验，而不是一个独立的 Codex
Connection 面板加另一套 BYOK 配置。

Preset providers 只应预填安全默认值，例如 label 和 Base URL。用户仍应可以
覆盖 model IDs 和 capability flags，因为 OpenAI-compatible provider behavior
并不完全一致。

本阶段不提供 arbitrary custom endpoint。这样可以把兼容性验证集中在少数
hosted providers 上，降低 local network、TLS、CORS/proxy、自签名证书、
私有部署认证方式和 provider-specific routing 的复杂度。未来若要支持
gateway 或 self-hosted endpoint，应作为单独 backend/profile family 重新评估。

API keys 不应被写入 logs、diagnostics exports、conversation files，也不应被
传入 prompts。若 Zotero extension environment 提供 platform protected
storage，应优先使用。若暂时不可用，应将 secrets 隔离在一个小的 storage
adapter 后面，以便后续升级存储机制而不影响 backend logic。

## OpenAICompatibleAgentsBackend

该 backend 是 BYOK 的核心实现。

职责：

- 根据 selected profile 创建 AI SDK OpenAI-compatible provider；
- 将该 model bridge 到 OpenAI Agents SDK；
- 构造带稳定 instructions 的 Zopilot research assistant agent；
- 挂载 Zopilot tools，例如 `paper_read`；
- 将 final assistant text streaming 回 sidebar；
- 观察 runtime events，用于 tool activity 和 diagnostics；
- 将 SDK run state 映射到 Zopilot turn state；
- 应用 timeout、retry 和 cancellation policy；
- 归一化 provider errors。

该 backend 应使用 OpenAI Agents SDK 执行 agent loop，而不是复制 agent
loop。除非遇到具体 compatibility bug，否则 Zopilot 不应手动解析 tool-call
deltas。

## Tool strategy

第一版优先将 `paper_read` 暴露为 Agents SDK function tool，而不是要求
model 使用现有 HTTP MCP endpoint。

理由：

- 避免假设所有 provider 都有一致的 MCP support；
- 降低 local HTTP authentication 和 binding complexity；
- 可以直接复用现有 paper context builder logic；
- 让 tool schema 由 Zopilot 统一控制；
- 更容易测试。

现有 MCP server 可以继续服务 Codex CLI。之后如果 Agents SDK MCP support
比 direct function tool 更有价值，Zopilot 可以把同一套 paper-read 能力同时
暴露到两条路径：

```text
paper context engine
        |
        +-- Codex MCP HTTP tool
        |
        +-- Agents SDK function tool
```

Tool output 应保持 evidence-oriented。Tool 返回 document context，agent
负责写答案。除非发生需要清楚解释的 failure，用户不应看到内部 tool
messages。

## Conversation 和 session model

Zopilot conversation storage 仍然是 source of truth。Agents SDK sessions 是
execution aid，不是产品数据库。

Migration direction：

- 保持 existing conversations readable；
- 在 Codex-specific fields 旁边或其替代位置加入 generic backend metadata；
- 保留 `codexThreadId` 和 `codexTurnId` 以保持 backward compatibility；
- 增加 generic fields，例如 backend ID、provider profile ID、backend run ID、
  backend turn ID、model 和 capability snapshot；
- 避免存储 API keys 或 raw provider request payloads。

对于 BYOK providers，baseline 不依赖 provider-side thread continuation。
通过 Zopilot local conversation history 和 `contextPolicy` 重建 context。

跨 provider/model 的 session history 兼容是核心要求：

- conversation 按 workspace 组织，不按 provider 或 model 组织；
- user messages、assistant messages、mentions、attachments 和 tool evidence
  使用 provider-neutral schema 存储；
- provider profile ID、backend ID、model ID、reasoning/capability snapshot
  是每条 assistant message 的 metadata；
- 切换 provider/model 后，sidebar 仍显示同一 conversation history；
- 继续对话时，`contextPolicy` 从同一 conversation 中选择可兼容的历史消息；
- 不把某个 provider 的 raw tool call payload、raw response item、opaque
  session ID 注入另一个 provider；
- 如果历史消息包含新 provider 不支持的能力，例如 image input、reasoning
  trace 或 provider-specific tool payload，应降级为文本摘要、忽略该内部字段，
  或给出明确 warning；
- Codex CLI 历史也应通过同一 generic metadata 进入 history 视图，但
  Codex-specific thread/turn IDs 只作为 legacy metadata 保存。

Session policy 需要回答：

- 包含多少 previous turns；
- 何时包含或 summarize tool outputs；
- attachments 如何引用；
- selected source mentions 如何保留；
- context overflow 如何处理；
- provider switch 后哪些历史内容可以直接重放，哪些必须 summarize 或跳过；
- future summarization 如何在不改变 UI 的前提下加入。

## Context management

OpenAI Agents SDK 可以辅助 sessions 和 run state，但 Zopilot 应拥有 context
budget policy，因为该策略是产品逻辑。

Initial policy：

- 始终包含稳定的 Zopilot developer instructions；
- 包含 current workspace identity；
- 包含 current user message；
- 包含 selected source mentions 和 local attachment descriptors；
- 包含 bounded recent history window；
- 对大型 document context 依赖 `paper_read`，而不是在 initial prompt 中注入
  full PDFs 或 long excerpts；
- 当 model context window 较小时 graceful failure。

Future policy：

- per-provider context window metadata；
- automatic history summarization；
- compacted tool evidence；
- per-workspace memory；
- model-specific prompt variants。

## Streaming 和 UI events

Sidebar 应消费 Zopilot-normalized events，而不是 SDK events。

建议 event categories：

- backend checking / connected / disconnected；
- run started；
- text delta；
- tool started；
- tool completed；
- notice；
- usage metadata；
- cancelled；
- completed；
- failed。

对于 Codex CLI，这些 events 来自 existing app-server notifications 的
adapter。对于 OpenAI Agents SDK，这些 events 来自 streamed run 和 item
events 的 adapter。

UI 应保留当前行为：visible answer text 和 tool activity 分离。Tool events
可以驱动 loading state、separators 或 small status notices，但 internal tool
payloads 应保持隐藏。

## Cancellation 和 interrupt semantics

Codex CLI 有特定的 `turn/interrupt` 概念。BYOK providers 通常没有。Zopilot
level contract 应将 cancellation 定义为：

- 立即停止消费 output；
- 尽可能 abort in-flight HTTP request 或 SDK stream；
- 将 local assistant message 标记为 interrupted；
- 不假设 remote provider 已停止 billing 或 computation；
- 除非 backend 可以安全恢复同一个 run state，否则未来 retry/resume 视为一个
  新的 Zopilot turn。

Agents SDK stream cancellation 和 `RunState` 可以在内部安全使用，但 UI 只
依赖 generic interrupted status。

## Error handling

将 backend errors 归一化为一小组 user-facing errors：

- missing Codex CLI；
- Codex not signed in；
- provider profile incomplete；
- invalid API key；
- provider unauthorized；
- model not found；
- tool calling unsupported；
- stream interrupted；
- rate limited；
- provider timeout；
- provider server error；
- network unavailable；
- unknown backend error。

详细 technical errors 写入 logs，但必须 redacted secrets。UI strings 应解释
下一步有用动作，而不是暴露 raw SDK/provider payloads。

## Preferences UX

当前 Connection preference panel 应合并进新的 Provider panel。Provider panel
是所有 AI backend/profile 的统一管理入口。

需要的 surfaces：

- selected active provider group；
- Codex CLI provider group，作为 default provider 和 optional local backend；
- BYOK provider group list；
- add/edit/delete provider group；
- test connection per provider group；
- available models query / refresh per provider group；
- model selection per provider group；
- capability indicators；
- API key entry；
- Base URL entry；
- 当 selected model 缺少 tool calling 或 streaming support 时给出 warning；
- migration notice，说明 Codex CLI 已变为 optional。

Provider panel 应替代原有 Connection panel 的诊断职责：Codex CLI 的检查、
BYOK provider 的连接测试、model list 查询、错误提示都在同一界面中完成。

Sidebar 输入框区域的 model selection 应显示 active provider group 下的模型。
它不应维护独立配置，而应订阅 provider profile store / backend manager 的
变更。Preference 中新增、删除、修改 provider group，刷新 models，或切换
default model 后，sidebar model selector 应实时更新。

Sidebar footer 应显示 active provider/model，而不是 "Local Codex"。
Reasoning effort controls 只在 selected model/backend 声明支持时显示。

## Module refactor plan

### Phase 1: Create the generic agent boundary

- 新增 Zopilot-owned backend types 和 capability types。
- 将 existing Codex bridge 包装为 `CodexCliBackend`。
- 将 sidebar controller 改为依赖 `AgentBackend`，而不是
  `getCodexBridge()`。
- 在概念上将 view state 从 Codex connection 改名为 backend status。
- 保持 Codex users 的行为不变。

此阶段应是 behavior-preserving，风险较低。

### Phase 2: Generalize persistence and preferences

- 新增 provider/backend profile storage。
- 新增 selected backend/profile prefs。
- 新增 generic message metadata，同时保留 Codex fields。
- 为 existing conversations 和 prefs 加入 migration logic。
- 在适当位置将 locale strings 从 Codex-specific 改为
  backend/provider-neutral。
- 将 Codex CLI migration 为 default provider group。
- 建立 provider profile store 的 change notification 机制，供 preferences 和
  sidebar model selection 共用。

此阶段为 BYOK 做准备，但还不需要启用 BYOK。

### Phase 3: Add Provider preference panel

- 用 Provider panel 合并并替代原 Connection panel。
- 支持 Codex CLI provider group 的 connection check 和 model query。
- 支持 provider group list、active provider selection、edit/delete actions。
- 支持 connection status、last checked time 和 user-facing diagnostics。

阶段结束时，用户可以在统一入口管理当前 Codex CLI default provider，但 BYOK
provider 还不一定需要完整可用。

### Phase 4: Add OpenAI-compatible provider profiles

- 新增 provider profile creation 和 validation。
- 新增 DeepSeek、GLM/Z.AI、MiniMax 等 hosted OpenAI-compatible providers 的
  preset profiles。
- 通过新的 backend diagnostics layer 做 connection testing。
- 新增 manual model ID entry。
- 支持时新增 optional model listing。
- 暂不支持 arbitrary custom Base URL、local gateway 或 self-hosted endpoint。

阶段结束时，用户可以配置 BYOK，但 sidebar 还不一定需要使用它。

### Phase 5: Implement OpenAI Agents backend

- 新增 OpenAI Agents SDK dependency 和相关 provider adapter dependency。
- 新增 `OpenAICompatibleAgentsBackend`。
- 将 `paper_read` 作为 Agents SDK function tool。
- 将 Agents SDK streaming 和 tool events 映射到 Zopilot backend events。
- 实现 cancellation、timeout、retry 和 error normalization。
- 在 Zotero runtime compatibility 验证前，将 backend 放在 feature flag 后面。

这是风险最高的阶段，因为存在 runtime 和 bundling compatibility 风险。

### Phase 6: Wire BYOK into the sidebar

- 允许选择 BYOK provider profile 作为 active backend。
- 从 selected profile/backend 加载 model options。
- 将输入框 model selection 改为订阅 provider profile store / backend manager，
  与 Provider preference panel 实时同步。
- 当 active provider group 被删除、禁用或连接失败时，sidebar 应 fallback 到
  Codex CLI default provider 或要求用户重新选择。
- 通过 backend manager 发送 prompts。
- 在 assistant messages 上持久化 generic backend metadata。
- 保持 Codex CLI behavior 通过同一路径继续工作。

阶段结束时，Codex CLI 对普通使用应变为 optional。

### Phase 7: Harden provider compatibility

- 至少测试 DeepSeek、GLM/Z.AI 和 MiniMax。
- 验证 streaming、tool calling、model-not-found behavior、API key failure、
  rate limit、timeout 和 cancellation。
- 验证 provider/model switch 后的 history display 和 continue conversation
  行为。
- 验证 preference Provider panel 修改后 sidebar model selection 实时同步。
- 增加 provider-specific compatibility notes 和 safe defaults。
- 为 partial compatibility providers 增加 capability overrides。

### Phase 8: Polish and document

- 更新 README requirements，移除 mandatory Codex CLI。
- 编写 BYOK setup 文档。
- 编写 privacy 和 API key handling 文档。
- 编写 provider capability limitations。
- 增加 troubleshooting guidance。

## Runtime compatibility spike

在正式投入完整实现前，应先在 Zotero plugin environment 中做一个小型 spike：

- bundle OpenAI Agents SDK JS 和 AI SDK OpenAI-compatible provider；
- 验证 Zod version compatibility；
- 验证 global `fetch`、streaming、abort signals 和 async iterables；
- 验证 SDK event streams 在 Zotero chrome context 中可用；
- 验证 bundle size 和 startup impact；
- 验证没有 Node-only APIs 泄漏到 browser-like plugin runtime；
- 验证在现有 unit test harness 下可测试。

如果 spike 失败，fallback options：

- 保留 `AgentBackend` 和 provider profile 工作；
- 直接使用 AI SDK，不经过 OpenAI Agents SDK；
- 只为 `paper_read` 实现一个 very small tool loop；
- 将 Agents SDK runtime 移到 local helper process。

Fallback 不应影响更高层的 refactor。

## Testing strategy

Unit tests：

- backend registry selection；
- provider profile validation；
- provider group create/update/delete；
- provider model cache refresh；
- provider profile store change notification；
- capability gating；
- preference migration；
- conversation metadata migration；
- provider-neutral conversation history selection；
- provider/model switch compatibility；
- error normalization；
- context policy；
- paper-read tool wrapper。

Integration-style tests：

- fake OpenAI-compatible provider with streaming text；
- fake tool-call flow for `paper_read`；
- fake provider errors：401、404 model、429、timeout、malformed stream；
- cancellation before first token；
- cancellation during tool call；
- Codex backend still works through the generic interface。

Manual QA：

- clean install with no Codex CLI；
- existing install with Codex CLI；
- switch from Codex backend to BYOK backend；
- switch between two BYOK profiles；
- switch model/provider and continue an existing conversation；
- view history created by a different provider/model；
- create/delete/update provider group in Preference and verify sidebar model
  selector updates immediately；
- refresh available models in Preference and verify sidebar model options
  update immediately；
- delete active provider profile；
- invalid Base URL；
- expired API key；
- provider without tool calling；
- provider with slow streaming。

## Privacy and security

BYOK 会改变 privacy model。Zopilot 必须明确说明：

- prompts、conversation history、selected paper context、tool outputs 和
  attachments 可能会发送到 selected provider；
- API keys 保持本地，不会发送给 Codex CLI 或其他 providers；
- provider profiles 相互独立；
- 切换 providers 不应泄漏某个 provider 的 key 或 state 到另一个 provider；
- 切换 providers 可以复用 conversation history，但只能发送
  provider-neutral、由 `contextPolicy` 选择后的上下文；
- logs 需要 redact API keys、Authorization headers、custom secret headers，
  以及必要时的 raw provider payloads；
- exported conversation files 不得包含 secrets。

## Risks

- OpenAI-compatible 不等于完全一致。Tool calling、streaming deltas、
  multimodal input、usage metadata 和 reasoning fields 都可能因 provider 而异。
- OpenAI Agents SDK 可能依赖一些在 Zotero 中需要 shim 或不好处理的 runtime
  features。
- Provider model lists 可能不可用或不一致。
- 某些 providers 可能接受 tool schemas，但在 streamed tool calls 阶段失败。
- 跨 provider/model 继续对话时，如果直接重放 provider-specific artifacts，
  可能导致上下文污染或兼容性错误。因此必须依赖 provider-neutral history
  schema 和 `contextPolicy`。
- Context windows 和 tokenizer behavior 不一致，会让 prompt budgeting 变得
  模糊。
- Zotero plugin 中的 API key storage 可能需要先做 pragmatic first version，
  再升级为更强的 storage adapter。
- 如果没有 generic backend vocabulary，Codex 和 BYOK 状态混在一起会让 UI
  copy 和 diagnostics 变得混乱。

## Decision summary

使用 OpenAI Agents SDK JS 作为 BYOK agent runtime，并通过 AI SDK 的
OpenAI-compatible provider adapter 支持 DeepSeek、GLM/Z.AI、MiniMax 等
明确验证过的 hosted provider profiles。Codex CLI 保留为独立 optional backend。Zopilot 自己的
`AgentBackend` interface 是架构边界，避免产品锁死在 Codex app-server 或
OpenAI Agents SDK internals 上。

第一版实现应保持保守：text streaming、local conversation history、
`paper_read` as a function tool、manual model IDs、best-effort cancellation，
以及 explicit capability flags。更高级的 MCP integration、provider-specific
model catalogs、context compaction、multimodal support、local gateway 和
self-hosted endpoint 可以在 runtime path 稳定后作为独立后续方案评估。
