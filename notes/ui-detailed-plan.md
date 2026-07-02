# Zopilot UI 详细方案

## 1. 定位

本方案定义 Zopilot active surface 内部 UI 的最终架构。

外层 Zotero 9 context-pane deck 集成由 `notes/sidebar-ui.md` 定义。

因此，本文件不再把 Zopilot 视为外挂 sidebar shell。

本文件中的 sidebar、surface、panel 均指 Zopilot 在 deck 内部的产品 UI。

目标路线为 Base UI + Zopilot UI Kit + static CSS tokens。

迁移目标是清除当前 MVP UI technical debt，而不是做临时样式修补。

旧 UI 如果阻碍最终架构，应删除并重建。

## 2. 当前问题

当前 UI 已能支撑 MVP，但不适合作为长期产品基础。

`model` hover 文本无法居中，根因是 native select 被样式魔改。

Native controls 在 Zotero chrome、Gecko、平台主题、字体和缩放下都难以稳定控制。

Popover、menu、mention、session list 依赖手写 DOM 状态和 CSS 定位。

Focus、keyboard、outside click、Escape、portal 和 z-index 没有统一策略。

CSS 文件偏平，tokens 不完整，状态样式散落。

UI logic、Zotero integration、Codex session 和 domain state 耦合较重。

继续叠加新功能会放大复杂度。

## 3. 分层

最终分为四层。

Zotero integration layer。

Zopilot UI Kit。

Base UI primitives。

Feature UI。

Zotero integration layer 负责 Zotero chrome window、reader、attachment、preferences、deck host、lifecycle 和 runtime probe。

Zopilot UI Kit 负责产品组件、visual system、portal、focus、density、theme、component states 和环境适配。

Base UI 只提供 headless interaction primitives。

Feature UI 只能组合 UI Kit 和 domain hooks。

业务组件不得直接操作 Zotero context-pane DOM。

业务组件不得直接 import Base UI。

## 4. 依赖策略

新增 `@base-ui/react` 作为主要 UI behavior dependency。

Base UI 覆盖 Select、Combobox、Dialog、Popover、Menu、Tabs、ToggleGroup、Toast、Tooltip、Progress、Field、Switch 等 primitives。

不引入 MUI、Ant Design、Mantine、Chakra 作为主 UI framework。

这些 framework 的 styling、runtime assumptions 和 bundle shape 不适合 Zotero chrome 内嵌产品 surface。

不把 shadcn/ui 作为 runtime dependency。

Tailwind v4 可作为后续 styling tool 评估，但不是核心方案。

Floating UI 不作为顶层方案，因为 Base UI 已覆盖主要 floating behavior。

依赖目标是少、稳定、可控。

## 5. UI Kit import 规则

允许：

```ts
import { Select, Dialog, CommandMenu } from "../ui";
```

禁止：

```ts
import * as Select from "@base-ui/react/select";
```

Base UI 只能出现在 UI Kit 内部实现文件中。

Feature UI 只能依赖 UI Kit public entry。

该规则用于集中处理 portal、modal、focus、z-index、theme、density 和 Zotero chrome 差异。

## 6. Zotero chrome 适配

Zopilot 运行在 Zotero 9 chrome window 中。

Zotero 9 当前基于 Gecko 140。

React DOM 和 Base UI 期望普通 browser globals。

当前 `reactHost` 中的 globals shim 应升级为正式 `installChromeWindowGlobals`。

该模块必须在动态 import React DOM 前执行。

该模块必须从 mount node 所属 window 安装 globals。

至少覆盖 `window`、`self`、`document`、`navigator`。

至少覆盖 `Node`、`Element`、`HTMLElement`、`SVGElement`。

至少覆盖 `Document`、`DocumentFragment`、`ShadowRoot`。

至少覆盖 `Event`、`EventTarget`、`MouseEvent`、`KeyboardEvent`、`PointerEvent`。

至少覆盖 `FocusEvent`、`InputEvent`、`CustomEvent`。

至少覆盖 `MutationObserver`、`ResizeObserver`、`IntersectionObserver`。

至少覆盖 `DOMRect`、`NodeFilter`、`requestAnimationFrame`、`cancelAnimationFrame`、`getComputedStyle`。

这些适配属于 integration layer，不属于普通 UI component。

## 7. Deck Host 与 React root

Deck Host 替代旧外挂 sidebar shell。

Deck Host 接收 `sidebar-ui.md` 创建的 Zopilot deck panel。

Deck Host 创建 React root。

Deck Host 创建 portal root。

Deck Host 保存 chrome document 和 chrome window 引用。

Deck Host 负责 mount、render、focus 和 destroy。

