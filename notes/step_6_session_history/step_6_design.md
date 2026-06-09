# Step 6 session history design

Step 6 的目标是把 Zotero Copilot 从“当前 DOM 上的一次性聊天”推进到 paper-scoped durable conversation。当前已完成 Step 6.1；Step 6.2 多 session UI 仍待做。

## 当前结论

Step 6 不放进 MCP，也不让 sidebar 自己管理历史。MCP 继续负责 Step 5 的 `paper_read` 读取能力；conversation history 是 Zotero 侧的本地状态。

当前主链路：

```text
active PDF reader
  -> ZoteroContextGateway.getActivePaper()
  -> paperKey = `${libraryID}:${parentItemKey}`
  -> ConversationStore local files
  -> CodexBridge thread/start or thread/resume
  -> Sidebar renders persisted store state
```

## Step 6.1 已实现设计

### paper identity

主 key 使用：

```ts
paperKey = `${libraryID}:${parentItemKey}`;
```

不要只用 Zotero integer `itemID`。`parentItemKey` 对同一篇 regular item 更稳定，PDF attachment 换了也不会丢论文级 conversation history。

`ZoteroContextGateway.getActivePaper()` 现在返回：

- `libraryID`
- `parentItemID`
- `parentItemKey`
- `attachmentItemID`
- `attachmentKey`
- reader scope warnings

### local storage

当前实现放在 Zotero profile 下：

```text
<zotero-profile>/zotero-copilot/conversations/
  papers/
    <encoded paperKey>/
      <conversationId>.json
      <conversationId>.jsonl
```

v1 没有单独维护 `index.json`。`ConversationStore` 直接扫描当前 `paperKey` 目录下的 metadata JSON，按 `updatedAt` 找最近未归档 conversation。这样更符合 KISS，后续只有在 session 数量变大或列表性能成为问题时再加 index。

### data model

当前 metadata：

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
  label,
  createdAt,
  updatedAt,
  codexThreadId,
  codexSessionId,
  latestPreview,
  archived
}
```

当前 message：

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

### Codex thread policy

旧逻辑中 `CodexBridge` 只有一个进程级 `threadId`，并且 `thread/start` 使用 `ephemeral: true`。这条路径已经删除。

当前逻辑：

- `prewarm()` 只启动 app-server，不提前创建未绑定 thread。
- `sendPrompt()` 必须带 `ConversationMetadata`。
- 当前 conversation 有 `codexThreadId` 时先调用 `thread/resume`。
- 没有 `codexThreadId` 或 resume 失败时，调用 `thread/start` 并传 `ephemeral: false`。
- `thread/start` / `thread/resume` 都重新注入 Step 5 的 `mcp_servers` 和 `developerInstructions`。
- turn 完成后把返回的 `threadId` 写回 conversation metadata。

如果用户删除了 Codex 自己的 session 文件，`thread/resume` 无法恢复模型内部上下文；此时 Zotero 的 JSONL 仍能恢复 UI history，继续发送会创建新的 non-ephemeral thread 并写回 metadata。历史注入或 summary fallback 留到后续阶段。

### Sidebar render policy

旧逻辑是 submit 后直接 append DOM message。这个逻辑已经替换。

当前逻辑：

- sidebar 打开后解析当前 PDF reader 的 paper scope。
- 无 active PDF reader 时显示不可用状态并禁用 composer，不进入 global chat。
- 有 active paper 时调用 `ConversationStore.getOrCreateLatestPaperConversation()`。
- chat log 每次从 `Conversation.messages` 重建。
- 用户提交时先保存 user message，再调用 Codex。
- assistant 完成或出错后保存 assistant message，再重新从 store state 渲染。
- tab/focus 切换时重新解析当前 reader；Codex 正在回答时不切换 conversation，避免覆盖当前 turn。

## Step 6.2 待实现设计

Step 6.2 在当前持久化基础上增加同一 paper 的多 session UI。

按钮入口放在 sidebar header：

```text
[Zotero Copilot]
[paper title / session label]        [history] [+] [close]
```

预期行为：

- `history`：打开当前 `paperKey` 下的 session list popover。
- `+`：为当前 paper 创建 new chat，并切换为 active conversation。
- `close`：只关闭 sidebar，不改变 active session。
- session 标题先用第一条 user message 截断生成；没有消息时用创建时间。
- 点击 session 切换 active conversation，并重新渲染历史。
- 删除/归档只影响当前 `paperKey` 下的 session。
- 重新打开 paper 时默认恢复最近 active session。

## 当前不做

- 不做 global/library chat。
- 不做跨论文搜索历史。
- 不同步到 Zotero notes。
- 不把 conversation history 暴露成 MCP tool。
- 不做复杂 trace store；tool noise 和 tool trace 展示留到 Step 7 或后续。
- 不做 Codex thread 丢失后的 transcript summary/history injection fallback。

## 当前代码边界

已新增：

```text
src/shared/conversation.ts
src/store/conversationStore.ts
unit/store/conversationStore.test.ts
```

已修改：

```text
src/zotero/contextGateway.ts
src/zotero/types.ts
src/codex/bridge.ts
src/codex/types.ts
src/modules/sidebar/index.ts
addon/locale/en-US/addon.ftl
addon/locale/zh-CN/addon.ftl
typings/i10n.d.ts
```

没有新增 `PaperSessionManager`、`conversationPaths.ts`、`conversationIndex.ts`、`threadSession.ts` 或 `conversationController.ts`。当前实现刻意保持 KISS，等 Step 6.2 真的需要拆分时再抽模块。
