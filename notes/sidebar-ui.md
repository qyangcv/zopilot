# Zopilot Sidebar Deck 方案

## 宏观技术路线

Zopilot sidebar 应从外挂 sidebar 迁移为 Zotero 9 context-pane deck integration。

目标不是 item-pane section，也不是第二个独立 sidebar。

Zopilot 应成为 Zotero 原生右侧 context pane 内的 full-height surface。

外层 resize 只由 Zotero native context-pane splitter 负责。

Zopilot 不再创建外层 sidebar splitter。

这从结构上消除 double-splitter conflict，而不是用样式覆盖。

目标结构是 `item deck + notes deck + zopilot deck`。

Zotero 负责 pane width、collapse state、stacked layout 和 context-pane placement。

Zopilot 只负责内部 layout、scroll、command surfaces 和 product components。

实现需要 Zotero 9 internal adapter，因为 Zotero 没有公开 API 注册 context-pane deck。

`Zotero.ItemPaneManager.registerSection()` 不是目标 API，它只创建 item pane 内的 scrollable section。

Adapter 必须 runtime-probe Zotero DOM 和 custom element shape。

结构不匹配时应 fail closed 或显式 fallback。

Base UI、Zopilot UI Kit 和 static tokens 只负责 Zopilot 内部 UI。

Deck adapter 属于 Zotero integration layer，不属于 UI Kit。

## Zotero 9 结构事实

Zotero 9 reader context pane 以 `#zotero-context-pane` 为外壳。

`#zotero-context-pane` 内包含 `#zotero-context-pane-inner`。

`#zotero-context-pane-inner` 是 `<context-pane>` custom element。

`<context-pane>` 内部创建 `#zotero-context-pane-deck`。

该 deck 当前包含 `#zotero-context-pane-item-deck`。

该 deck 当前也包含 `#zotero-context-pane-notes-deck`。

Notes 是 item deck 的 sibling，不是 item section。

这就是 notes 不会与 info、abstract、attachments、tags 等 sections 发生 scroll interference 的原因。

Zopilot 应复用同级 deck 模式。

## 目标 DOM 形态

Zopilot panel 应作为 `#zotero-context-pane-deck` 的 direct child。

建议 id 为 `zopilot-context-pane-deck`。

该 panel 是 Zopilot 的 full-height application surface。

React mount node 位于该 panel 内。

Portal root 位于该 panel 内。

Panel 创建后才创建 React root。

Panel 使用 Zotero chrome document 创建。

Panel 必须填满 selected deck viewport。

Panel 不设置外层 width。

Panel 不创建外层 resize handle。

Panel 不修改 Zotero splitter geometry。

## ContextPane mode 约束

Zotero 当前 `ContextPane.mode` 只支持 `item` 和 `notes`。

不要调用 `contextPane.mode = "zopilot"`。

不要 patch Zotero `modeMap`。

激活 Zopilot 时直接设置 `contextPaneDeck.selectedPanel = zopilotPanel`。

切回 item 时选择 `#zotero-context-pane-item-deck`。

切回 notes 时选择 `#zotero-context-pane-notes-deck`。

Adapter 自己维护 active state。

建议 active state 为 `item`、`notes`、`zopilot`。

该状态不能写入 Zotero 原生 mode。

## Sidenav 策略

Zotero reader 右侧 sidenav 是 `#zotero-context-pane-sidenav`。

它是 `<item-pane-sidenav>` custom element。

Notes button 是硬编码的 `data-pane="context-notes"`。

Plugin sections 通过 item details 添加，行为不是 deck switch。

因此 Zopilot 不应依赖 `sidenav.addPane()` 作为主路径。

`sidenav.addPane()` 假设目标是 item-details 中的 scrollable pane。

Zopilot 是 full-height deck，点击行为应该是 deck switch。

Adapter 应注入独立 Zopilot sidenav button。

建议 button 使用 `data-pane="zopilot-context"`。

Button wrapper 应匹配 Zotero sidenav button 的结构和尺寸。

Button icon 使用 Zotero 20px sidenav slot。

Button 应有 localized label 或 tooltip。

Button 应支持 keyboard focus。

如参与 tablist，应设置 `role="tab"`。

仅当 Zopilot deck active 时设置 `aria-selected="true"`。

Active visual 应接近 Zotero notes selected treatment。

不要把 Zopilot 伪装为普通 item section button。

## Activation flow

从 reader toolbar 或 sidenav 打开 Zopilot 时，先确认当前 tab 是否支持 context pane。

若当前 tab 不支持，显示 unavailable state 或无操作。

若 context pane collapsed，则打开 Zotero context pane。

使用 `ZoteroContextPane.collapsed = false` 或等价路径。

调用 `ZoteroContextPane.update()` 同步 layout。

