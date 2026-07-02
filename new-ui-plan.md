# Zopilot New UI Plan

## 0. 执行目标

将 Zopilot UI 从当前 MVP 外挂 sidebar 迁移为成熟产品级 UI 架构。

这是一次 breaking UI architecture update，不以保留旧代码为目标。

最终目标是：

- 外层采用 Zotero 9 context-pane deck integration。
- 内部采用 Base UI + Zopilot UI Kit + static CSS tokens。
- 删除当前外挂 sidebar shell 和外层 Zopilot splitter。
- 消除 double-splitter 误触风险。
- 根除 native select hover alignment 等控件稳定性问题。
- 支持 attachment upload、reader content navigation、slash command、custom prompt、skill、ask/agent mode。

本计划应作为 AI agent 的执行任务书。

## 1. 总体架构

最终架构分为五层。

```text
Zotero 9 Context Pane Integration
Zopilot Deck Host
Zopilot UI Kit
Feature UI
Domain / Codex / Zotero Services
```

`Zotero 9 Context Pane Integration` 负责 Zotero 内部 DOM、context-pane deck、sidenav button、runtime probe、tab lifecycle、outer resize ownership。

`Zopilot Deck Host` 负责 React root、portal root、mount、render、focus、destroy。

`Zopilot UI Kit` 负责产品组件、Base UI wrappers、tokens、portal policy、focus policy、density、theme、state styling。

`Feature UI` 负责 Composer、MessageList、ModelPicker、CommandMenu、Prompt、Skill、Mode、Sources 等产品 surface。

`Domain / Codex / Zotero Services` 负责 workspace、conversation、reader、attachment、Codex bridge、preferences、storage。

禁止 Feature UI 直接操作 Zotero deck DOM。

禁止 Feature UI 直接 import Base UI。

禁止 UI Kit 调用 Codex bridge。

禁止 deck adapter 理解 model、prompt、skill、message 或 Codex turn。

## 2. 必须删除的旧路线

删除当前 append 到 `tabs-deck` parent 的外挂 Zopilot sidebar shell。

删除当前 `#zopilot-sidebar-splitter`。

删除当前外层 standalone sidebar width ownership。

删除 native select sizing helper。

删除 `ComposerSelect`。

删除 `getComposerSelectInlineSize`。

删除基于 `ch` 的 select width 估算测试。

删除 ad hoc popover/menu/mention 定位逻辑。

删除依赖 root click 统一关闭所有浮层的模式。

删除不再使用的大平面 CSS 片段。

删除旧 shell resize tests。

旧代码如果阻碍新架构，应直接替换，不做兼容层。

## 3. Zotero 9 Deck Integration

Zopilot 不再作为第二个 sidebar。

Zopilot 成为 Zotero native right context pane 内的 full-height deck。

目标 DOM 结构：

```text
#zotero-context-pane
└── #zotero-context-pane-inner <context-pane>
    └── #zotero-context-pane-deck
        ├── #zotero-context-pane-item-deck
        ├── #zotero-context-pane-notes-deck
        └── #zopilot-context-pane-deck
```

`#zopilot-context-pane-deck` 必须是 `#zotero-context-pane-deck` 的 direct child。

Zopilot panel 必须 full height。

Zopilot panel 外层默认不滚动。

Message list 拥有内部 vertical scroll。

Composer 固定在 Zopilot surface 内部。

外层 resize 只由 Zotero native context-pane splitter 负责。

Zopilot 不得设置外层 pane width。

Zopilot 不得覆盖 Zotero splitter。

Zopilot 内部 splitters 只能存在于 panel 内部，且不得靠近 Zotero context splitter。

## 4. ContextPane Adapter

新增 `ContextPaneDeckAdapter`。

职责：

- runtime probe Zotero 9 context pane structure。
- 创建 `#zopilot-context-pane-deck`。
- append panel 到 `#zotero-context-pane-deck`。
- 管理 selected panel switching。
- 维护 adapter active state。
- 处理 tab select/load/close。
- fail closed。

不得调用 `contextPane.mode = "zopilot"`。

Zotero 当前 `ContextPane.mode` 只支持 `item` 和 `notes`。

激活 Zopilot 时使用：

