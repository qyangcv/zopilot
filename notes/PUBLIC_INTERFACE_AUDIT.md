# 公共接口审计

审计日期：2026-07-03

本文件记录当前需要稳定保留的接口边界。后续重构可以移动实现、拆分模块、删除内部死代码，但不应在同一个 refactor pass 中改变这里列出的外部行为或持久化格式。

## 审计结论

- 当前真正的构建入口只有两个：`src/index.ts` 和 `src/modules/preferences/preferencesPane.ts`。`madge --orphans` 只报告这两个文件，符合 `zotero-plugin.config.ts` 的 esbuild entry point 配置。
- `madge --circular` 未发现循环依赖。现阶段不需要先做架构迁移。
- 显式测试专用导出只有 `src/modules/sidebar/controller.ts` 的 `__sidebarControllerTestHooks`。
- 多数 `export` 是 repo 内模块边界或单测边界，不应直接视为外部 API；但在收紧前需要先迁移导入方或建立 barrel/internal 分层。
- 当前工作区已有独立源码重构改动；这些不计入本审计 pass。

## 稳定入口

### Zotero bootstrap lifecycle

文件：`addon/bootstrap.js`

Zotero 调用以下 bootstrap 函数：

- `install()`
- `startup({ rootURI })`
- `onMainWindowLoad({ window })`
- `onMainWindowUnload({ window })`
- `shutdown(_data, reason)`
- `uninstall()`

当前行为：

- `startup` 注册 chrome content root，加载 `content/scripts/__addonRef__.js`，然后调用 `Zotero.__addonInstance__.hooks.onStartup()`。
- main window load/unload 转发到 addon hooks。
- shutdown 跳过 app shutdown，其他情况调用 `hooks.onShutdown()` 并销毁 chrome handle。

重构约束：

- 不要在普通重构 pass 中改这些函数名、参数形状、加载顺序或 `APP_SHUTDOWN` 行为。
- 如果要迁移 manifest/bootstrap 模式，应作为单独 Zotero packaging migration。

验证：

- `npm run build`
- `npm test`
- 真实 Zotero 安装/启动 smoke：插件初始化完成，main window load 后 sidebar 注册，shutdown 不留下 toolbar/sidebar 残留。

### Bundled runtime entry points

文件：`zotero-plugin.config.ts`

稳定入口：

- `src/index.ts` -> `.scaffold/build/addon/content/scripts/zopilot.js`
- `src/modules/preferences/preferencesPane.ts` -> `.scaffold/build/addon/content/preferences.js`

当前行为：

- `src/index.ts` 安装 console shim，创建 `Addon`，把实例暴露为 `Zotero[config.addonInstance]`，并在 sandbox global 上提供 `addon` 和 `ztoolkit`。
- `preferencesPane.ts` 是 preferences UI 的独立 IIFE bundle entry。

重构约束：

- 可以拆分入口内部实现，但 entry point 文件路径和 bundle 输出路径保持稳定。
- 不要把测试、notes、doc 或 helper source 目录加入 addon assets。

验证：

- `npm run build`
- 检查 `.scaffold/build/addon/content/scripts/zopilot.js` 和 `.scaffold/build/addon/content/preferences.js` 仍生成。

### Runtime hooks object

文件：`src/hooks.ts`

稳定方法：

- `onStartup()`
- `onShutdown()`
- `onMainWindowLoad(win)`
- `onMainWindowUnload(win)`

当前行为：

- startup 等待 Zotero 初始化/unlock/uiReady，初始化 locale，注册 preferences pane，注册所有已打开 main windows 的 sidebar，启动 MCP HTTP server，最后设置 `addon.data.initialized = true`。
- main window load 刷新 ztoolkit 并注册 sidebar。
- unload/shutdown 注销 sidebar、MCP server、Codex bridge 和 ztoolkit。

重构约束：

- 可以提取 startup/shutdown helper，但完成标志 `addon.data.initialized` 的语义不能变。
- scaffold test 依赖 `Zotero.${addonInstance}.data.initialized` 判断插件启动完成。

验证：

- `npm test`
- `test/scaffold/startup.test.ts`

## 持久化和用户配置接口

### Preferences keys

文件：`addon/prefs.js`

稳定 keys：

- `codex.timeoutMs`
- `codex.model`
- `codex.reasoningEfforts`
- `prompts.custom`
- `log.verbose`

当前行为：

