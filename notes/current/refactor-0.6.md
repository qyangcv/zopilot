# Zopilot 0.6 重构实施记录

本轮重构已经落地完成。以下“重构前审计”保留为问题基线；旧目录、兼容 facade 和重复实现均已从正式源码中清除，而不是只给出迁移建议。

## 已完成结果

### 1. 重点职责过载

- `sidebar/controller.ts`（1629 行）已拆为 `SidebarHostController`、`SidebarSurface`、`SidebarHostBindings`、`WorkspaceCoordinator`、`TurnCoordinator`、`ProviderCatalogController`、`SessionCoordinator`、`SidebarContextActions` 和 state projector。Host 只保留生命周期与协调职责。
- `SidebarApp.tsx`（原约 690 行）已拆为 Header、ConversationLog、Composer、ComposerEditor、ComposerFooter 和四个状态 Hook；DOM ID、class、ARIA 与交互保持不变。
- `WorkspaceSelector.tsx`（原约 440 行）已拆为 selector shell、menu state、menu、row 和 tree builder。
- Codex Bridge 的 JSON-RPC transport、消息解析、turn registry 已独立；BYOK Bridge 的 runtime bundle、消息解析、paper-read gateway 与服务端校验已独立。
- MCP HTTP server 已拆为生命周期、handler 和 transport/security；PDF helper 已拆为状态检测、安装器、manifest、download、zip 与公共编排。
- 两个偏好设置大面板已按新增表单、Provider card、依赖状态、进度和路径列表拆分。

### 2. 重复实现

- Codex/BYOK 共用 `StdioJsonRpcPeer`、process environment、subprocess contracts 和 JSON-RPC protocol。
- path codec、SHA-256、delay、page range、JSON guards、nested JSON accessors、`toError` 和 sidebar backend error formatter 均只有一个实现。
- MCP header 与 BYOK paper-read 共用 workspace binding codec。
- conversation、临时文件、Provider profile、BYOK run 的时间戳随机 ID 共用可配置生成器，同时保留各自原格式。
- Addon 浮层公共视觉规则已合并，偏好设置 CSS 由单个 622 行文件拆为按 shell/navigation/shared/providers/dependencies/prompts/responsive 分类的入口导入结构。

### 3. 最终目录结构

```text
src/
  app/                    # 启动、注册与生命周期
  application/            # 用例编排：agent、provider、document
  domain/                 # 纯 conversation/workspace/agent contracts
  document/               # material、retrieval、pdf-helper
  features/               # sidebar、preferences
  integrations/           # codex、byok、mcp、zotero
  runtime/                # JSON-RPC、进程、持久化、平台和通用基础设施
```

旧的 `src/modules`、`src/agent`、`src/codex`、`src/byokRuntime`、`src/mcp`、`src/zotero`、`src/shared`、`src/store`、`src/utils`、`src/runtime/jsonRpc` 已完全删除；源码和测试均直接引用新路径。

### 4. 最终验证

- `npm run test:unit`：230 项全部通过。
- `npm run lint:check`：Prettier 与 ESLint 通过。
- `npm run build`：生产构建与 `tsc --noEmit` 通过。
- `git diff --check`：通过。
- 179 个 TypeScript/TSX 源文件的相对 import 图：无循环依赖。
- 旧目录存在性、空目录和 compatibility facade 扫描：无遗留。
- 主要热点规模：Sidebar Host 1629→442 行，SidebarApp 约 690→63 行，WorkspaceSelector 440→67 行，Codex Bridge 923→315 行，BYOK Bridge 600→325 行，BYOK Runtime Server 439→169 行。

## 重构前审计基线

扫描范围包括 `src/` 下 112 个 TypeScript/TSX 文件，以及 `addon/` 的启动脚本、清单、偏好、locale、CSS 和静态资源；KaTeX 字体等第三方二进制资产仅核对结构，没有作为源码分析。

重构前基线：

- `npm run test:unit`：215 项全部通过
- `npm run build`：生产构建和 `tsc --noEmit` 通过
- `npm run lint:check`：Prettier、ESLint 通过
- Git 工作区保持不变
- 入口依赖图未发现循环依赖

