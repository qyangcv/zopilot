我会把 Step 6 设计成三层，不把它塞进 MCP，也不让 sidebar 自己管历史。

**核心判断**

当前 [CodexBridge](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:34) 只有一个进程级 `threadId`，而且 `thread/start` 现在传的是 `ephemeral: true`。这对 Step 3/5 可以，但对长期会话不对。刚用本机 `codex app-server generate-ts/json-schema` 确认：app-server 协议有 `thread/resume`，`Thread.ephemeral` 的含义是“不落盘”。所以 Step 6 第一件事是：paper session 创建时用 non-ephemeral thread，并保存 `threadId`。

我建议 v1 的架构是：

```text
PDF reader current paper
  -> PaperSessionManager
  -> ConversationStore local files
  -> CodexBridge thread/start or thread/resume
  -> Sidebar renders store state
```

**本地存储**

不要用 Zotero prefs。prefs 适合小配置，不适合多篇论文、多 session、多轮 message。v1 我也不建议先上 SQLite，除非你已经需要复杂查询。你的需求是“每篇论文隔离 + 本地目录 + 重启不丢”，append-only JSONL 更直接、可调试、容易迁移。

默认目录建议放在 Zotero profile / plugin data 下，而不是 repo 或 `~/.codex`：

```text
<zotero-profile>/zotero-copilot/
  conversations/
    index.json
    papers/
      <libraryID>-<parentItemKey>/
        <conversationId>.json
        <conversationId>.jsonl
```

`index.json` 用于快速列出某篇论文有哪些 sessions；每个 `conversationId.json` 是 metadata snapshot；`.jsonl` 是 message/turn event append log。写入策略是：用户消息提交时立即 append；assistant 在 `turn/completed` 后 append 完整文本、`turnId`、`threadId`，再原子更新 conversation metadata 的 `updatedAt` / title / latest preview。

**数据模型**

paper identity 不要只用 Zotero integer `itemID`。建议主 key 用：

```ts
paperKey = `${libraryID}:${parentItemKey}`;
```

同时 metadata 里保存 `parentItemID`、`attachmentItemID`、`attachmentKey` 作为本机快速回查和 debug 信息。这样同一 Zotero 库里同一篇 regular item 的 sessions 稳定隔离；PDF attachment 换了也不丢论文级 history。

conversation metadata 至少有：

```ts
{
  id,
  scope: "paper",
  paperKey,
  libraryID,
  parentItemID,
  parentItemKey,
  attachmentItemID,
  attachmentKey,
  title,
  createdAt,
  updatedAt,
  codexThreadId,
  codexSessionId,
  codexThreadPath,
  archived,
  deletedAt
}
```

message 记录至少有：

```ts
{
  id,
  conversationId,
  role: "user" | "assistant",
  text,
  createdAt,
  codexThreadId,
  codexTurnId,
  status: "complete" | "error"
}
```

**resume 流程**

打开 PDF reader 时：

1. `ZoteroContextGateway.getActivePaper(reader)` 得到当前 paper scope。
2. `ConversationStore.listByPaper(paperKey)` 加载该论文所有 sessions。
3. 默认选最近一个，或显示 session picker。
4. 选中 session 后调用 `CodexBridge.useConversation(conversation)`。
5. 如果有 `codexThreadId`，先走 `thread/resume`，并重新注入当前 Step 5 的 `mcp_servers` 和 `developerInstructions`。
6. 如果 resume 失败，UI history 仍然可见；继续对话时新建 non-ephemeral thread，并把新的 `threadId` 写回该 conversation，旧 `threadId` 保留为 `previousThreadIds` 用于诊断。

这能做到“像 Codex resume 一样自然”的主路径。需要坦率一点：如果用户手动删除了 Codex 自己的 session 文件，`threadId` resume 就无法恢复模型内部上下文；这时 Zotero 的 JSONL 只能保证 UI history 不丢。要做到模型上下文也尽量延续，v2 再做 transcript summary / history injection fallback。

**代码边界**

我会新增这些模块：

```text
src/shared/conversation.ts
src/store/conversationPaths.ts
src/store/conversationStore.ts
src/store/conversationIndex.ts
src/codex/threadSession.ts
src/modules/sidebar/conversationController.ts
```

然后改现有两处：

- [bridge.ts](/Users/yang/code/zotero/zotero-copilot/src/codex/bridge.ts:150)：把单一 `this.threadId` 改成“当前 conversation 的 threadId”，支持 `startThread({ ephemeral: false })` 和 `resumeThread(threadId)`。
- [sidebar/index.ts](/Users/yang/code/zotero/zotero-copilot/src/modules/sidebar/index.ts:553)：不要直接 append DOM message 后就忘掉，而是先写 store，再由 store state render 出 message list。

**v1 不做**

不做 library/global chat。
不做跨论文搜索历史。
不做同步到 Zotero notes。
不把 conversation history 暴露成 MCP tool。
不做复杂 trace store，tool noise 仍按 Step 7 再处理。

**实施顺序**

1. 先做 `ConversationStore` 文件读写、atomic write、按 paperKey list。
2. 改 `CodexBridge`：支持指定 conversation、non-ephemeral start、`thread/resume`。
3. 改 sidebar：打开 reader 时加载当前论文 sessions；提交/完成时写入 store。
4. 加新建、切换、删除 session UI。
5. 测试 A/B 两篇论文隔离、Zotero 重启恢复、Codex app-server 重启后 resume。

这个设计和当前 roadmap 的 Step 6 一致，但要把 “保存 thread id” 升级成 “Zotero 侧 conversation index + Codex non-ephemeral threadId + 本地 transcript mirror”。这样才不会把所有可靠性押在 Codex 内部 session 文件上。