- 代码通过 `src/utils/prefs.ts` 自动加上 `extensions.zotero.zopilot` prefix。
- `codex.reasoningEfforts` 和 `prompts.custom` 以 JSON string 存储。

重构约束：

- 不能在普通 refactor pass 中重命名 key 或改变 JSON payload 格式。
- 如果要迁移 key/schema，应新增显式 migration，保留旧值读取和回写策略。

验证：

- `test/unit/sidebar/modelPreferences.test.ts`
- `test/unit/sidebar/promptStore.test.ts`
- 手动 preferences smoke：模型、reasoning effort、自定义 prompt 保存后重启仍存在。

### Conversation storage format

文件：

- `src/store/conversationStore.ts`
- `src/store/conversationPaths.ts`
- `src/store/conversationSchema.ts`
- `src/shared/conversation.ts`

稳定格式：

- metadata: `<profile>/zopilot/conversations/workspaces/<workspaceKey>/<conversationId>.json`
- messages: `<profile>/zopilot/conversations/workspaces/<workspaceKey>/<conversationId>.jsonl`
- workspace identity/message shape 由 `src/shared/conversation.ts` 定义。

当前行为：

- workspace-scoped session history 隔离保存。
- 旧消息缺失 mentions/local attachments 时仍可解析。
- 无效 metadata/messages 会显式失败或跳过，具体行为由现有 store tests 覆盖。

重构约束：

- 可以移动路径和 schema helper，但不能改变目录结构、文件扩展名、message JSONL 语义。
- 新字段应向后兼容；删除字段需要 migration。

验证：

- `test/unit/store/conversationStore.test.ts`
- `npx tsc --noEmit`

## Local HTTP/MCP 接口

### Zotero HTTP endpoint

文件：

- `src/mcp/httpServer.ts`
- `src/mcp/protocol.ts`
- `src/mcp/paperBinding.ts`
- `src/mcp/tools/paperRead.ts`

稳定接口：

- endpoint path: `/zopilot/mcp`
- transport: Zotero local HTTP server, POST JSON-RPC
- auth: per-session Bearer token
- exposed tool: `paper_read`
- MCP protocol version: `2025-06-18`

当前行为：

- endpoint 注册到 `Zotero.Server.Endpoints[MCP_ENDPOINT_PATH]`。
- 只接受 loopback host/origin 和正确 Bearer token。
- `paper_read` 通过 binding headers 解析 workspace scope，并返回 text content 与 structured context。

重构约束：

- 不要在普通 refactor 中改 path、auth header 行为、tool name、JSON-RPC result/error shape。
- handler factory `createMcpHttpHandler` 目前被单测直接使用；如果收窄导出，先提供测试替代入口。

验证：

- `test/unit/mcp/httpServer.test.ts`
- `test/unit/mcp/paperReadTool.test.ts`
- `test/unit/codex/mcpConfig.test.ts`

### Paper binding headers

文件：`src/mcp/paperBinding.ts`

稳定 header names：

- `X-Zopilot-Conversation-ID`
- `X-Zopilot-Workspace-Key`
- `X-Zopilot-Workspace-Type`
- `X-Zopilot-Workspace-Label`
- `X-Zopilot-Collection-Key`
- `X-Zopilot-Collection-Path`
- `X-Zopilot-Item-Key`
- `X-Zopilot-Paper-Key`
- `X-Zopilot-Parent-Item-ID`
- `X-Zopilot-Parent-Item-Key`
- `X-Zopilot-Paper-Title`
- `X-Zopilot-Attachment-Item-ID`
- `X-Zopilot-Attachment-Key`
- `X-Zopilot-Library-ID`

重构约束：

- Header names are effectively protocol. Do not rename them without a Codex MCP compatibility migration.

验证：

- `test/unit/mcp/httpServer.test.ts`
- `test/unit/mcp/paperReadTool.test.ts`

## Codex CLI/app-server 接口

文件：

- `src/codex/appServerConfig.ts`
- `src/codex/bridge.ts`
- `src/codex/cliDiscovery.ts`
- `src/codex/diagnostics.ts`
- `src/codex/mcpConfig.ts`

稳定 behavior:

- Codex process starts with `codex app-server --stdio`.
- GUI PATH discovery checks Homebrew/default shell paths before failing.
- Bridge sends `initialize`, `model/list`, `thread/start`, `turn/start`, `turn/interrupt`.
- `thread/start` receives paper binding developer instructions and MCP server config.
- Streaming notifications are demultiplexed by thread/turn.