Deck Host 不拥有 Zotero context pane 的外层 width。

Deck Host 不创建外层 resize handle。

Deck Host 不理解业务组件内部状态。

Deck Host 不管理 popover、dialog、command menu 的 open state。

## 8. Portal 策略

所有 floating UI 必须渲染到 Zopilot 自己的 portal root。

Portal root 位于 Zopilot deck panel 内部。

建议 class 为 `.zp-portal-root`。

Select、Combobox、Popover、Dialog、Toast、Tooltip、Menu 都通过 UI Provider 获取 portal container。

禁止依赖 Base UI 默认 portal fallback。

Base UI 默认可能回退到 `document.body`，这在 Zotero chrome 中不可接受。

Portal root 随 Zopilot deck host mount/destroy 创建和销毁。

Portal root 必须使用明确 z-index tokens。

Portal 不应污染 Zotero item pane 或 notes pane 的 tab order。

## 9. Modal 策略

默认 Select、Popover、Combobox、CommandMenu 使用 non-modal behavior。

确认、配置、编辑类任务使用 Dialog modal。

Dialog 必须验证 focus trap。

Dialog 必须验证 Escape close。

Dialog 必须验证 return focus。

Dialog 必须验证 Tab/Shift-Tab。

Dialog 必须验证 outside click。

Dialog 必须验证 reader tab 切换。

避免全局 body scroll lock。

如果需要 scroll lock，应限制在 Zopilot deck panel 或 Dialog viewport。

## 10. Static CSS tokens

Static CSS tokens 是核心模块，不是补丁。

Tokens 定义 Zopilot 长期视觉语言。

Tokens 覆盖 color、background、border、shadow、radius、spacing、typography、line-height、focus ring、motion、z-index、density 和 component states。

Tokens 应映射 Zotero system colors 和 Zotero theme variables。

Tokens 必须支持 light mode 和 dark mode。

Tokens 必须考虑 macOS、Windows、Linux 差异。

未定义 token 应视为 bug。

Feature CSS 不应写 raw color。

Feature CSS 不应临时拼装复杂 `color-mix`。

## 11. CSS 组织

CSS 从大平面文件迁移到 token + UI Kit component styles + feature styles。

保留一个 global token 文件。

保留一个 deck/surface reset 文件。

组件样式靠近组件实现。

Feature CSS 应尽量少。

Base UI state attributes 是主要 state styling 入口。

状态包括 open、closed、highlighted、selected、checked、disabled、invalid、busy。

所有 selector 必须限定在 Zopilot root 或 UI Kit component class 下。

禁止全局污染 Zotero UI。

`!important` 只允许用于明确记录的 Zotero chrome override。

## 12. Layout primitives

建立 Stack、Inline、Grid、Toolbar、ScrollArea、Panel、Section、SplitArea、Spacer、VisuallyHidden。

Layout components 只处理布局，不处理业务。

不再使用字符数估算控件宽度。

长 model name 使用 flex、max-width、ellipsis。

CJK 文本必须作为常规输入场景处理。

窄 context pane 下文本不能溢出按钮。

Hover、focus、selected 状态不能导致 layout shift。

Zopilot 内部 splitters 只能存在于 deck panel 内部。

内部 splitters 不得靠近或覆盖 Zotero context splitter。

## 13. 第一批 UI Kit 组件

Button。

IconButton。

Tooltip。

Select。

Menu。

Popover。

Dialog。

AlertDialog。

Combobox。

CommandMenu。

Tabs。

ToggleGroup。

Switch。

Checkbox。

TextField。

TextArea。

Field。

Progress。

Toast。

Badge。

Chip。

ScrollArea。

Toolbar。

List 和 ListItem。

每个组件必须定义 props、states、keyboard behavior、token usage、portal usage 和 modal policy。

## 14. 产品组件

ModelPicker。

ReasoningPicker。

SourcePicker。

WorkspaceSelector。

SessionMenu。

ModeSwitch。

PromptPicker。

SkillList。

Composer。

ComposerToolbar。

MessageList。

MessageItem。

StatusToastHost。

这些产品组件只能依赖 UI Kit 和 domain hooks。

## 15. Select 迁移

Model 和 reasoning controls 必须从 native select 迁移到 UI Kit Select。

删除 `ComposerSelect`。

删除 `getComposerSelectInlineSize`。

删除基于 `ch` 的宽度估算测试。

Select trigger 自绘文本、图标、hover、focus、selected 状态。

Select popup 由 Base UI 管理 keyboard navigation 和 selection。

Select popup 渲染到 Zopilot portal root。

Select 默认 non-modal。

Select 支持长 label、disabled、compact density 和 theme tokens。

