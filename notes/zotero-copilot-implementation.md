# Zotero Copilot 实现笔记

## Step 1 插件骨架

- 插件入口仍是 `src/index.ts`，全局实例名来自 `package.json` 的 `config.addonInstance`：`ZoteroCopilot`。
- 生命周期集中在 `src/hooks.ts`：`onStartup` 等待 `Zotero.initializationPromise`、`Zotero.unlockPromise`、`Zotero.uiReadyPromise`，然后初始化 locale、注册偏好页，并对已有主窗口执行 `onMainWindowLoad`。
- `addon.data.initialized = true` 是 scaffold startup test 判断插件加载完成的标记，不要删除。
- 当前已移除模板示例 UI：没有右键菜单、额外列、快捷键、item pane section、reader section、红色样式或示例弹窗。
- 当前 `hooks.ts` 只保留真实生命周期入口：`onStartup`、`onShutdown`、`onMainWindowLoad`、`onMainWindowUnload`。不再保留 `onNotify`、`onShortcuts`、`onDialogEvents` 或偏好页 `onload` 日志钩子。
- `src/modules/examples.ts` 已删除。后续如果需要 Zotero UI 功能，应新建模块实现，不要恢复模板示例。
- 偏好页注册在 `src/modules/preferenceScript.ts`，当前只负责把 `addon/content/preferences.xhtml` 挂到 Zotero Preferences。
- `addon/content/preferences.xhtml` 当前只显示插件骨架状态和 build 信息；真实 Codex/sidebar 设置后续再加入。
- 插件默认 pref 目前只有 `enabled`，定义在 `addon/prefs.js`，生成类型见 `typings/prefs.d.ts`。
- Zotero 兼容范围在 `addon/manifest.json`：`strict_min_version` 为 `9.0`，`strict_max_version` 为 `9.0.*`，对应当前 Zotero 9.0.4 开发验证范围。
- `package.json` 的 repository、bugs、homepage、author 已从 `zotero-plugin-template` 改为当前 `qyangcv/zotero-copilot` 项目信息；`zotero-plugin.config.ts` 会把这些字段写入 build define/manifest。
- 验证过的基础命令：`npm run build`、`npm start`、`npm test`。其中 `npm test` 的 startup test 会确认 `Zotero.ZoteroCopilot.data.initialized` 可用。

## Step 2 准备

- Sidebar 图标资源：`addon/content/icons/message-circle.svg`。
- 运行时 chrome URL：`chrome://zotero-copilot/content/icons/message-circle.svg`。
- 当前同一个 SVG 会用于 sidebar toggle、偏好页图标、ProgressWindow 默认图标，以及 `manifest.json` 的 icon entries。
- Sidebar 图标不需要准备多个尺寸。当前资源是 SVG，可按按钮尺寸缩放；后续实现 sidebar 按钮时直接引用这个 `24x24` 图标即可。
- `manifest.json` 里的 `48`/`96` 是插件管理器或发布元信息用的 icon entries，不是 sidebar 按钮的尺寸要求。当前先用同一个 SVG 填这两个 entry；如果后续需要更稳妥的发布包外观，再从 SVG 生成 `48x48` 和 `96x96` PNG。
- 图标来源：Tabler Icons 的 `message-circle`。
- 授权处理：已记录在 `THIRD_PARTY_NOTICES.md`；下载的 SVG 文件本身没有内嵌 license 注释。

## Step 2 实现

- `src/modules/sidebar/` 负责 Zotero Copilot sidebar，当前拆分如下：
  - `index.ts`：窗口级 controller，只负责注册、挂载、打开/关闭、输入提交和上下文刷新编排。
  - `constants.ts`：DOM id、chrome stylesheet/icon URL、HTML namespace。
  - `readerToolbar.ts`：创建 PDF reader toolbar button，并给 reader document 注入共享 chrome stylesheet。
  - `selectedItem.ts`：读取当前 Zotero selection 或 reader attachment parent 的标题。
  - `markdown.ts`：Step-2 原型用的最小 Markdown/公式占位 renderer。
  - `placeholder.ts`：固定 assistant 占位回复。
- 2026-06-07 调整：放弃 `Zotero.ItemPaneManager.registerSection()` / item-pane sidenav 方案，因为它无法可靠隔离 item details 的纵向 section scroll。当前入口是主界面 `#zotero-items-toolbar` 和 PDF reader `renderToolbar` 注入按钮；点击后打开挂在 Zotero 主布局里的独立右侧 Copilot pane，和 Zotero 内置 item pane sections 使用不同 DOM 容器。
- UI 采用 VS Code Copilot Chat sidebar 的几个可迁移原则：一个高价值侧栏、紧凑标题与消息密度、输入区承载上下文 chip、模型和推理强度状态、textarea 按内容自动增高且有最大高度。
- 当前不接真实模型。提交输入后会追加用户消息，并显示固定 assistant 占位回复。
- 内置最小 Markdown renderer 位于 `src/modules/sidebar/markdown.ts`，覆盖 Step-2 原型需要的段落、列表、链接、表格、代码块、行内公式和行间公式占位；后续接模型后可替换为正式 renderer。
- 文案放在 `addon/locale/*/addon.ftl`，因为 `getString()` 当前初始化的是 addon 级 FTL。
- 样式集中在 `addon/content/zoteroPane.css`。主窗口通过 XML stylesheet processing instruction 注入；PDF reader document 通过 `<link rel="stylesheet">` 注入同一个 chrome stylesheet，避免 TypeScript 内联一份 reader toolbar CSS。
- `src/hooks.ts` 在主窗口加载时注册 sidebar，在窗口卸载和插件 shutdown 时清理；sidebar 注册异常会被记录但不会阻断插件 startup test。
- 验证命令：`npm run build`、`npx eslint src/modules/sidebar/index.ts src/hooks.ts src/utils/locale.ts`、`npm test`。`npm test` 已通过 startup 用例，但 scaffold 测试进程在报告完成后不会自动退出，本次已手动清理 `.scaffold/test` 进程。
