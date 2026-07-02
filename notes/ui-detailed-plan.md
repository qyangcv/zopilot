# Zopilot UI Detailed Plan
## 1. 目标
本计划定义 Zopilot UI 从 MVP 实现迁移到成熟产品级 UI 架构的实施要点。
最终技术路线为：Base UI + Zopilot UI Kit + 静态 CSS tokens。
这是一次重大功能更新和技术迁移。
允许并预期进行大规模重构。
无需保留旧 UI 代码。
如果旧实现阻碍最终架构，应直接替换，而不是兼容。
迁移目标不是短期修补视觉问题，而是彻底解决当前 UI 技术债。
迁移完成后，Zopilot UI 不应再需要更换主 UI 技术方案。
## 2. 当前问题归纳
当前 UI 已经满足 MVP，但不适合作为长期产品 UI 基础。
主要问题不是单个样式 bug，而是交互组件缺少稳定边界。
model hover 时文字无法在背景框中居中，是原生 select 魔改的典型表现。
原生控件在 Zotero chrome、Gecko、平台主题、字体、缩放下都难以精确控制。
当前 popover、menu、mention、session list 大量靠手写 DOM 状态和 CSS 定位。
当前 CSS 文件偏大、偏平，tokens 不完整，状态样式散落。
当前交互行为缺少统一的 focus、keyboard、outside click、Escape 和 portal 策略。
当前 UI 逻辑和 Zotero/Codex/domain 状态耦合较紧。
未来功能如果继续在现有结构上叠加，会显著放大复杂度。
## 3. 最终分层
最终 UI 架构分为四层。
第一层是 Zotero integration layer。
第二层是 Zopilot UI Kit。
第三层是 Base UI primitives。
第四层是 Feature UI。
Zotero integration layer 负责 Zotero chrome window、reader、attachment、preferences、localization、lifecycle。
Zopilot UI Kit 负责 Zopilot 自己的产品组件、视觉系统、tokens、portal、focus、density、theme 和环境适配。
Base UI 只负责无样式、可访问的交互原语。
Feature UI 只能组合 Zopilot UI Kit，不直接使用 Base UI。
这四层必须保持清晰边界。
## 4. 关键原则
业务代码不得直接 import Base UI。
所有 Base UI primitive 必须经过 Zopilot UI Kit 包装。
Zotero 环境差异必须在 UI Kit 和 integration layer 中集中处理。
视觉规则必须通过静态 CSS tokens 表达。
复杂交互必须依赖成熟 primitive，而不是继续手写。
重构以最终架构正确为目标，不以最小 diff 为目标。
不为了保留旧代码而增加兼容层。
不把临时桥接代码扩展成长期接口。
## 5. 依赖策略
新增 `@base-ui/react` 作为主要 UI 行为依赖。
Base UI 用于 Select、Combobox、Dialog、Popover、Menu、Tabs、ToggleGroup、Toast、Tooltip、Progress、Field、Switch 等行为。
不引入 MUI、Ant Design、Mantine、Chakra 作为主 UI 框架。
这些完整 UI 框架样式和运行时假设过重，不适合嵌入 Zotero sidebar。
不把 shadcn/ui 作为运行时依赖。
shadcn/ui 可以作为设计参考，但不是本项目最终 UI 依赖。
Tailwind v4 可以后续作为可选样式工具评估。
Tailwind 不属于核心方案，因为它只解决 styling，不解决控件行为。
Floating UI 不需要单独作为顶层方案，因为 Base UI 已经覆盖主要定位需求。
依赖目标是少而完整。
## 6. UI Kit import 规则
允许：
```ts
import { Select, Dialog, CommandMenu } from "../ui";
```
禁止：
```ts
import * as Select from "@base-ui/react/select";
```
UI Kit 应提供唯一公共入口。
Base UI 只能出现在 UI Kit 内部实现文件中。
ESLint 或 code review 应检查该规则。
该规则用于防止 portal、modal、focus、z-index、theme、density 规则散落到业务组件。
## 7. Zotero 环境适配
Zopilot 运行在 Zotero 9 chrome window 中。
Zotero 9 当前基于 Gecko 140。
插件代码运行在 bootstrap sandbox 中。
React DOM 和 Base UI 期望普通浏览器全局对象。
当前 `reactHost` 中的 globals shim 应升级为正式环境适配模块。
模块建议命名为 `installChromeWindowGlobals`。
该模块在动态 import React DOM 前执行。
该模块在每次 render 前也可以安全重复执行。
必须从 mount node 所属 window 安装全局对象。
需要覆盖 DOM constructors、event constructors、observer constructors、animation frame、computed style 等对象。
至少应覆盖 `window`、`self`、`document`、`navigator`。
至少应覆盖 `Node`、`Element`、`HTMLElement`、`SVGElement`。
至少应覆盖 `Document`、`DocumentFragment`、`ShadowRoot`。
至少应覆盖 `Event`、`EventTarget`、`MouseEvent`、`KeyboardEvent`、`PointerEvent`。
至少应覆盖 `FocusEvent`、`InputEvent`、`CustomEvent`。
至少应覆盖 `MutationObserver`、`ResizeObserver`、`IntersectionObserver`。
至少应覆盖 `DOMRect`、`NodeFilter`、`requestAnimationFrame`、`cancelAnimationFrame`、`getComputedStyle`。
这些适配属于 Zotero integration layer，不属于 UI Kit 组件职责。
## 8. Mount 与 Shell
Zotero shell 负责挂载点、宽度、resize、打开关闭、reader tab 生命周期。
React app 只负责 Zopilot 自身 UI。
Shell 应创建 React root。
Shell 应创建 portal root。
Shell 应保存对 chrome document 和 chrome window 的引用。
Shell 应避免把 Base UI 浮层挂到未知 document。
Shell resize 逻辑可以保留，但应和内部 layout 解耦。
Shell 不应理解具体业务组件。
Shell 不应管理 popover、dialog、command menu 的内部状态。
## 9. Portal 策略
所有 floating UI 必须渲染到 Zopilot 自己的 portal root。
Portal root 应位于 Zopilot shell 内部。
建议 class 为 `.zp-portal-root`。
所有 Select、Combobox、Popover、Dialog、Toast、Tooltip、Menu 都通过 UI provider 获取 portal container。
禁止依赖 Base UI 默认 portal 行为。
Base UI 默认会回退到 `document.body`。
Zotero chrome document 不是普通网页，不应假设 `document.body` 可用。
Portal root 应随 sidebar mount/unmount 生命周期销毁。
Portal root 应有明确 z-index token。
Portal root 应避免影响 Zotero 主 UI 的 tab order。
## 10. Modal 策略
默认 Select、Popover、Combobox、CommandMenu 使用非 modal 行为。
非 modal 行为更适合 Zotero sidebar 中的轻量交互。
只有确认、配置、编辑类任务使用 Dialog modal。
Dialog modal 必须经过专项验证。
验证项包括 focus trap。
验证项包括 Escape 关闭。
验证项包括 return focus。
验证项包括 tab/shift-tab 循环。
验证项包括 outside click。
验证项包括 reader tab 切换。
验证项包括 Zotero chrome 控件可恢复交互。
避免默认 body scroll lock。
如果需要 scroll lock，应限制在 Zopilot shell 或 Dialog viewport，而非全局 body。
## 11. Static CSS Tokens
静态 CSS tokens 是核心模块，不是妥协补丁。
Tokens 定义 Zopilot 的长期视觉语言。
Tokens 应覆盖颜色。
Tokens 应覆盖背景。
Tokens 应覆盖边框。
Tokens 应覆盖阴影。
Tokens 应覆盖圆角。
Tokens 应覆盖间距。
Tokens 应覆盖字体。
Tokens 应覆盖行高。
Tokens 应覆盖 focus ring。
Tokens 应覆盖 motion duration。
Tokens 应覆盖 z-index layers。
Tokens 应覆盖 density。
Tokens 应覆盖 component state。
Tokens 应映射 Zotero 系统色和 Zotero theme variables。
Tokens 应支持 light mode。
Tokens 应支持 dark mode。
Tokens 应支持 macOS、Windows、Linux 差异。
未定义 token 应视为 bug。
业务 CSS 不应写 raw color。
业务 CSS 不应临时拼装大量 `color-mix`。
## 12. CSS 组织
CSS 应从大平面文件迁移到 UI Kit 组件级组织。
可以保留一个全局 token 文件。
可以保留一个 reset/shell 文件。
组件样式应靠近组件定义。
Feature CSS 应尽量少。
Base UI state attributes 应作为状态 styling 的主要入口。
状态包括 open、closed、highlighted、selected、checked、disabled、invalid、busy。
避免全局 selector 污染 Zotero。
所有选择器应限定在 Zopilot root 或 UI Kit component class 下。
`!important` 只允许用于明确记录的 Zotero chrome override。
## 13. Layout 体系
建立基础 layout primitives。
需要 Stack。
需要 Inline。
需要 Grid。
需要 Toolbar。
需要 ScrollArea。
需要 Panel。
需要 Section。
需要 SplitArea。
需要 Spacer。
需要 VisuallyHidden。
布局组件只处理布局，不处理业务。
不要再用字符数估算控件宽度。
长 model 名称必须通过 flex、max-width、ellipsis 处理。
CJK 文本必须作为常规输入场景处理。
sidebar 窄宽度下文本不能溢出按钮。
hover、focus、selected 状态不能导致 layout shift。
## 14. UI Kit 组件清单
第一批组件：Button。
第一批组件：IconButton。
第一批组件：Tooltip。
第一批组件：Select。
第一批组件：Menu。
第一批组件：Popover。
第一批组件：Dialog。
第一批组件：AlertDialog。
第一批组件：Combobox。
第一批组件：CommandMenu。
第一批组件：Tabs。
第一批组件：ToggleGroup。
第一批组件：Switch。
第一批组件：Checkbox。
第一批组件：TextField。
第一批组件：TextArea。
第一批组件：Field。
第一批组件：Progress。
第一批组件：Toast。
第一批组件：Badge。
第一批组件：Chip。
第一批组件：ScrollArea。
第一批组件：Toolbar。
第一批组件：List。
第一批组件：ListItem。
产品组件：ModelPicker。
产品组件：ReasoningPicker。
产品组件：SourcePicker。
产品组件：WorkspaceSelector。
产品组件：SessionMenu。
产品组件：ModeSwitch。
产品组件：PromptPicker。
产品组件：SkillList。
每个组件都必须定义 props、states、keyboard behavior、token usage。
每个组件都必须明确是否使用 portal。
每个组件都必须明确是否允许 modal。
## 15. Select 迁移
Model 和 reasoning controls 必须从原生 select 迁移到 UI Kit Select。
删除 `ComposerSelect`。
删除 `getComposerSelectInlineSize`。
删除基于 `ch` 的宽度估算测试。
Select trigger 应自绘文本、图标、hover、focus、selected 状态。
Select popup 应由 Base UI 管理键盘导航和选择行为。
Select popup 应通过 Zopilot portal root 渲染。
Select popup 默认非 modal。
Select 应支持长 label。
Select 应支持 disabled。
Select 应支持 compact density。
Select 应支持 theme tokens。
该迁移应直接解决 model hover alignment bug。
## 16. Popover/Menu 迁移
Session popover 应迁移到 Menu 或 Popover。
Context popover 应迁移到 Popover。
Workspace selector 应迁移到 Menu、Popover 或 Combobox 组合。
Mention popover 应迁移到 Combobox。
所有浮层关闭行为应显式管理。
不再依赖 sidebar 根节点 click 统一关闭所有浮层。
Escape、outside click、blur、selection 后关闭应由组件契约定义。
浮层定位应交给 Base UI/Floating UI。
不再手写固定 inset、z-index 和 max-height 组合。
## 17. Sidebar 重构
`SidebarApp` 应拆分为小型 feature surfaces。
建议拆出 `SidebarShellView`。
建议拆出 `SidebarHeader`。
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
建议拆出 `StatusToastHost`。
UI-only state 留在 React 组件内。
Domain state 由 controller 或 hooks 提供。
Zotero side effects 不进入纯 UI 组件。
Codex bridge 调用不进入 UI Kit。
## 18. State 边界
Domain state 包括 workspace。
Domain state 包括 conversation。
Domain state 包括 messages。
Domain state 包括 running turn。
Domain state 包括 models。
Domain state 包括 selected model。
Domain state 包括 reasoning effort。
Domain state 包括 source universe。
Domain state 包括 sessions。
Domain state 包括 Codex connection status。
Transient UI state 包括 popover open。
Transient UI state 包括 command highlighted row。
Transient UI state 包括 mention query。
Transient UI state 包括 toast queue。
Transient UI state 包括 dialog open。
Transient UI state 包括 composer draft。
Transient UI state 默认不持久化。
用户明确设置才进入 preferences 或 conversation metadata。
## 19. Composer
Composer 应成为未来交互中心。
Composer 需要稳定 textarea layout。
Composer 需要 toolbar。
Composer 需要 source mention。
Composer 需要 slash command。
Composer 需要 model picker。
Composer 需要 reasoning picker。
Composer 需要 mode switch。
Composer 需要 attachment action。
Composer 需要 custom prompt action。
Composer 不应立刻引入复杂富文本编辑器。
第一阶段继续使用 textarea。
只有 textarea 无法支持需求时，再评估富文本或代码编辑器内核。
## 20. Slash Command
Slash command 基于 CommandMenu。
CommandMenu 内部可用 Combobox 或专用 composition。
Command registry 是必需模块。
Command 需要 id。
Command 需要 title。
Command 需要 description。
Command 需要 keywords。
Command 需要 icon。
Command 需要 availability。
Command 需要 action。
Command 可选 confirmation。
Command search 应支持英文。
Command search 应支持中文。
Command search 应支持 alias。
Command search 应支持 fuzzy matching。
Command categories 至少包括 source、reader、attachment、prompt、skill、session、mode。
Command availability 应根据 workspace、reader、busy、mode、selection 计算。
## 21. Custom Prompt
Custom prompt 是一等功能，不是文本片段补丁。
Prompt 需要 id。
Prompt 需要 title。
Prompt 需要 body。
Prompt 需要 variables。
Prompt 需要 scope。
Prompt 需要 mode compatibility。
Prompt 需要 skill compatibility。
Prompt 需要 updated timestamp。
Prompt 管理 UI 可用 Dialog 或 settings panel。
Composer 应支持选择 prompt。
Composer 应支持插入 prompt。
Composer 应支持应用 prompt 到当前输入。
Prompt variables 必须显式校验。
Prompt 存储不应混入 UI Kit。
## 22. Skill
Skill UI 使用 registry/list/detail 模型。
Skill list 支持搜索。
Skill list 支持分类。
Skill list 支持 enable/disable。
Skill list 支持状态展示。
Skill detail 显示描述。
Skill detail 显示所需上下文。
Skill detail 显示配置项。
Skill detail 显示 mode compatibility。
Skill 执行状态应体现在 message/tool activity UI 中。
不要向用户暴露无意义的内部 tool 噪声。
Skill UI 使用 UI Kit List、Switch、Badge、Dialog、CommandMenu。
## 23. Mode
Ask/agent mode 是显式状态。
Mode 不应只是隐藏 prompt 差异。
Mode UI 使用 ModeSwitch 或 SegmentedControl。
Mode 影响 Codex request parameters。
Mode 影响 available commands。
Mode 影响 allowed tools。
Mode 影响 confirmation behavior。
Mode 影响 UI copy。
Ask mode 轻量，专注阅读和回答。
Agent mode 需要更清晰的权限、进度、确认和中断入口。
Mode 状态是否持久化应作为产品决策明确。
## 24. Attachment Upload
Attachment upload 从 composer toolbar 和 command menu 进入。
文件选择首选 Zotero FilePicker。
不要把 browser file input 作为主路径。
Zotero integration layer 调用 `Zotero.Attachments.importFromFile`。
如果产品选择 linked file，则调用 `Zotero.Attachments.linkFromFile`。
UI 显示待添加文件。
UI 显示导入进度。
UI 显示成功。
UI 显示失败。
UI 显示导入后 source 可用状态。
导入后刷新 source universe。
导入后刷新 workspace context。
附件 API 逻辑不得放入 UI Kit。
## 25. Reader Content Location
支持从回答中的证据跳转到 reader。
支持 page locator。
支持 figure locator。
支持 table locator。
支持 annotation locator。
支持 retrieved chunk locator。
Zotero integration layer 负责把 Zopilot locator 转成 reader location。
已有 reader 时使用 `reader.navigate(location)`。
需要打开 reader 时使用 `Zotero.Reader.open(itemID, location, options)`。
UI 只暴露动作，不理解 Zotero reader location 内部细节。
Message evidence、CommandMenu、Source panel 都可以提供 reader action。
## 26. Reader Toolbar
Reader toolbar 保持轻量。
Toolbar button 使用静态 DOM 或极小 React-free UI。
Toolbar button 只负责 toggle 或 focus Zopilot。
复杂菜单在主 sidebar 中打开。
继续使用 `Zotero.Reader.registerEventListener("renderToolbar", ...)`。
避免在 reader iframe 中挂完整 UI Kit。
只有未来明确需要 reader 内复杂交互时再评估。
## 27. Message Rendering
Markdown 渲染和 UI primitives 分离。
继续 sanitize assistant output。
Message actions 使用 UI Kit Button/IconButton/Tooltip。
Evidence links 使用 UI Kit affordance。
Code copy state 优先用 React state。
避免继续使用 `innerHTML` mutation 表示 copied 状态。
Tool activity UI 应产品化，而不是直接暴露底层事件。
Streaming message 应有稳定 layout。
错误状态和 interrupted 状态应有明确视觉层级。
## 28. Accessibility
Keyboard interaction 是验收标准。
Select 必须支持键盘选择。
Menu 必须支持键盘导航。
Combobox 必须支持输入、方向键、高亮、选择。
Dialog 必须支持 Escape 和 focus return。
Tabs/ToggleGroup/Switch 必须有语义状态。
Icon-only button 必须有 aria label。
不熟悉的 icon 应有 tooltip。
Focus ring 必须可见。
Disabled、busy、selected、active、invalid 必须语义和视觉一致。
## 29. Localization
所有用户可见文本使用 localization。
UI Kit 不硬编码业务文本。
通用控件文本可以由 UI Kit 提供默认值，但必须可覆盖。
中文和英文都必须作为设计输入。
长翻译不能挤爆按钮。
长论文标题不能破坏 header 和 menu。
Command search 应支持中英文关键词。
## 30. Testing
添加 UI Kit render tests。
添加 command registry unit tests。
添加 view model tests。
添加 portal container tests。
添加 keyboard interaction tests。
添加 long label tests。
添加 CJK label tests。
添加 dark mode tests。
添加 narrow sidebar tests。
添加 Zotero runtime smoke tests。
Runtime smoke 覆盖 Select。
Runtime smoke 覆盖 Combobox。
Runtime smoke 覆盖 Dialog。
Runtime smoke 覆盖 Toast。
Runtime smoke 覆盖 Tooltip。
Runtime smoke 覆盖 CommandMenu。
Runtime smoke 覆盖 reader tab 切换。
Runtime smoke 覆盖 sidebar open/close。
必须验证 floating UI 不依赖默认 `document.body`。
## 31. Migration Phases
Phase 1: 建立 foundation。
Phase 1 添加 Base UI dependency。
Phase 1 创建 UI provider。
Phase 1 创建 portal root。
Phase 1 创建 chrome window globals adapter。
Phase 1 创建 static tokens。
Phase 1 创建第一批 UI Kit components。
Phase 2: 替换脆弱 primitives。
Phase 2 替换 model select。
Phase 2 替换 reasoning select。
Phase 2 替换 workspace selector。
Phase 2 替换 session menu。
Phase 2 替换 context popover。
Phase 2 替换 mention picker。
Phase 2 替换 buttons、tooltips、toasts。
Phase 3: 重建 composer。
Phase 3 引入稳定 composer layout。
Phase 3 引入 source mention picker。
Phase 3 引入 command trigger。
Phase 3 引入 toolbar actions。
Phase 3 引入 mode switch。
Phase 3 引入 model controls。
Phase 4: 重建 message 和 session surfaces。
Phase 4 componentize message list。
Phase 4 componentize message actions。
Phase 4 componentize running state。
Phase 4 componentize session history。
Phase 4 componentize archive/restore flows。
Phase 5: 添加新产品功能。
Phase 5 实现 attachment upload。
Phase 5 实现 reader navigation actions。
Phase 5 实现 slash command registry。
Phase 5 实现 custom prompt management。
Phase 5 实现 skill registry。
Phase 5 实现 ask/agent mode。
Phase 6: 删除旧 UI。
Phase 6 删除被替换 CSS。
Phase 6 删除 ad hoc popovers。
Phase 6 删除 native select sizing。
Phase 6 删除 obsolete tests。
Phase 6 删除 unused helpers。
## 32. Acceptance Criteria
没有业务 feature 直接 import Base UI。
所有 floating surfaces 使用 UI Kit portal container。
model hover alignment bug 通过替换 native select 被根除。
长 label 和 CJK 文本不破坏布局。
Command、Select、Combobox、Menu、Dialog 均支持键盘操作。
Dark/light theme 通过 tokens 工作。
Attachment upload 通过 Zotero integration service 实现。
Reader navigation 通过 Zotero integration service 实现。
Ask/agent mode 成为显式产品状态。
旧 UI 实现路径在替换后删除。
最终 UI 架构可作为长期产品 UI 基础。