该迁移应根除 model hover alignment bug。

## 16. Floating surfaces 迁移

Session popover 迁移到 Menu 或 Popover。

Context popover 迁移到 Popover。

Workspace selector 迁移到 Menu、Popover 或 Combobox composition。

Mention picker 迁移到 Combobox。

Slash command 迁移到 CommandMenu。

所有 floating surfaces 必须有明确 close contract。

Escape、outside click、blur、selection 后关闭由组件契约定义。

不再依赖根节点 click 统一关闭所有浮层。

定位交给 Base UI/Floating UI。

不再手写 fixed inset、z-index 和 max-height 组合。

## 17. Surface 拆分

`SidebarApp` 应拆分为小型 feature surfaces。

建议拆出 `ZopilotSurface`。

建议拆出 `SurfaceHeader`。

建议拆出 `WorkspaceSelector`。

建议拆出 `SessionMenu`。

建议拆出 `MessageList`。

建议拆出 `MessageItem`。

建议拆出 `Composer`。

建议拆出 `ComposerToolbar`。

建议拆出 `SourceMentionPicker`。

建议拆出 `ModelPicker`。

建议拆出 `ReasoningPicker`。

建议拆出 `CommandMenu`。

建议拆出 `ModeSwitch`。

UI-only state 留在 React component。

Domain state 由 controller 或 hooks 提供。

Zotero side effects 不进入纯 UI component。

Codex bridge 调用不进入 UI Kit。

## 18. State 边界

Domain state 包括 workspace、conversation、messages、running turn、models、selected model、reasoning effort、source universe、sessions、Codex connection status。

Transient UI state 包括 popover open、command highlighted row、mention query、toast queue、dialog open、composer draft。

Transient UI state 默认不持久化。

用户明确设置才进入 preferences 或 conversation metadata。

Deck active state 属于 deck adapter。

Conversation state 不应依赖 deck selected state。

## 19. Composer

Composer 是未来交互中心。

Composer 保持稳定 textarea layout。

Composer 提供 toolbar、source mention、slash command、model picker、reasoning picker、mode switch、attachment action 和 custom prompt action。

第一阶段继续使用 textarea。

暂不引入复杂 rich text editor。

只有 textarea 无法支持需求时，再评估 rich text 或 editor core。

Composer 应在 Zopilot message scroll 区之外保持稳定位置。

## 20. Slash Command

Slash command 基于 CommandMenu。

Command registry 是必需模块。

Command 需要 id、title、description、keywords、icon、availability、action。

Command 可选 confirmation。

Command search 支持英文、中文、alias 和 fuzzy matching。

Command categories 至少包括 source、reader、attachment、prompt、skill、session、mode。

Command availability 根据 workspace、reader、busy、mode、selection 和 deck context 计算。

## 21. Custom Prompt

Custom prompt 是一等功能。

Prompt 需要 id、title、body、variables、scope、mode compatibility、skill compatibility 和 updated timestamp。

Prompt 管理 UI 可用 Dialog 或 settings surface。

Composer 支持选择、插入和应用 prompt。

Prompt variables 必须显式校验。

Prompt storage 不进入 UI Kit。

## 22. Skill

Skill UI 使用 registry/list/detail 模型。

Skill list 支持 search、category、enable/disable 和 status display。

Skill detail 显示 description、required context、configuration 和 mode compatibility。

Skill 执行状态体现在 message/tool activity UI 中。

不要向用户暴露无意义的 internal tool noise。

Skill UI 使用 UI Kit List、Switch、Badge、Dialog、CommandMenu。

## 23. Mode

Ask/agent mode 是显式产品状态。

Mode 不应只是 prompt 差异。

Mode UI 使用 ModeSwitch 或 SegmentedControl。

Mode 影响 Codex request parameters、available commands、allowed tools、confirmation behavior 和 UI copy。

Ask mode 专注阅读和回答。

Agent mode 需要清晰 permission、progress、confirmation 和 interrupt 入口。

Mode 是否持久化应作为产品决策明确。

## 24. Attachment upload

Attachment upload 从 composer toolbar 和 command menu 进入。

文件选择首选 Zotero FilePicker。

不要把 browser file input 作为主路径。

Integration layer 调用 `Zotero.Attachments.importFromFile`。

如果产品选择 linked file，则调用 `Zotero.Attachments.linkFromFile`。

UI 显示待添加文件、导入进度、成功、失败和导入后 source 可用状态。

导入后刷新 source universe 和 workspace context。

Attachment API 不进入 UI Kit。

## 25. Reader content navigation

支持从回答证据跳转到 reader。