```text
contextPaneDeck.selectedPanel = zopilotPanel
```

切回 item 时选择 `#zotero-context-pane-item-deck`。

切回 notes 时选择 `#zotero-context-pane-notes-deck`。

Adapter active state 使用：

```text
item | notes | zopilot
```

该状态只属于 adapter，不写入 Zotero native mode。

## 5. Runtime Probe

mount 前必须 probe：

- `#zotero-context-pane`
- `#zotero-context-pane-inner`
- `#zotero-context-pane-deck`
- `#zotero-context-pane-item-deck`
- `#zotero-context-pane-notes-deck`
- `#zotero-context-pane-sidenav`
- top deck 是否支持 `selectedPanel` 或 selected index assignment
- notes deck 是否是 top deck direct child
- sidenav 是否存在 notes button 或 expected notes wrapper

任一 required probe 失败时：

- 不创建 panel。
- 不创建 sidenav button。
- 不 mount React。
- 记录 Zotero version。
- 记录 missing selector。
- 返回 structured unavailable result。

Fallback 必须显式。

禁止半挂载。

## 6. Sidenav Adapter

新增 `ContextPaneSidenavAdapter`。

职责：

- 注入 Zopilot sidenav button。
- 管理 selected visual state。
- 管理 aria state。
- 处理 click 和 keyboard activation。
- 监听 Zotero sidenav re-render 或 DOM move。
- 必要时 reinsert button。
- destroy 时完整清理。

Zotero notes button 是 hardcoded `data-pane="context-notes"`。

`sidenav.addPane()` 面向 item-details scrollable section，不适合 Zopilot full-height deck。

因此不要用 `sidenav.addPane()` 作为 Zopilot 主入口。

建议 Zopilot button：

- `data-pane="zopilot-context"`
- `role="tab"`，如果参与 Zotero tablist
- keyboard focusable
- localized label 或 tooltip
- 20px sidenav icon slot
- light/dark icon variants 如有需要
- selected 时 `aria-selected="true"`

Zopilot button 不应伪装成普通 item section button。

它的行为是 deck switch。

## 7. Deck Host

新增 `ZopilotDeckHost`。

职责：

- 接收 adapter 创建的 panel。
- 创建 React mount node。
- 创建 portal root。
- 安装 chrome window globals。
- 创建 React root。
- render Zopilot app。
- expose `open()`、`focus()`、`refreshContext()`、`destroy()`。
- destroy 时先 unmount React root。

Deck Host 不负责 Zotero outer width。

Deck Host 不创建 resize handle。

Deck Host 不管理 popover open state。

Deck Host 不理解 messages、models、skills。

Portal root 必须位于 Zopilot panel 内。

禁止 Base UI floating surfaces 默认 portal 到 `document.body`。

## 8. Chrome Window Globals

新增或重构 `installChromeWindowGlobals`。

必须从 mount node owner window 安装 globals。

必须在 dynamic import React DOM 前执行。

至少覆盖：

- `window`
- `self`
- `document`
- `navigator`
- `Node`
- `Element`
- `HTMLElement`
- `SVGElement`
- `Document`
- `DocumentFragment`
- `ShadowRoot`
- `Event`
- `EventTarget`
- `MouseEvent`
- `KeyboardEvent`
- `PointerEvent`
- `FocusEvent`
- `InputEvent`
- `CustomEvent`
- `MutationObserver`
- `ResizeObserver`
- `IntersectionObserver`
- `DOMRect`
- `NodeFilter`
- `requestAnimationFrame`
- `cancelAnimationFrame`
- `getComputedStyle`

该模块属于 integration layer。

## 9. UI 技术路线

内部 UI 使用：

```text
Base UI + Zopilot UI Kit + static CSS tokens
```

Base UI 只作为 headless interaction primitives。

Zopilot UI Kit 是唯一 public UI entry。

Feature UI 不得直接 import Base UI。

允许：

```ts
import { Select, Dialog, CommandMenu } from "../ui";
```

禁止：

```ts
import * as Select from "@base-ui/react/select";
```

UI Kit 负责：

- Base UI wrapper
- tokens
- portal container
- focus behavior
- modal policy
- keyboard interaction
- density
- theme
- component states

Feature UI 负责 product composition。

