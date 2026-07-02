# Zopilot UI 宏观方案

## 目标

Zopilot UI 将从 MVP 实现迁移到成熟产品级 UI 架构。

这是一次重大功能更新和技术迁移，目标是清除当前 UI technical debt，并进入长期稳定方案。允许大规模重构；旧 UI 代码不需要保留。

## 范围

本方案只定义 Zopilot 内部产品 UI 的技术路线。

Zotero 9 右侧 pane 的挂载、deck 注入、sidenav 和外层 resize 所有权由 `notes/sidebar-ui.md` 定义。

因此，本方案中的 sidebar 应理解为 Zopilot active surface，而不是当前外挂 sidebar shell。

## 最终路线

最终技术路线是：

Base UI + Zopilot UI Kit + static CSS tokens。

Base UI 提供 accessible headless primitives。

Zopilot UI Kit 封装产品组件、interaction contract、portal、focus、density、theme 和 Zotero chrome 适配。

Static CSS tokens 定义颜色、间距、typography、radius、shadow、focus ring、motion、z-index、density 和 component states。

## 核心原则

Feature UI 不得直接 import Base UI。

所有 Base UI primitives 必须通过 Zopilot UI Kit 暴露。

Zotero integration layer 负责 chrome window、reader、attachment、preferences、deck host 和 lifecycle。

UI Kit 负责内部控件质量，不直接操作 Zotero context-pane DOM。

业务组件只组合 Zopilot UI Kit 和 domain hooks。

## 迁移重点

用稳定组件系统替换 native select、hand-written popover、manual menu、mention popup、散乱 CSS 和 ad hoc focus handling。

Composer、message list、source picker、model picker、command menu、prompt、skill 和 mode 都应重建为清晰的 product surfaces。

Reader toolbar 保持轻量，只负责打开或聚焦 Zopilot；复杂 UI 留在 Zopilot main surface。

## 未来能力

新架构必须支持 attachment upload、reader content navigation、slash command、自定义 prompt、skill 和 ask/agent mode。

这些能力应是一等产品流程，而不是继续叠加在 MVP layout 上的补丁。

## 成功标准

Zopilot UI 在 Zotero 9 chrome window 中具备稳定交互、成熟视觉、清晰状态边界和可维护组件系统。

Deck 集成解决外层挂载和 splitter 问题；本方案解决 Zopilot 内部 UI 的长期技术路线。
