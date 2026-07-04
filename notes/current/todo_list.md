> Preference Pane

找一个高 stars 的 zotero plulgin，让 codex 学习其 preference pane 设计实现方式。

- 支持更多配置项
- 优化 UI
- 支持字体大小自定义

- 支持 model/effort/fast 切换
- 支持 Cancel
- 优化 markdown 渲染
- 当 model 在输出时，支持上下滑动查看回复，支持切换 history session、新建 session
- 支持交互：可选中、可复制粘贴
- 消息显示时间戳

v0.2.1 (finished)

- 支持 LaTeX/TeX 风格公式（MathJax 风格分隔符）：块级公式：`\[ ... \]`，行内公式：`\( ... \)`。当前仅支持 Markdown/KaTeX 常见写法：块级公式：`$$ ... $$`，`行内公式：$ ... $`。需要考虑两者的兼容性。
- 修复：删除新会话顶部多余的交互按钮。
- 改名: zopilot -> ? zopilot。

v0.2.2-v0.2.7 (finished)

- bug: 作为插件安装， zopilot preference tab 无响应.
- 加入日志模块
- 支持插件自动更新

v0.2.8

- fix: sidebar 最大宽度受限问题
- fix: side panel 支持自由的复制粘贴
- 用户输出支持 markdown 渲染

v0.2.9

- fix: side panel 垂直的宽度调整条 深灰色 -> 浅灰色，优化视觉体验

v0.2.16

- fix: 修复模型回复时切换论文，导致检索到错误的 pdf 的问题
- feat: 优化 ui 各个图标：统一风格和尺寸，加入更多图标

v0.2.17 (finished, partially)

- fix：当有请求时，切换论文，zopilot 的side panel 无法实时响应切换（比如在论文A发送了一个请求，点击 tab 切换到论文 B，此时 side panel 中仍然显示的是论文A，需要点击一下 side panel 的输入框、或者多次点击顶部的论文 tab，才能让 side panel 切换过来）。这一问题在没有向模型发送请求时不存在，此时任意切换论文，side panel 响应同步都非常迅速。

v0.3.0

两个核心功能: 检索 & 工作区

- 探讨 risks.md

- 优化检索逻辑
- mcp 还是 skill ? -> 探索更优的 agent 流程，需要提考虑兼容未来的功能
- 支持 附件上传
- 支持 阅读器内容定位
- 支持 command (/), 支持自定义 prompt
- 支持 skill
- 支持 mode (ask/agent)

v0.4.0

- 支持 BYOK
- 接入 Base UI