## 10. Static CSS Tokens

Static CSS tokens 是核心模块，不是补丁。

Tokens 覆盖：

- color
- background
- border
- shadow
- radius
- spacing
- typography
- line-height
- focus ring
- motion
- z-index
- density
- component states

Tokens 应映射 Zotero system colors 和 Zotero theme variables。

必须支持 light mode。

必须支持 dark mode。

必须考虑 macOS、Windows、Linux。

未定义 token 视为 bug。

Feature CSS 不写 raw color。

Feature CSS 不临时拼装复杂 `color-mix`。

## 11. CSS Scope

Zopilot deck CSS 必须限定在：

```text
#zopilot-context-pane-deck
.zp-root
UI Kit component classes
```

禁止全局污染 Zotero item deck。

禁止全局污染 Zotero notes deck。

禁止全局改写 Zotero sidenav buttons。

只允许针对注入的 Zopilot button 写 integration style。

Zotero chrome 对齐使用 Zotero variables。

Zopilot 产品视觉使用 static CSS tokens。

## 12. Portal Policy

所有 floating UI 使用 Zopilot panel 内 portal root。

包括：

- Select popup
- Combobox popup
- Menu
- Popover
- Dialog
- Tooltip
- Toast
- CommandMenu

禁止依赖 Base UI 默认 portal fallback。

Modal Dialog 必须限制 scroll lock 范围。

避免锁定 Zotero document body。

Portal z-index 使用 tokens。

Portal 不得遮挡 Zotero context splitter。

Portal 不得破坏 Zotero chrome tab order。

## 13. UI Kit Components

第一批 UI Kit components：

- Button
- IconButton
- Tooltip
- Select
- Menu
- Popover
- Dialog
- AlertDialog
- Combobox
- CommandMenu
- Tabs
- ToggleGroup
- Switch
- Checkbox
- TextField
- TextArea
- Field
- Progress
- Toast
- Badge
- Chip
- ScrollArea
- Toolbar
- List
- ListItem

每个组件必须定义：

- props
- states
- keyboard behavior
- token usage
- portal usage
- modal policy
- disabled behavior
- focus behavior

## 14. Product Components

重建产品组件：

- ZopilotSurface
- SurfaceHeader
- WorkspaceSelector
- SessionMenu
- MessageList
- MessageItem
- Composer
- ComposerToolbar
- SourceMentionPicker
- ModelPicker
- ReasoningPicker
- CommandMenu
- ModeSwitch
- PromptPicker
- SkillList
- StatusToastHost

这些组件只依赖 UI Kit 和 domain hooks。

Zotero side effects 不进入纯 UI component。

Codex bridge 不进入 UI Kit。

## 15. Select Migration

Model 和 reasoning controls 必须从 native select 迁移到 UI Kit Select。

删除 native select styling hack。

Select trigger 自绘：

- text
- icon
- hover state
- focus state
- selected state
- disabled state

Select popup 由 Base UI 管理：

- keyboard navigation
- selection
- typeahead 如适用
- outside click
- Escape

Select popup 渲染到 Zopilot portal root。

支持 long label。

支持 CJK。

支持 compact density。

该迁移必须根除 model hover alignment bug。

## 16. Floating Surfaces Migration

Session popover 迁移到 Menu 或 Popover。

Context popover 迁移到 Popover。

Workspace selector 迁移到 Menu、Popover 或 Combobox composition。

Mention picker 迁移到 Combobox。

Slash command 迁移到 CommandMenu。

所有 floating surfaces 必须有明确 close contract：

- Escape
- outside click
- blur
- selection
- tab switch
- deck inactive

禁止继续手写 fixed inset、ad hoc z-index、manual max-height。

## 17. Composer

Composer 是主要交互中心。

第一阶段继续使用 textarea。

暂不引入 rich text editor。

Composer 必须支持：

- stable textarea layout
- toolbar
- source mention
- slash command
- model picker
- reasoning picker
- mode switch
- attachment action
- custom prompt action
- submit
- interrupt

Composer 应固定在 Zopilot surface 底部区域。

Message list 滚动不应移动 Composer。

## 18. Slash Command

实现 Command registry。

Command schema：

- id
- title
- description
- keywords
- icon
- category
- availability
- action
- optional confirmation