重构约束：

- Internal helpers may move, but app-server method names, timeout behavior, selected model/effort forwarding, MCP config injection, and interrupt semantics should stay unchanged.
- Codex app-server itself is experimental; any protocol update should be a separate compatibility migration.

验证：

- `test/unit/codex/bridge.test.ts`
- `test/unit/codex/diagnostics.test.ts`
- `test/unit/codex/cliDiscovery.test.ts`
- `test/unit/codex/mcpConfig.test.ts`

## Zotero UI integration surface

文件：

- `src/modules/sidebar/controller.ts`
- `src/modules/sidebar/contextPane.ts`
- `src/modules/sidebar/readerToolbar.ts`
- `src/zotero/reader.ts`

Stable user-visible behavior:

- Reader toolbar button toggles the Zopilot context pane.
- Sidebar follows selected PDF reader/workspace and keeps session history scoped by workspace.
- Context pane adapter integrates with Zotero native item/notes side navigation.
- Reader locator navigation opens or focuses Zotero reader locations.

重构约束：

- Do not change toolbar button id, context pane element ids, CSS class names, or workspace switching semantics in structural passes.
- Private Zotero APIs such as reader internals should eventually move behind a compatibility layer, but that is a separate guarded pass.

验证：

- `test/unit/sidebar/controller.test.ts`
- `test/unit/sidebar/activeReader.test.ts`
- `test/unit/sidebar/readerNavigation.test.ts`
- 真实 Zotero reader smoke：toolbar render、open/close sidebar、switch PDF tabs、navigate page locator。

## Test-only and repo-internal exports

### Explicit test-only export

文件：`src/modules/sidebar/controller.ts`

导出：

- `__sidebarControllerTestHooks`

用途：

- `test/unit/sidebar/controller.test.ts` 用它访问 `SidebarController` 和 `getSidebarSelectionText`。

重构约束：

- 可以保留现状。
- 如果后续收紧，应先把 controller tests 改为通过 public registration path 或 dedicated test harness 访问，不要在同一 pass 中混入行为改动。

验证：

- `test/unit/sidebar/controller.test.ts`

### Internal module APIs currently imported by tests

这些导出主要是 repo 内边界，不是对外用户 API，但单测依赖它们作为稳定验证点：

- sidebar view/state helpers: `viewModel.ts`, `modelPreferences.ts`, `promptStore.ts`, `readerNavigation.ts`, `attachmentUpload.ts`
- UI render helpers/components: `SidebarApp.tsx`, `MarkdownView.tsx`, `Icon.tsx`, `commandRegistry.ts`, `mentions.ts`, `floatingPosition.ts`
- document pipeline helpers: `pdfHelper.ts`, `contextBuilder.ts`, `chunker.ts`, `retrieval.ts`, `evidence.ts`, `materialCache.ts`, `sourceResolver.ts`
- Codex/MCP helpers: `bridge.ts`, `diagnostics.ts`, `cliDiscovery.ts`, `mcpConfig.ts`, `httpServer.ts`, `paperRead.ts`
- store/schema helpers: `conversationStore.ts`, `conversationSchema.ts`, `conversationPaths.ts`

重构约束：

- Prefer moving implementation under the same exported function/type names first.
- Rename/remove exports only after all importers are migrated in the same small pass.
- Avoid adding broad barrel files until there is a clear ownership boundary; current direct imports make dependencies explicit.

验证：

- `npm run test:unit`
- `npx tsc --noEmit`

## Follow-up candidates

These are not part of this audit implementation, but are now scoped for later passes:

- Add `noUnusedLocals` / `noUnusedParameters` as a non-blocking CI check after current dead code cleanup lands.
- Split explicit test hooks into `*.testHarness.ts` modules if controller tests keep needing private access.
- Add comments or naming for exports that are protocol/public contracts (`MCP_ENDPOINT_PATH`, paper binding headers, preference keys).
- Review dependency hygiene separately: `@base-ui/react` appears unused, and `test/ts-loader.mjs` directly imports `esbuild` without a direct dependency.

## Validation commands for this audit

Run after any API-boundary refactor:

```bash
npm run test:unit -- --reporter dot
npx tsc --noEmit
npx --yes madge --extensions ts,tsx --ts-config tsconfig.json --circular src
npx --yes madge --extensions ts,tsx --ts-config tsconfig.json --orphans src
```
