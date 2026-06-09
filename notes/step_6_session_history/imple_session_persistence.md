# Step 6 session persistence plan

Step 6 不拆成多个零散任务。先做一个可用的 paper-scoped 持久化闭环，再加多 session 管理 UI。

## Step 6.1 paper chat 持久化主路径

目标：打开某篇 PDF 时，自动恢复该 paper 最近一次 conversation；发送消息后同时保存 Zotero 侧 transcript 和 Codex non-ephemeral thread id。

主链路：

```text
active PDF reader -> paperKey -> ConversationStore -> Codex thread -> sidebar render
```

按钮入口：

- Zotero 主窗口 toolbar / PDF reader toolbar button 只负责打开或关闭 Copilot sidebar。
- sidebar 打开后按当前 `paperKey` 自动加载最近 active conversation。
- sidebar header 显示当前 paper title 和当前 session label。
- 无 active PDF reader 时显示不可用状态；不在本阶段进入 global chat。

验收标准：

- 每篇论文有稳定 `paperKey`。
- message、conversation id、paperKey、timestamp、Codex thread id 会持久化。
- Codex thread 使用 non-ephemeral thread，并能保存/恢复。
- 重新打开同一篇论文时恢复历史记录。
- UI 渲染持久化历史，而不是内存 DOM。
- A/B 两篇论文历史隔离。
- Zotero 重启和 app-server 重启后可恢复。

## Step 6.2 当前 paper 的多 session UI

目标：在已经持久化的 paper chat 上，为同一篇论文支持新建、切换、删除/归档 sessions。

按钮入口放在 sidebar header：

```text
[Zotero Copilot]
[paper title / session label]        [history] [+] [close]
```

- `history`：打开当前 `paperKey` 下的 session list popover。
- `+`：为当前 paper 创建 new chat，并切换为 active conversation。
- `close`：只关闭 sidebar，不改变 active session。

session list 行为：

- 默认列出当前 paper 的 sessions。
- session 标题先用第一条 user message 截断生成；没有消息时用创建时间。
- 点击 session 切换 active conversation，并重新渲染历史。
- 删除/归档只影响当前 `paperKey` 下的 session。
- 重新打开 paper 时默认恢复最近 active session。

验收标准：

- 可以新建 session。
- 可以切换 session。
- 可以删除或归档 session。
- session 操作不会混淆不同 `paperKey`。
- thread id 丢失时退回新建 thread，不崩溃。

## 实现边界

- 当前阶段只做 paper chat；global/library chat 留到后续。
- history UI 不放到 Zotero/PDF reader toolbar，也不放到 composer context row。
- 按钮点击必须更新 active conversation 状态，并驱动 store、bridge、sidebar render 一起切换。