Search 支持：

- English
- Chinese
- alias
- fuzzy matching

Categories 至少包括：

- source
- reader
- attachment
- prompt
- skill
- session
- mode

Availability 根据 workspace、reader、busy、mode、selection、deck context 计算。

## 19. Custom Prompt

Custom prompt 是一等功能。

Prompt schema：

- id
- title
- body
- variables
- scope
- mode compatibility
- skill compatibility
- updated timestamp

支持：

- prompt selection
- prompt insertion
- apply prompt to current input
- prompt management dialog 或 settings surface
- variable validation

Prompt storage 不进入 UI Kit。

## 20. Skill

Skill UI 使用 registry/list/detail 模型。

支持：

- search
- category
- enable/disable
- status display
- configuration
- required context
- mode compatibility

Skill 执行状态体现在 message/tool activity UI。

不要向用户暴露无意义 internal tool noise。

Skill UI 使用 UI Kit List、Switch、Badge、Dialog、CommandMenu。

## 21. Mode

Ask/agent mode 是显式产品状态。

Mode UI 使用 ModeSwitch 或 SegmentedControl。

Mode 影响：

- Codex request parameters
- available commands
- allowed tools
- confirmation behavior
- UI copy
- progress display
- interrupt affordance

Ask mode 专注阅读和回答。

Agent mode 需要 permission、progress、confirmation、interrupt 入口。

Mode 是否持久化必须明确。

## 22. Attachment Upload

入口：

- Composer toolbar
- CommandMenu

文件选择首选 Zotero FilePicker。

不要把 browser file input 作为主路径。

Integration service 调用：

- `Zotero.Attachments.importFromFile`
- `Zotero.Attachments.linkFromFile`

UI 显示：

- pending files
- import progress
- success
- failure
- source availability after import

导入后刷新 source universe 和 workspace context。

Attachment API 不进入 UI Kit。

## 23. Reader Content Navigation

支持从回答证据跳转到 reader。

支持 locator：

- page
- figure
- table
- annotation
- retrieved chunk

Integration service 将 Zopilot locator 转换为 Zotero reader location。

已有 reader 时使用：

```ts
reader.navigate(location);
```

需要打开 reader 时使用：

```ts
Zotero.Reader.open(itemID, location, options);
```

UI 只暴露 action，不理解 Zotero reader location 内部细节。

## 24. Reader Toolbar

Reader toolbar 保持轻量。

Toolbar button 使用静态 DOM 或极小 React-free UI。

Toolbar button 只负责 open/focus Zopilot deck。

复杂菜单进入 Zopilot main surface。

继续使用：

```ts
Zotero.Reader.registerEventListener("renderToolbar", ...)
```

避免在 reader iframe 中挂完整 UI Kit。

## 25. State Boundary

Domain state：

- workspace
- conversation
- messages
- running turn
- models
- selected model
- reasoning effort
- source universe
- sessions
- Codex connection status

Transient UI state：

- popover open
- command highlighted row
- mention query
- toast queue
- dialog open
- composer draft

Deck active state 属于 deck adapter。

Conversation state 不依赖 deck selected state。

用户明确设置才进入 preferences 或 conversation metadata。

## 26. Focus And Accessibility

Keyboard interaction 是验收标准。

Select 支持 keyboard selection。

Menu 支持 keyboard navigation。

Combobox 支持 input、arrow keys、highlight、selection。

Dialog 支持 Escape 和 focus return。

Tabs、ToggleGroup、Switch 有语义状态。

Icon-only button 必须有 aria label。

不熟悉 icon 应有 Tooltip。

Focus ring 必须可见。

Disabled、busy、selected、active、invalid 必须语义和视觉一致。

Zopilot sidenav button 必须 keyboard reachable。

Zopilot active state 必须有 visual 和 aria 表达。

切回 item 或 notes 时不得 trap focus。

## 27. Tab And Layout Lifecycle

Reader tab select 时 Zopilot panel 保持可用。

Note tab 是否支持 Zopilot 由产品决定。

Library tab 默认不强制打开 context pane。

Tab close 时释放 tab-specific UI state。

Tab load/select 时同步 workspace context。

Stacked layout 下 Zotero 会移动 sidenav。