选择 `zopilotPanel` 作为 `#zotero-context-pane-deck.selectedPanel`。

设置 Zopilot button selected。

清除 notes button selected。

清除 item group selected。

刷新当前 reader 或 note context。

渲染 Zopilot React app。

根据入口决定 focus root、composer 或保持原 focus。

## Switching flow

用户点击 notes 时，应允许 Zotero 原生 handler 切换到 notes deck。

用户点击 item sections 时，应允许 Zotero 原生 handler 切回 item deck 并 scroll to pane。

Adapter 应监听这些切换并清除 Zopilot active state。

Adapter 不应阻止 Zotero 原生 notes、item、locate、toggle pane 行为。

若 selected panel 不再是 Zopilot panel，Zopilot sidenav button 必须取消 selected。

Zopilot React root 可以保持 mounted，但不应抢 focus。

产品上可决定 inactive 时是否暂停 streaming UI update。

## Lifecycle

每个 Zotero main window 创建一个 deck adapter。

Plugin mount 时注册 adapter。

Plugin unload 时 destroy adapter。

Destroy 顺序应先 unmount React root。

然后移除 Zopilot panel。

然后移除 Zopilot sidenav button 和 wrapper。

然后移除 event listeners。

然后断开 MutationObserver。

最后清空 chrome window、document 和 DOM references。

不得留下 detached React root。

不得留下 orphaned portal root。

不得留下重复 sidenav button。

## Runtime probe

Mount 前必须执行 runtime probe。

Probe `#zotero-context-pane`。

Probe `#zotero-context-pane-inner`。

Probe `#zotero-context-pane-deck`。

Probe `#zotero-context-pane-item-deck`。

Probe `#zotero-context-pane-notes-deck`。

Probe `#zotero-context-pane-sidenav`。

Probe top deck 是否支持 `selectedPanel` 或 selected index assignment。

Probe notes deck 是否是 top deck 的 direct child。

Probe sidenav 是否有 notes button 或 expected notes wrapper。

任一 required probe 失败时，不得半挂载。

失败时记录 Zotero version、missing selector 和当前 integration mode。

Fallback 必须显式，而不是悄悄退回不完整 UI。

## Tab lifecycle

Zotero context pane 主要用于 reader 和 note tabs。

Library tab 默认隐藏 context pane。

Zopilot 不应在 library tab 强制打开 context pane，除非产品明确支持。

Reader tab select 时，Zopilot panel 应保持可用。

Note tab select 时，应由产品决定是否支持 Zopilot。

不支持时隐藏或 disable Zopilot sidenav button。

支持时刷新 workspace context。

Tab close 时释放 tab-specific UI state。

Tab load/select 时同步 deck active state。

不要假设全局只有一个 reader。

必要时使用 Zotero selected tab ID 作为 context key。

## 数据边界

Deck adapter 只决定 Zopilot 挂载在哪里。

Deck adapter 不理解 model、prompt、skill、messages 或 Codex turn。

Sidebar controller 或后续重命名的 surface controller 负责 workspace context。

React app 负责 product UI。

UI Kit 负责 controls。

Reader APIs 放在 Zotero integration services。

Attachment APIs 放在 Zotero integration services。

Codex bridge 不进入 deck adapter。

## Scroll model

Zopilot panel 外层应 full height。

外层 panel 默认不滚动。

Message list 拥有 vertical scroll。

Composer 固定在 Zopilot surface 内部。

Header 和 toolbar 不应随 message list 滚动。

滚动消息时不得露出 item sections。

滚动消息时不得影响 notes deck scroll state。

## Portal model

Zopilot floating UI 必须挂到 panel 内的 portal root。

Select、Menu、Popover、Dialog、Tooltip、Toast、CommandMenu 都使用该 portal root。

不要默认 portal 到 Zotero document body。

Portal root 随 panel lifecycle 创建和销毁。

Portal z-index 使用 Zopilot tokens。

Portal 不应遮挡 Zotero context splitter。

Portal 不应破坏 Zotero tab order。

## Focus model

从 sidenav 打开 Zopilot 时，focus composer 或 first meaningful control。

从 reader toolbar 打开 Zopilot 时，可根据 command intent focus composer。

切回 item 或 notes 时，Zopilot 不得 trap focus。

Escape 优先关闭 Zopilot transient surfaces。

没有 transient surface 时再交还 Zotero chrome。

Tab 和 Shift-Tab 必须与 Zotero chrome focus order 协调。

Zopilot sidenav button 必须 keyboard reachable。

Selected state 必须同时有视觉和语义表达。

## Stacked layout

Zotero stacked layout 会移动 `#zotero-context-pane-sidenav`。

Adapter 必须能在 sidenav 被移动后继续工作。

