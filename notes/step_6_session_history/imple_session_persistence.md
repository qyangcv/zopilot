# Step 6 session persistence implementation

Last updated: 2026-06-09

## Current status

Step 6.1 paper chat 持久化主路径已实现。Step 6.2 多 session UI 已实现。

Step 6.1 当前完成的闭环：

```text
active PDF reader -> paperKey -> ConversationStore -> Codex non-ephemeral thread -> sidebar render
```

## Step 6.1 implemented

### Stable paperKey

`src/zotero/contextGateway.ts` 现在在 active PDF reader scope 中返回 `parentItemKey`。

`src/shared/conversation.ts` 新增 `createPaperIdentity(scope)`：

```ts
paperKey = `${libraryID}:${parentItemKey}`;
```

这使 conversation 按 regular item 隔离，而不是按 attachment `itemID` 隔离。

### ConversationStore

新增 `src/store/conversationStore.ts`。

职责：

- `getOrCreateLatestPaperConversation(paper)`：打开 paper chat 时加载最近未归档 conversation，没有则创建。
- `getLatestPaperConversation(paperKey)`：按 `updatedAt` 找最近 conversation。
- `addMessage(metadata, input)`：保存 user / assistant message，更新 `updatedAt`、`latestPreview`，第一条 user message 会生成 label。
- `updateCodexThreadId(metadata, threadId)`：保存 Codex runtime thread id。

落盘位置：

```text
<zotero-profile>/zotero-copilot/conversations/papers/<encoded paperKey>/
  <conversationId>.json
  <conversationId>.jsonl
```

代码中的根目录来自：

```ts
PathUtils.join(
  Zotero.getProfileDirectory().path,
  "zotero-copilot",
  "conversations",
);
```

也就是说，session history 不写入 repo，也不写入 `~/.codex`，而是写入当前 Zotero profile 目录。每篇论文的子目录是：

```text
<Zotero profile>/zotero-copilot/conversations/papers/<encodeURIComponent(paperKey)>/
```

其中：

```ts
paperKey = `${libraryID}:${parentItemKey}`;
```

metadata 使用 JSON；messages 使用 JSONL。写入采用临时文件 + move 的简单原子替换路径。

### CodexBridge

`src/codex/bridge.ts` 已删除旧的单一进程级 `this.threadId` 逻辑。

当前行为：

- `prewarm()` 只启动 app-server。
- `sendPrompt()` 需要 `CodexPromptOptions.conversation`。
- 当前 conversation 有 `codexThreadId` 时调用 `thread/resume`。
- resume 失败时记录 log，并创建 replacement thread。
- 新 thread 使用 `thread/start`，参数包含 `ephemeral: false`。
- `thread/start` / `thread/resume` 都注入当前 Step 5 MCP config 和 developer instructions。
- turn 完成后返回 `threadId`，sidebar 将其写入 conversation metadata。

这满足 “Codex thread 使用 non-ephemeral thread，并能保存/恢复” 的 6.1 主路径。真实 app-server 重启后的恢复还需要 Zotero GUI/runtime 手测确认。

### Sidebar

`src/modules/sidebar/index.ts` 已从 DOM-only history 改为 persisted store state。

当前行为：

- 打开 sidebar 后自动解析 active PDF reader。
- 没有 active PDF reader 时显示不可用状态，并禁用 composer。
- 有 active paper 时按 `paperKey` 自动加载最近 conversation。
- header 显示 `paper title / session label`。
- chat log 从 `Conversation.messages` 渲染。
- 提交时先保存 user message。
- Codex 完成后保存 assistant message、`codexThreadId`、`codexTurnId`。
- Codex 出错时保存 assistant error message。
- tab/focus 切换时重新加载当前 reader 的 paper conversation。
- Codex 正在回答时不重载 conversation，避免覆盖当前 turn 的临时输出。

### Locale and generated typing

新增文案：

- `sidebar-loading-conversation`
- `sidebar-unavailable-message`

`typings/i10n.d.ts` 已由 build 更新。

## Acceptance checklist

已由代码和自动测试覆盖：

- 每篇论文有稳定 `paperKey`。
- message、conversation id、paperKey、timestamp 会持久化。
- Codex thread id 会写入 conversation metadata。
- `thread/start` 使用 `ephemeral: false`。
- sidebar 渲染持久化 history，而不是内存 DOM。
- A/B 两篇论文 history 隔离。

仍需 Zotero runtime 手测：

- 重新打开同一篇 PDF 后恢复历史记录。
- Zotero 重启后恢复 UI history。
- app-server 重启后通过 `thread/resume` 恢复 Codex thread。
- resume 失败时能创建 replacement non-ephemeral thread 且 UI 不崩溃。

## Verification

已通过：

```text
npm run test:unit
npm run build
npm run lint:check
git diff --check
```

当前 unit 结果：21 passing。

新增测试：

```text
unit/store/conversationStore.test.ts
```

覆盖：

- paper message 持久化。
- `codexThreadId` 持久化。
- A/B paperKey 隔离。
- 新 `ConversationStore` 实例可从磁盘恢复 conversation。

## Step 6.2 next

Step 6.2 已按最小实现完成，多 session UI 没有重新设计持久化底座。

当前实现：

1. 给 `ConversationStore` 增加 `listPaperConversations(paperKey)`、`createPaperConversation(paper)` 的 public API。
2. sidebar header 增加 `[history]` 和 `[+]`。
3. `history` popover 只列当前 `paperKey` 下的 sessions。
4. `+` 创建新 conversation 并切换。
5. 归档/删除只改 metadata 的 `archived`。
6. 点击 session 时更新 `updatedAt`，复用现有“最近 conversation”恢复规则。

不要在 Step 6.2 引入 global/library chat、MCP history tool、Zotero notes sync 或复杂 index。