## 总体判断

代码库功能边界已经成形，测试基础也不错，不适合推倒重写。现代化工作的核心应是：

1. 抽出 Codex/BYOK 共用的进程与 JSON-RPC 基础设施。
2. 拆分超大型侧边栏控制器和 React 根组件。
3. 让 domain、Zotero 适配、持久化、文档检索之间的边界更纯净。
4. 通过兼容导出和行为测试分阶段迁移目录，避免一次性大规模移动。
5. 保留所有 DOM ID、CSS class、偏好键、磁盘格式、RPC 方法和用户可见文案。

## 结构扫描结论

| 区域              | 当前职责                                         | 主要问题                                                                                                                                |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules`     | 侧边栏与偏好设置                                 | 48 文件、8664 行，占源码近一半；顶层其他功能却不在 `modules`，分类标准不一致                                                            |
| `src/agent`       | Provider、Backend、能力与 Prompt 上下文          | 总体清晰，但 Provider 持久化、Backend 生命周期、运行结果语义混在一起                                                                    |
| `src/codex`       | Codex CLI、app-server、JSON-RPC                  | 放入了 BYOK/MCP 也在使用的通用协议代码                                                                                                  |
| `src/byokRuntime` | Zotero 父进程桥接和 Node 子进程                  | 与 Codex 桥接重复大量状态机代码，并反向依赖 `codex/cliDiscovery`                                                                        |
| `src/document`    | PDF helper、material cache、分块、检索、证据打包 | 15 个文件平铺，安装器、缓存和检索管线混在同一层                                                                                         |
| `src/mcp`         | HTTP MCP、workspace binding、`paper_read`        | `paperBinding` 实际绑定整个 workspace，而不只是 paper                                                                                   |
| `src/zotero`      | Reader、collection、source 枚举与 DB fallback    | `sourceUniverse*` 卫星文件平铺；workspace factory 与 source repository 混合                                                             |
| `src/shared`      | 会话与 source 类型                               | 名为 shared，但 [conversation.ts](/Users/yang/code/zotero/zopilot/src/shared/conversation.ts:96) 直接访问 Zotero 全局，不是纯 domain 层 |
| `src/store`       | 会话文件持久化                                   | 格式、路径、校验、原子写入已有拆分，但方法命名和实际状态变化存在偏差                                                                    |
| `addon`           | Scaffold 入口、locale、CSS、vendor               | Scaffold 契约文件应保留；偏好 CSS 单文件 622 行，而侧边栏 CSS 已按职责拆分                                                              |

## 重点职责过载

最显著的三个热点：

- [sidebar/controller.ts](/Users/yang/code/zotero/zopilot/src/modules/sidebar/controller.ts:122)：1629 行、28 个内部依赖，同时负责 Zotero Pane 生命周期、Reader 同步、workspace 切换、会话、模型、流式 Turn、PDF helper gate、React 渲染。
- [SidebarApp.tsx](/Users/yang/code/zotero/zopilot/src/modules/sidebar/app/SidebarApp.tsx:44)：单个组件约 690 行，管理 draft、mention、附件、命令菜单、Prompt、滚动、布局、模型、发送和停止。
- [WorkspaceSelector.tsx](/Users/yang/code/zotero/zopilot/src/modules/sidebar/app/WorkspaceSelector.tsx:20)：主组件约 281 行，数据树构造、展开状态、键鼠交互和渲染耦合。

另外两个 Bridge 也承担了过多底层职责：

- [codex/bridge.ts](/Users/yang/code/zotero/zopilot/src/codex/bridge.ts:79)：923 行
- [byokRuntime/bridge.ts](/Users/yang/code/zotero/zopilot/src/byokRuntime/bridge.ts:79)：600 行

## 明确发现的重复实现

完全相同或高度同构的代码包括：

- Codex/BYOK Bridge 的 `start`、`readStdout`、`readStderr`、stdout/stderr 分帧、pending request、超时和退出清理。
- `PendingRequest`、子进程 stdin/stdout/stderr 类型在多个模块重复声明。
- `encodePathSegment`：
  - [conversationPaths.ts](/Users/yang/code/zotero/zopilot/src/store/conversationPaths.ts:51)
  - [materialCache.ts](/Users/yang/code/zotero/zopilot/src/document/materialCache.ts:258)
- `sha256Hex`：
  - [pdfHelperDownload.ts](/Users/yang/code/zotero/zopilot/src/document/pdfHelperDownload.ts:72)
  - [sourceResolver.ts](/Users/yang/code/zotero/zopilot/src/document/sourceResolver.ts:152)
- `delay`：
  - [reader.ts](/Users/yang/code/zotero/zopilot/src/zotero/reader.ts:94)
  - [sourceUniverseCollections.ts](/Users/yang/code/zotero/zopilot/src/zotero/sourceUniverseCollections.ts:317)
- 页码区间判断：
  - `chunker.samePage`
  - `retrieval.containsPage`
- `isObject`、嵌套 JSON 字符串读取分别出现在 BYOK server/bridge 和 Codex bridge。
- Conversation → workspace query scope 的转换分别存在于 MCP header binding 和 BYOK `callPaperRead`。
- ID 生成分散在 conversation、provider、run、prompt、mention、attachment 模块中。
- `.zp-mention-popover`、`.zp-command-menu`、`.zp-floating-panel`、`.zp-ui-select-popup` 重复相同的边框、背景、阴影和字体规则。

## 命名与实际职责不一致

建议优先处理以下命名：

| 当前名称                         | 实际行为                                         | 建议名称/位置                                          |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `modules/preferenceScript.ts`    | 注册偏好 Pane                                    | `features/preferences/registerPreferencePane.ts`       |
| `preferencesPane.ts`             | 等待 DOM、挂载 React、处理挂载失败               | `mountPreferencesApp.ts`                               |
| `agent/session/contextPolicy.ts` | 构造 provider Prompt                             | `agent/prompt/contextAssembler.ts`                     |
| `codex/jsonRpc.ts`               | Codex、BYOK 共用 JSON-RPC                        | `runtime/jsonRpc/protocol.ts`                          |
| `codex/types.JsonValue`          | 全局 JSON 值类型                                 | `runtime/json/JsonValue.ts`                            |
| `codex/developerInstructions.ts` | Codex 和 BYOK 共用 Agent 指令                    | `agent/prompt/developerInstructions.ts`                |
| `paperBinding.ts`                | Workspace + 可选 paper binding                   | `workspaceBinding.ts`                                  |
| `MaterialCache`                  | Material 构建、缓存验证、磁盘 repository         | `MaterialRepository`                                   |
| `query.ts` / `routeQuery`        | 检索意图和 locator 解析                          | `retrieval/queryParser.ts` / `parseRetrievalQuery`     |
| `evidence.ts`                    | 检索结果打包成 Agent context                     | `retrieval/contextPacker.ts`                           |
| `sourceUniverse.ts`              | Source catalog + workspace factory               | 拆为 `ZoteroSourceCatalog` 和 `ZoteroWorkspaceFactory` |
| `ReaderToolbarController`        | 只清理旧 Toolbar 注册/按钮                       | `LegacyReaderToolbarCleanup`                           |
| `loadModels`                     | 检查所有 Provider 状态并加载模型                 | `refreshProviderCatalog`                               |
| `showBackendDiagnostic`          | 再次发起状态检查并更新 UI                        | `refreshActiveBackendDiagnostic`                       |
| `activateWorkspaceConversation`  | 更新 `updatedAt` 并读取消息                      | `touchConversation` 或显式说明 activation 语义         |
| `listWorkspaceConversations`     | 只列出未归档会话                                 | `listActiveWorkspaceConversations`                     |
| `stripEphemeral`                 | 实际只去除 `hasApiKey`，仍保存 status/diagnostic | `toStoredProviderProfile`                              |

还存在几个数据语义问题：

- `AgentBackend.id`、`backendId` 和 `providerProfileId` 在当前两个 Backend 中实际都使用 Provider profile ID，语义重复。
- `defaultSource` 在 collection/library workspace 中更接近“当前绑定 source”，而不是普通默认值。
- `workspaceLabel` 与 `workspaceTitle` 的构造值目前基本相同，但下游假设它们承担不同展示职责。
- `buildAgentPrompt` 仅用于无状态 BYOK，Codex 则依靠 thread history，只追加 mention/attachment；名称没有体现这种关键差异。
- `searchField(..., _reason)` 接收 reason 但完全不使用，检索原因改由数组下标反推，locator 分支插入结果列表后容易产生错位。
- [paperRead.ts](/Users/yang/code/zotero/zopilot/src/mcp/tools/paperRead.ts:11) 通过 `document/sourceResolver` 的再导出获取 `createSourceId`，形成不必要的间接依赖。

## 拟议优化与稳定性验证

| 优先级                    | 当前行为                                                          | 结构改进                                                                                                                     | 行为保持检查                                                                                 |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P0：补行为契约            | Codex 有 Bridge 测试，但 BYOK bridge/server 缺少直接测试          | 先增加 JSONL transcript、超时、并发、退出、interrupt、反向 tool request 测试                                                 | 固定 RPC method、params、notification 顺序和错误文本；现有 215 项继续通过                    |
| P0：通用运行时层          | 两个 Bridge 各自管理 stdio JSON-RPC                               | 新建 `runtime/jsonRpc`、`runtime/process`，提供带超时的 client、line decoder、process lifecycle                              | Codex 现有并发 Turn 测试；新增 BYOK 初始化、流式 delta、paper_read、cancel、child exit 测试  |
| P0：拆 Sidebar Controller | 一个类处理 Host、Workspace、Turn、Provider、View                  | 保留薄 `SidebarHostController`，拆出 `WorkspaceCoordinator`、`TurnCoordinator`、`ProviderCatalogController`、state projector | stale token、快速切纸、后台流不重绘、cancel、PDF helper gate、session 切换测试逐项对应       |
| P0：拆 React 根组件       | `SidebarApp` 管理所有 UI 状态和 DOM                               | 拆 `SidebarHeader`、`ConversationLog`、`Composer`、`useComposerDraft`、`useMentionPicker`、`useAutoScroll`                   | 保留完整 props、DOM 层级、class、ARIA、快捷键；现有 SidebarApp/Markdown 测试加 DOM snapshot  |
| P1：纯 domain 层          | shared conversation 类型直接访问 Zotero                           | 类型和纯 factory 移至 `domain/`；`createPaperIdentity` 移至 Zotero adapter                                                   | Conversation JSON fixture、workspace key、source ID、MCP header round-trip 必须字节/值一致   |
| P1：Provider 分层         | Store 同时负责 prefs、secret、迁移、规范化、订阅                  | 拆 `ProviderProfileRepository`、`ProviderSecretStore`、codec、catalog factory；Backend manager 只管实例                      | 用旧 prefs fixture 验证读取、active fallback、secret 不进入 snapshot、删除回退 Codex         |
| P1：文档管线分目录        | PDF helper、material 和 retrieval 平铺                            | `document/pdf-helper/`、`document/material/`、`document/retrieval/`；统一 hash、page range、path codec                       | 固定 PDF fixture 比对 chunk/artifact ID、page range、检索顺序、context 文本和 cache manifest |
| P1：MCP/Workspace binding | HTTP 和 BYOK 分别构造 workspace scope                             | 建立 `conversationToWorkspaceQueryScope`；`paperBinding` 改为 transport codec                                                | 同一 conversation 经 HTTP 与 BYOK 调用 `paper_read` 应得到相同 scope 和输出                  |
| P1：Conversation Store    | 每次追加消息都读取并重写 JSONL；repository 与原子 writer 耦合     | 先只拆 `ConversationRepository`、codec、atomic writer，不立即改变写入策略                                                    | 保留目录名、`.json/.jsonl` 格式、ID 前缀、默认 label；旧数据 fixture 完整回读                |
| P2：Zotero Source 模块    | Source 枚举、DB fallback、collection tree、workspace factory 混合 | 迁入 `zotero/sources/`，Repository 与 factory 分离                                                                           | 保留 DB tuple/object row、递归 collection、active PDF 优先和 API fallback 测试               |
| P2：Preferences           | `shared.tsx`、大 Panel 和 Hook 名称宽泛                           | 按 provider/dependency/prompt feature 分目录；`shared.tsx` 改为明确的 `PreferencePageHeader` 等                              | 保留当前可见文案和 `data-l10n-id`，偏好 UI DOM 测试继续通过                                  |
| P2：Addon CSS             | Sidebar 已拆分，preferences.css 仍为 622 行；popover 规则重复     | 保留 CSS 入口和 import 顺序，仅拆文件并抽公共 selector group                                                                 | Zotero 内做 light/dark、窄宽度、popover 定位、滚动、代码块、KaTeX 截图对比                   |
| P3：死代码/类型收紧       | 存在未使用类型、`as any`、`as never` 和弱 JSON 校验               | 删除确认未使用的 `hasCapability`、backend metadata 类型；在 RPC 边界加 validator                                             | `tsc`、ESLint，加 malformed payload 测试；不删除磁盘中仍生成的 `paper.txt` 等兼容产物        |

## 原建议目标结构（已完成）

源码已经收敛为：

```text
src/
  app/                    # 启动与生命周期
  domain/                 # 纯 conversation/workspace/provider contracts
  runtime/
    json-rpc/
    process/
    persistence/
  features/
    sidebar/
      host/
      chat/
      workspace/
      ui/
    preferences/
      providers/
      dependencies/
      prompts/
  integrations/
    codex/
    byok/
    mcp/
    zotero/
  document/
    material/
    retrieval/
    pdf-helper/