若 sidenav re-render 导致 button 丢失，adapter 应 reconcile 并重新插入。

Zopilot panel 在 standard 和 stacked layout 下都必须填满 context pane。

Panel 不得假设右侧水平布局。

Panel 不得使用 fixed screen coordinates。

Panel 尺寸应来自 Zotero context pane boundary。

## Resize ownership

只有 Zotero context splitter 控制外层 pane size。

Zopilot 读取 available size，不写外层 size。

Deck 方案必须删除当前 `#zopilot-sidebar-splitter`。

Deck 方案必须删除当前 append 到 `tabs-deck` parent 的外挂 shell。

旧 standalone sidebar width preference 应移除或迁移。

Zopilot 如需内部 split areas，只能在 panel 内实现。

内部 splitter 不得靠近或覆盖 Zotero context splitter。

## Styling

Zopilot deck CSS 必须限定在 `#zopilot-context-pane-deck` 或 Zopilot root class 下。

不要全局修改 Zotero sidenav buttons。

只允许针对注入的 Zopilot button 写样式。

Zotero chrome 对齐使用 Zotero system variables。

Zopilot 产品 UI 使用 static CSS tokens。

Panel background 应与 Zotero sidepane material 协调。

内部 UI 可以有自己的 density 和 visual hierarchy。

CSS 不得泄漏到 item deck 或 notes deck。

## Icon

Sidenav icon 使用 chrome URL asset。

Icon 尺寸按 Zotero 20px sidenav slot 准备。

需要时提供 light/dark variants。

如使用 `-moz-context-properties`，应遵循 Zotero icon pattern。

避免在 sidenav 中使用 inline SVG hack。

Active visual 应接近 Zotero notes selected style。

## 模块拆分

建议拆分为 `ContextPaneDeckAdapter`。

该模块负责 DOM probe、panel injection 和 selected panel switching。

建议拆分为 `ContextPaneSidenavAdapter`。

该模块负责 button injection、selected state 和 reinsert/reconcile。

建议拆分为 `ZopilotDeckHost`。

该模块负责 React root、portal root、mount、render、focus 和 destroy。

现有 SidebarController 可重命名或收缩为 surface controller。

Surface controller 负责 workspace context 和 product state。

该拆分避免 Zotero DOM code 泄漏到 product components。

## Mount algorithm

查找 required Zotero nodes。

Runtime probe 失败则返回 structured unavailable result。

创建 Zopilot panel。

将 panel append 到 `#zotero-context-pane-deck`。

创建 React mount node。

创建 portal root。

插入 Zopilot sidenav button wrapper。

绑定 pointer 和 keyboard activation。

绑定 selected-panel reconciliation。

Mount React root。

Render initial state。

暴露 `open()`、`closeToItem()`、`focus()`、`refreshContext()`、`destroy()`。

## Open algorithm

检查当前 Zotero tab type。

不支持时进入 unavailable behavior。

打开 Zotero context pane。

选择 Zopilot panel。

设置 Zopilot button selected。

清除 notes 和 item group selected。

刷新 reader 或 note context。

渲染 Zopilot app。

执行 focus policy。

调用 Zotero layout update methods。

## Reconciliation algorithm

观察 `#zotero-context-pane-deck` selected panel 变化。

监听 notes 和 item buttons click。

监听 Zotero tab select/load。

Selected panel 不是 Zopilot 时，清除 Zopilot active state。

当前 tab 不支持 Zopilot 时，隐藏或 disable button。

Sidenav 重建后，重新插入 button。

Panel 被 Zotero 移除时，unmount 并标记 adapter unavailable。

## Testing

测试从 reader toolbar 打开 Zopilot。

测试从 context sidenav 打开 Zopilot。

测试 Zopilot 到 notes。

测试 notes 到 Zopilot。

测试 Zopilot 到 item info。

测试 Zopilot message scroll 不暴露 item sections。

测试 Zotero context pane resize 只存在 native splitter。

测试 deck route 下不存在 `#zopilot-sidebar-splitter`。

测试 reader tab switch。

测试 note tab switch。

测试 library tab selection。

测试 stacked layout。

测试 dark/light mode。

测试 plugin unload 清理 panel、button、listeners 和 React root。

测试 runtime probe failure path。

## 验收标准

Zopilot 是独立 context-pane mode，不是 item section。

Zopilot active 时填满右侧 context pane。

Zopilot message scroll 与 Zotero item sections 隔离。

外层 pane 只存在 Zotero native splitter。

Zopilot deck 可跨 reader tab 切换稳定工作。

Standard 和 stacked layout 都可用。

Zotero 内部结构不匹配时 adapter fail closed。

业务 UI 不直接操作 Zotero deck DOM。

Deck adapter 是唯一 Zotero context-pane internal integration owner。
