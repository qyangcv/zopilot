结论：`llm-for-zotero` 不是“不用 MCP/tool”，也不是靠一条可见 prompt 禁止模型提及 internal workflow。它的核心设计是：工具能力通过 Codex thread config 暴露，固定行为和工具使用策略尽量放在 hidden instructions 中。

**llm-for-zotero 设计**

1. 固定提示词走 `developerInstructions`

`llm-for-zotero` 会从 `system` 消息中提取 developer instructions，并从 visible messages 中过滤掉 system 消息：[codexAppServerInput.ts](/tmp/llm-for-zotero-current/src/utils/codexAppServerInput.ts:535)。随后在 `thread/start` 中传 `developerInstructions`：[nativeClient.ts](/tmp/llm-for-zotero-current/src/codexAppServer/nativeClient.ts:1532)。

如果 app-server 不支持 `developerInstructions`，它才降级为 visible fallback：[nativeClient.ts](/tmp/llm-for-zotero-current/src/codexAppServer/nativeClient.ts:1567)。

2. MCP/tool 能力走 thread config

`llm-for-zotero` 会构造 Codex thread config，关闭 shell tool，并把 Zotero MCP server 注入 `config.mcp_servers`：[mcpSetup.ts](/tmp/llm-for-zotero-current/src/codexAppServer/mcpSetup.ts:528)。

3. 工具策略是“可用但不强制展示”

它的 Zotero 环境指令说明：Zotero resources 和 MCP tools 可在有用时使用，不是每次响应都必须调用；如果上下文足够，可以直接回答；论文内容再使用 `paper_read`：[nativeClient.ts](/tmp/llm-for-zotero-current/src/codexAppServer/nativeClient.ts:1376)。

**zotero-copilot 当前设计差异**

1. MCP 注入方式一致，但工具面更窄

`zotero-copilot` 也在 `thread/start` 中写入 `params.config.mcp_servers`：[bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:163)。当前 MCP 配置只暴露 `paper_read`：[mcpConfig.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/mcpConfig.ts:6)。

2. 固定提示词和路由提示集中在本项目的 developer instructions

`zotero-copilot` 现在用 `buildCodexDeveloperInstructions()` 维护语言策略、paper QA 策略、`paper_read` 路由，以及不要主动描述 MCP/tool/internal workflow 的输出边界：[developerInstructions.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/developerInstructions.ts:3)。`CodexBridge.ensureThread()` 会把它作为 `thread/start.developerInstructions` 传入：[bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:175)。

3. 可见用户 turn 只保留用户输入

`buildPaperQuestionPrompt()` 只返回用户问题本身：[promptBuilder.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/promptBuilder.ts:3)。sidebar submit 直接把这个最小 prompt 传给 `bridge.sendPrompt(prompt)`：[index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:561)。

一句话：两者的共同点是 MCP 通过 thread config 暴露，固定策略尽量隐藏；当前 `zotero-copilot` 的差异是只暴露一个 `paper_read` 工具，并把可见用户输入收窄到纯用户问题。