```

迁移期使用的旧路径已经全部移除，没有遗留 barrel 或 compatibility export。

## 必须冻结的行为边界

重构过程中以下内容不应顺手改变：

- `addon/bootstrap.js`、`manifest.json`、`prefs.js` 的 Scaffold 契约。
- 所有 `extensions.zotero.zopilot.*` 偏好键。
- Conversation 目录、文件名、JSON/JSONL schema 和 ID 格式。
- `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 等 RPC 方法和参数。
- Codex thread resume/fallback、MCP header、开发者指令和 timeout。
- BYOK 最近 12 条历史、工具调用、stream delta 和中断语义。
- PDF helper 安装目录、manifest schema、checksum、cache 失效条件。
- CSS import 顺序、DOM ID、`zp-*` class、XUL/HTML namespace 和 ARIA 属性。
- 当前用户可见中英文文案。代码里仍有硬编码文案，但迁移到 FTL 可能改变当前英文环境表现，应作为独立 UI 行为变更处理。

## 不应混入本次纯重构的问题

审计还发现一些值得后续单独处理的事项：

- Provider API key 当前以 JSON 字符串存入 Zotero prefs；snapshot 会隐藏，但磁盘存储不是安全凭据库。
- MCP server 版本仍是 `0.0.0`，tool metadata 为 `v0.3.0-light.context`，包版本已是 `0.5.3`。
- PDF source hashing 会整文件读入内存。
- Conversation 的 JSONL 每次追加都会全量重写。
- BYOK RPC 边界存在 `as any`/`as unknown as`，运行时校验弱。
- CSS 中存在疑似未使用的 `.zp-pref-editor-meta`、`.zp-pref-list-card`。
- `ReaderToolbarController` 已不注册按钮，只执行旧按钮清理。

这些可能涉及安全、性能、元数据或可见行为，不应在“功能和 UI 不变”的重构提交中静默修正。

建议实施顺序是：行为契约 → 通用 JSON-RPC/进程层 → Sidebar Controller → React UI 拆分 → 文档/MCP/Store → 目录与命名迁移 → CSS 整理。每一阶段都应独立提交，并运行单测、构建、lint 和 Zotero 实机视觉回归。