支持 page、figure、table、annotation 和 retrieved chunk locator。

Integration layer 将 Zopilot locator 转成 reader location。

已有 reader 时使用 `reader.navigate(location)`。

需要打开 reader 时使用 `Zotero.Reader.open(itemID, location, options)`。

UI 只暴露动作，不理解 Zotero reader location 内部细节。

Message evidence、CommandMenu 和 Source panel 都可以提供 reader action。

## 26. Reader toolbar

Reader toolbar 保持轻量。

Toolbar button 使用静态 DOM 或极小 React-free UI。

Toolbar button 只负责 open/focus Zopilot deck。

复杂菜单在 Zopilot main surface 中打开。

继续使用 `Zotero.Reader.registerEventListener("renderToolbar", ...)`。

避免在 reader iframe 中挂完整 UI Kit。

## 27. Message rendering

Markdown rendering 与 UI primitives 分离。

继续 sanitize assistant output。

Message actions 使用 UI Kit Button、IconButton、Tooltip。

Evidence links 使用 UI Kit affordance。

Code copy state 使用 React state。

避免继续用 `innerHTML` mutation 表示 copied 状态。

Tool activity UI 应产品化。

Streaming message 应有稳定 layout。

Error、interrupted、running 状态应有明确视觉层级。

## 28. Accessibility

Keyboard interaction 是验收标准。

Select 支持键盘选择。

Menu 支持键盘导航。

Combobox 支持输入、方向键、高亮和选择。

Dialog 支持 Escape 和 focus return。

Tabs、ToggleGroup、Switch 必须有语义状态。

Icon-only button 必须有 aria label。

不熟悉的 icon 应有 tooltip。

Focus ring 必须可见。

Disabled、busy、selected、active、invalid 必须语义和视觉一致。

Zopilot deck button 的 accessibility 由 `sidebar-ui.md` 负责。

## 29. Localization

所有用户可见文本使用 localization。

UI Kit 不硬编码业务文本。

通用控件文本可由 UI Kit 提供默认值，但必须可覆盖。

中文和英文都必须作为设计输入。

长翻译不能挤爆按钮。

长论文标题不能破坏 header 和 menu。

Command search 支持中英文关键词。

## 30. Testing

添加 UI Kit render tests。

添加 command registry unit tests。

添加 view model tests。

添加 portal container tests。

添加 keyboard interaction tests。

添加 long label tests。

添加 CJK label tests。

添加 dark mode tests。

添加 narrow context pane tests。

添加 Zotero runtime smoke tests。

Runtime smoke 覆盖 Select、Combobox、Dialog、Toast、Tooltip、CommandMenu。

Runtime smoke 覆盖 reader tab 切换、Zopilot deck open/focus、context pane collapse/expand。

必须验证 floating UI 不依赖默认 `document.body`。

必须验证 portal root 位于 Zopilot deck panel 内。

## 31. Migration phases

Phase 1: 建立 foundation。

Phase 1 添加 Base UI dependency、UI Provider、portal root、chrome window globals adapter、static tokens 和第一批 UI Kit components。

Phase 1 同步建立 deck host 与 `sidebar-ui.md` 的 adapter contract。

Phase 2: 替换脆弱 primitives。

Phase 2 替换 model select、reasoning select、workspace selector、session menu、context popover、mention picker、buttons、tooltips、toasts。

Phase 3: 重建 composer。

Phase 3 引入稳定 composer layout、source mention picker、command trigger、toolbar actions、mode switch 和 model controls。

Phase 4: 重建 message 和 session surfaces。

Phase 4 componentize message list、message actions、running state、session history、archive/restore flows。

Phase 5: 添加新产品功能。

Phase 5 实现 attachment upload、reader navigation actions、slash command registry、custom prompt management、skill registry 和 ask/agent mode。

Phase 6: 删除旧 UI。

Phase 6 删除 native select sizing、ad hoc popovers、旧 CSS、旧外挂 shell 依赖、obsolete tests 和 unused helpers。

## 32. Acceptance criteria

没有 feature 直接 import Base UI。

所有 floating surfaces 使用 Zopilot portal container。

Model hover alignment bug 通过替换 native select 被根除。

长 label 和 CJK 文本不破坏布局。

Command、Select、Combobox、Menu、Dialog 均支持 keyboard interaction。

Dark/light theme 通过 tokens 工作。

Attachment upload 通过 Zotero integration service 实现。

Reader navigation 通过 Zotero integration service 实现。

Ask/agent mode 成为显式产品状态。

Zopilot internal UI 不依赖外挂 sidebar shell。

旧 UI 实现路径在替换后删除。

最终 UI 架构可作为长期产品 UI 基础。