Adapter 必须在 sidenav DOM move 或 re-render 后 reconcile button。

Zopilot panel 不使用 fixed screen coordinates。

Panel 尺寸来自 Zotero context pane boundary。

## 28. Implementation Phases

### Phase 1: Deck Foundation

创建 `ContextPaneDeckAdapter`。

创建 `ContextPaneSidenavAdapter`。

创建 `ZopilotDeckHost`。

实现 runtime probe。

实现 fail closed。

实现 panel injection。

实现 sidenav button injection。

实现 selected panel switching。

实现 React root 和 portal root mount。

实现 destroy cleanup。

保留现有 UI 只作为临时迁移参考，不为其新增能力。

### Phase 2: UI Foundation

添加 `@base-ui/react`。

创建 UI Provider。

创建 static CSS tokens。

创建 `installChromeWindowGlobals`。

创建第一批 UI Kit components。

建立 import boundary。

建立 portal policy。

建立 CSS scope。

### Phase 3: Replace Fragile Controls

替换 model select。

替换 reasoning select。

替换 workspace selector。

替换 session menu。

替换 context popover。

替换 mention picker。

替换 buttons、tooltips、toasts。

删除 native select sizing。

删除 ad hoc floating logic。

### Phase 4: Rebuild Core Surface

重建 ZopilotSurface。

重建 SurfaceHeader。

重建 MessageList。

重建 MessageItem。

重建 Composer。

重建 ComposerToolbar。

重建 running state。

重建 session history。

重建 archive/restore flows。

### Phase 5: Add Product Capabilities

实现 slash command registry。

实现 custom prompt management。

实现 skill registry。

实现 ask/agent mode。

实现 attachment upload。

实现 reader navigation actions。

实现 source/prompt/skill/mode command categories。

### Phase 6: Remove Old Architecture

删除外挂 sidebar shell。

删除 `#zopilot-sidebar-splitter`。

删除旧 width preference 或迁移。

删除旧 CSS。

删除旧 popover/menu/mention helpers。

删除旧 select helpers。

删除 obsolete tests。

删除 unused helpers。

## 29. Testing Plan

Unit tests：

- command registry
- view model
- UI Kit component rendering
- portal container resolution
- long label
- CJK label
- mode availability
- prompt variable validation

Interaction tests：

- Select keyboard behavior
- Combobox keyboard behavior
- Dialog focus trap
- Escape close
- outside click
- Tooltip hover/focus
- CommandMenu search

Zotero runtime smoke：

- runtime probe success
- runtime probe failure
- open Zopilot from reader toolbar
- open Zopilot from context sidenav
- switch Zopilot to notes
- switch notes to Zopilot
- switch Zopilot to item info
- message scroll does not expose item sections
- context pane resize uses only native splitter
- no `#zopilot-sidebar-splitter` exists
- reader tab switch
- note tab switch
- library tab selection
- stacked layout
- dark mode
- light mode
- plugin unload cleanup

Regression tests：

- model hover alignment
- long model name
- narrow context pane
- portal not mounted to `document.body`
- focus returns after Dialog close
- no duplicate sidenav button after re-render

## 30. Acceptance Criteria

Zopilot appears as independent context-pane deck mode。

Zopilot is not an item-pane section。

Zopilot active 时填满 Zotero right context pane。

Message scroll 与 Zotero item sections 和 notes deck 隔离。

外层 pane 只存在 Zotero native splitter。

不存在 `#zopilot-sidebar-splitter`。

业务 UI 不直接操作 Zotero deck DOM。

Feature UI 不直接 import Base UI。

所有 floating surfaces 使用 Zopilot portal root。

Model hover alignment bug 被根除。

Long label 和 CJK 文本不破坏布局。

Command、Select、Combobox、Menu、Dialog 支持 keyboard interaction。

Dark/light theme 通过 static CSS tokens 工作。

Attachment upload 通过 Zotero integration service 实现。

Reader navigation 通过 Zotero integration service 实现。

Ask/agent mode 成为显式产品状态。

Runtime probe 失败时 fail closed。

Plugin unload 后无 orphaned panel、button、listeners、React root、portal root。

旧外挂 sidebar 架构被删除。

最终 UI 架构可作为长期产品级方案。
