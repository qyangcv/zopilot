# Zopilot 区域提问与区域便签回写方案

## 1. 目标与范围

本方案用于交给下游 AI 实施以下能力：

1. Zopilot composer 支持 macOS Cmd+V 粘贴图片。
2. Zotero PDF Reader 中使用“选择区域”创建图片 annotation 后，右键区域显示“询问 Zopilot”。
3. 点击后打开当前 PDF 的 Zopilot 会话；没有会话时创建一个。
4. 将区域图片放入 composer，用户输入问题并发送。
5. 用户明确要求或点击“写入区域便签”后，模型调用工具，将不超过 1200 字的总结写入区域 annotation comment。

本次是调研和工程方案，不直接修改源码、不修改 Zotero 文献库、不上传用户图片或密钥。附带图片只作为 Zotero 区域 annotation 和右键菜单的界面参考。

## 2. 当前源码调研

### 2.1 已有图片管线

当前 Zopilot 已有 LocalAttachmentRef、图片附件 chip、LocalAttachmentPreparer、BYOK input_image、会话附件持久化和 provider images capability。图片输入的大小限制为单张 10 MiB、单轮总计 30 MiB、单轮最多 10 张模型图片。

因此，粘贴图片不需要新建 provider 协议。主要工作是把剪贴板图片安全地落盘为 LocalAttachmentRef，并接入现有 composer。

### 2.2 composer 入口

核心文件：

- src/features/sidebar/ui/ComposerEditor.tsx：原生 textarea；
- src/features/sidebar/ui/hooks/useComposerDraft.ts：草稿、附件、mention 和提交；
- src/features/sidebar/ui/composerBindings.ts：UI binding；
- src/features/sidebar/ui/types.ts：SidebarActions 和 submission；
- src/features/sidebar/host/SidebarHostController.ts：提交和 workspace/session 编排；
- src/application/agent/LocalAttachmentPreparer.ts：图片/PDF 准备。

当前 textarea 没有图片 onPaste。

### 2.3 Reader/annotation 入口

当前 Zopilot 没有 Reader context menu listener，也没有 annotation comment 写回逻辑。

本地 zotero-types 已包含 Zotero.Reader.registerEventListener 的 createAnnotationContextMenu 契约。事件参数包含 reader、ids、currentID、x、y 和 append；append 可加入 label、disabled、persistent、onCommand 菜单项。

区域图片 annotation 应识别为 annotationType 等于 image。可使用 Zotero.Annotations.toJSON、Zotero.Annotations.getCacheImagePath、annotationItem.annotationComment、annotationPosition、annotationPageLabel 和 saveTx。

MVP 应使用 Reader 公开事件接口和 annotation API，不监听 PDF iframe 私有 DOM，不使用 reader 的下划线字段或 PDF.js 私有对象。

### 2.4 MCP 入口

当前 MCP 链路为：

    /zopilot/mcp -> httpHandler -> registerPaperTools -> PaperToolsService

Codex 和 BYOK 共用 Server。现有 get_outline、search、read、view_page 是论文只读工具。区域写回应新增独立 annotation tool。

## 3. 用户交互

### 3.1 Cmd+V 粘贴图片

1. textarea 收到 ClipboardEvent。
2. 仅当剪贴板包含 PNG、JPEG、WebP 或 GIF 时拦截；纯文本粘贴保持原生行为。
3. 将 Blob 写入 Zotero profile 下的 zopilot/attachments/clipboard 目录。
4. 创建 LocalAttachmentRef，合并到当前 composer。
5. 显示图片附件 chip，并保持 textarea 焦点。
6. 用户输入问题并发送，复用现有 provider 图片管线。

图片 Base64 不进入 React state、SQLite conversation JSON、日志或 tool trace；持久化对象只保存路径、文件名、MIME 和 ID。

### 3.2 选择区域后询问

流程为：

    PDF Reader 选择区域
      -> image annotation
      -> 右键 annotation
      -> createAnnotationContextMenu
      -> 询问 Zopilot
      -> 读取 annotation cache PNG
      -> 复制到 Zopilot 持久化附件目录
      -> 打开/创建当前 PDF workspace 会话
      -> 图片进入 composer
      -> 用户输入问题并发送

点击菜单后不自动发送问题。composer 应聚焦，让用户输入自然语言问题。

### 3.3 写入区域便签

支持两种明确确认方式：

1. 用户输入“把刚才的回答总结后写进区域便签”；
2. Assistant 消息 footer 显示“写入区域便签”按钮，按钮提交明确的写入请求。

普通回答完成后不能自动写入 annotation comment。写入成功后显示“已写入区域便签”，失败则保留回答并显示原因。

## 4. 数据模型

### 4.1 RegionContextRef

在 src/domain/conversation.ts 增加一个可选的区域引用，字段包括：

- id：建议为 region:<libraryID>:<annotationKey>；
- libraryID；
- parentItemID、parentItemKey；
- attachmentItemID、attachmentKey；
- annotationItemID、annotationKey；
- annotationType，固定为 image；
- pageIndex、pageLabel；
- title。

不要保存 Zotero cache 路径。

### 4.2 Thread 和 conversation

ThreadContextSnapshot 增加可选 regionContext。ConversationMetadata 增加可选 activeRegion，用于下一条消息单独说“写入便签”时确定目标。

用户切换 workspace、新建会话或明确清除区域时清除 activeRegion。旧 thread 没有新字段时仍需正常读取。

同步修改：

- src/domain/conversation.ts；
- src/domain/thread.ts；
- src/runtime/persistence/threads/ThreadService.ts；
- src/runtime/persistence/threads/threadCodec.ts；
- legacyTypes.ts/LegacyConversationCodec.ts；
- sidebar state/viewModel.ts；
- sidebar ui/types.ts。

新增 isRegionContext()，校验 library、attachment、annotation key、image 类型和页码。

## 5. Clipboard 图片实施

### 5.1 新模块

建议新增 src/features/sidebar/context/clipboardAttachment.ts，职责包括：

- 识别剪贴板图片 MIME；
- 读取 Blob 字节；
- 使用 geckoIO/geckoPath 创建 profile 下持久化目录；
- 生成安全文件名和稳定附件 ID；
- 限制单文件 10 MiB、单轮总图片 30 MiB；
- 失败时清理半成品文件；
- 不记录图片内容。

与 LocalAttachmentPreparer 保持一致，只接受 PNG、JPEG、WebP、GIF。TIFF/BMP 直接给出不支持提示。

### 5.2 composer 修改

修改 ComposerEditor.tsx、composerBindings.ts、useComposerDraft.ts、ui/types.ts、ContextChips.tsx、sidebar-composer.css 和中英文 addon.ftl。

只有识别到图片时调用 preventDefault。文本粘贴、IME 和 Cmd+V 文本行为不改变。seed 或 paste 操作必须幂等，避免 React 重渲染重复添加附件。

## 6. Reader 区域菜单与图片服务

### 6.1 建议新增文件

    src/integrations/zotero/readerRegionMenu.ts
    src/integrations/zotero/ZoteroAnnotationService.ts

readerRegionMenu.ts 只负责注册/注销 createAnnotationContextMenu、解析 currentID、调用 annotation service 和 SidebarHostController.askAboutRegion。

ZoteroAnnotationService.ts 负责获取 annotation item、验证属于当前 attachment、验证 annotationType 为 image、解析页码、读取 cache image、复制到 Zopilot 持久化目录、读取/写回 annotationComment。

### 6.2 菜单逻辑

使用 Zotero.Reader.registerEventListener("createAnnotationContextMenu", handler, addonID)。

规则：

1. 读取 params.currentID；
2. 找到 annotation item；
3. annotationType 为 image 时启用“询问 Zopilot”；
4. highlight、underline、note、text、ink 不走图片区域 MVP；
5. onCommand 中重新加载 annotation，避免菜单打开和点击执行之间对象变化；
6. MVP 只使用 currentID，不处理多个区域同时写回。

createViewContextMenu 只有 x/y，没有可靠 annotation key。它可以作为后续 raw selection 扩展，不作为本次 MVP 主路径。

### 6.3 图片生命周期

菜单点击时将 cache PNG 复制到：

    <Zotero profile>/zopilot/attachments/regions/<region-id>.png

历史 conversation 引用 Zopilot 自己的路径，不长期引用 Zotero annotation cache。

## 7. Sidebar 编排

### 7.1 RegionAskSeed

增加 RegionAskSeed，包含 region 和 attachment。SidebarHostController 增加 askAboutRegion(reader, seed) 方法。

流程：

1. 确认窗口未销毁；
2. 打开 reader sidebar；
3. 等待 getReadyStateForActiveContext；
4. 复用或创建当前 workspace conversation；
5. 更新 activeRegion；
6. 通过 SidebarState/dispatch 将 seed 送入 composer；
7. composer 合并图片、显示 chip、聚焦 textarea；
8. 不自动发送。

### 7.2 React runtime

当前 SidebarSurface.render 只接收 state/actions。建议新增 primeRegionContext 命令：

    Reader event
      -> SidebarHostController.askAboutRegion
      -> SidebarState.pendingRegionSeed
      -> windowRuntime dispatch
      -> SidebarApp/useComposerDraft
      -> restoreDraft/merge attachments

seed 消费后立即清除，并使用 seed ID 做幂等保护。

## 8. Prompt 和模型上下文

contextAssembler.ts 增加区域上下文块，至少包含 annotationKey、image 类型、pageLabel、sourceId 和 title。

模型指令应明确：

    The user attached the selected region image. Treat it as visual evidence.
    Only write a summary back when the user explicitly asks or confirms.

不要把 cache path、profile path 或图片 Base64 放进 prompt。

## 9. save_region_summary MCP tool

### 9.1 契约

建议新增独立工具 save_region_summary，输入为：

- summary：1 至 1200 字；
- mode：append 或 replace_managed。

工具不允许模型任意传 annotation key。目标从当前 MCP binding/activeRegion 注入，并验证 conversation ID、libraryID、attachmentKey、annotationKey、image 类型和 annotation 存在性。

### 9.2 写入格式

保留用户已有 comment，只管理自己的区块：

    原有用户评论

    【Zopilot 区域总结】
    模型生成的短总结。

重复调用只替换该区块。超过 1200 字返回 summary_too_long，不静默截断。

### 9.3 MCP 修改点

建议新增 src/application/annotation/AnnotationToolService.ts、AnnotationTools.ts 和 src/integrations/mcp/annotationToolsAdapter.ts。

同步修改 httpHandler.ts、connection.ts、workspaceBinding.ts、codex/mcpConfig.ts 和 developerInstructions.ts。PaperToolsService 保持只读。

写工具必须只有在用户明确请求或点击按钮后才可调用。工具失败不能改变旧 comment。

## 10. Codex 与 BYOK

### BYOK

现有 BYOK 已能将 image attachment 变成 input_image，主要复用现有管线。必须验证所选 endpoint 同时支持视觉输入和 tool calls；不支持时显示提示，不能让模型声称看到了图片。

### Codex CLI

当前 Codex backend 将本地附件路径放入 prompt，必须在实机验证：

- read-only sandbox 是否允许访问 profile 下 PNG；
- 是否需要复制到 Codex runtime cwd；
- 是否需要 turn/start 的 image input；
- tool call 能否看到 activeRegion。

如果 Codex 不能读取图片路径，必须补充真正的图片投递，不能把“路径写进 prompt”当作已经支持视觉输入。

## 11. 文件修改清单

### Domain / persistence

- domain/conversation.ts；
- domain/thread.ts；
- runtime/persistence/threads/ThreadService.ts；
- runtime/persistence/threads/threadCodec.ts；
- legacyTypes.ts/LegacyConversationCodec.ts；
- sidebar/state/viewModel.ts；
- sidebar/ui/types.ts。

### Clipboard / composer

- sidebar/context/clipboardAttachment.ts；
- ComposerEditor.tsx；
- composerBindings.ts；
- useComposerDraft.ts；
- ComposerFooter.tsx、Message.tsx；
- SidebarApp.tsx、windowRuntime.tsx；
- SidebarHostController.ts；
- createSidebarActions.ts；
- locale 与 sidebar CSS。

### Zotero integration

- integrations/zotero/readerRegionMenu.ts；
- integrations/zotero/ZoteroAnnotationService.ts；
- app/registerHooks.ts；
- integrations/zotero/types.ts。

### MCP / prompt

- application/annotation/AnnotationToolService.ts；
- application/annotation/AnnotationTools.ts；
- integrations/mcp/annotationToolsAdapter.ts；
- integrations/mcp/httpHandler.ts；
- integrations/mcp/workspaceBinding.ts；
- integrations/codex/mcpConfig.ts；
- application/agent/prompt/contextAssembler.ts；
- application/agent/prompt/developerInstructions.ts。

不编辑 dist、.scaffold 或生成 bundle。

## 12. 测试方案

### Unit tests

1. clipboardAttachment.test.ts：MIME、大小、写入失败、路径安全。
2. regionContext.test.ts：image 合法、其他 annotation 拒绝、跨库校验。
3. annotationSummary.test.ts：原 comment 保留、marker 替换、1200 字边界。
4. threadCodec.test.ts：旧数据兼容和新字段 round-trip。
5. mcpAnnotationTools.test.ts：无 active region、错误 key、跨 attachment、成功写回。
6. composerDraft.test.ts：seed 单次消费、图片/region 同步提交、session 切换清理。

### Scaffold tests

- createAnnotationContextMenu 注册和注销；
- image annotation 添加菜单；
- 非 image annotation 不添加；
- 多窗口不重复注册；
- 主窗口 unload/shutdown 清理 listener。

### Zotero 10 smoke test

1. PDF Reader 选择区域并创建 image annotation；
2. 右键区域，确认“询问 Zopilot”；
3. 点击后确认 sidebar、当前/新会话和图片 chip；
4. 输入问题，确认 BYOK 视觉模型收到图片；
5. 验证 Codex CLI 图片可见性；
6. 点击“写入区域便签”；
7. 确认 annotation comment 更新；
8. 重启 Zotero 后确认 comment 和会话；
9. 删除 annotation 后确认写回失败可解释；
10. highlight/note/ink 不出现图片区域入口；
11. composer 直接 Cmd+V 图片独立可用。

## 13. 验收标准

### P0：粘贴图片

- [ ] Cmd+V 后出现图片 chip；
- [ ] 普通文本粘贴不受影响；
- [ ] 图片进入 conversation localAttachments；
- [ ] BYOK 视觉模型可以看到图片；
- [ ] Base64 不写入日志、trace 或 SQLite。

### P1：区域菜单问答

- [ ] Reader 原生 annotation context menu 出现“询问 Zopilot”；
- [ ] 仅 image annotation 启用；
- [ ] 区域 PNG 被复制到 Zopilot 持久化目录；
- [ ] 当前 PDF workspace 会话复用或创建；
- [ ] 图片进入 composer，不自动发送；
- [ ] 用户能提问和追问。

### P2：写入便签

- [ ] 只有明确按钮/命令才写回；
- [ ] tool 只更新 active region；
- [ ] 原 comment 保留；
- [ ] summary 不超过 1200 字；
- [ ] 成功/失败 UI 明确；
- [ ] Reader popup 能看到新 comment。

### 稳定性

- [ ] Reader listener 在 reload/shutdown 注销；
- [ ] Reader/PDF/session 切换不会提交旧 region；
- [ ] 旧 thread 继续读取；
- [ ] npm run test:unit、npm run lint:check、npm run build 通过；
- [ ] 宿主 API 变更运行 npm test，实机需求运行 npm run start。

## 14. 风险与处理

| 风险                         | 影响               | 处理                                      |
| ---------------------------- | ------------------ | ----------------------------------------- |
| Reader 菜单 API 变化         | 菜单不出现         | capability probe，单独禁用菜单功能        |
| Zotero 清理 annotation cache | 历史图片失效       | 菜单点击时复制到 Zopilot 目录             |
| Provider 不支持图片          | 模型看不到区域     | notice，禁止模型声称看到                  |
| Codex 不能读取 profile 路径  | Codex 区域问答失败 | runtime 可读目录或真正 image input        |
| 模型自动写 comment           | 意外修改用户数据   | tool 只在明确请求/按钮后可用              |
| 原有 comment 被覆盖          | 便签丢失           | marker 区块替换，保留原文                 |
| 多区域选择                   | 目标不明确         | MVP 只使用 currentID                      |
| annotation 删除              | 写回失败           | annotation_not_found，历史图片保留        |
| 私有 DOM 依赖                | Zotero 升级崩溃    | 只使用 Reader event 和公开 annotation API |

## 15. 实施顺序

### Phase 1：Clipboard image MVP

clipboardAttachment 服务、composer onPaste、chip、提交、限制、unit tests、BYOK/Codex smoke test。

### Phase 2：Reader 询问菜单

annotation service、createAnnotationContextMenu、cache PNG 复制、sidebar region seed、session/codec 测试、Zotero 10 smoke test。

### Phase 3：MCP 写回

RegionContextRef/activeRegion、prompt/binding、save_region_summary、Codex/BYOK tool call、comment marker、写回和用户确认。

### Phase 4：体验完善

图片缩略图、assistant footer 写入按钮、专用 tool trace、disabled reason、accessibility 和多语言。

## 16. 可行性判断

| 能力                   | 可行性 | 依据                                               |
| ---------------------- | -----: | -------------------------------------------------- |
| composer Cmd+V 图片    |     高 | 图片附件和 provider 管线已存在                     |
| Reader annotation 菜单 |     高 | zotero-types 已有 createAnnotationContextMenu      |
| 区域图片读取           |     高 | annotation cache path 和 image annotation API 可用 |
| 当前/新会话编排        |     高 | WorkspaceCoordinator 已有 get-or-create 逻辑       |
| BYOK 区域视觉问答      |     高 | input_image 已实现                                 |
| Codex 区域视觉问答     |   中高 | 需要验证 Codex 对本地路径/图片的访问               |
| MCP comment 写回       |   中高 | API 可用，但需要严格 scope 和保存测试              |
| 默认自动写便签         | 不建议 | 应由用户明确确认后调用写工具                       |

整体结论：MVP 可行性高。主要待验证点是 Codex 图片投递和 Zotero 10 中 annotation comment 保存后的 Reader 刷新；两者可以在 Phase 1/2 的实机测试中隔离，不需要重写 Zopilot 对话架构。

## 17. 下游 AI 执行指令

1. 阅读并遵守 zopilot/AGENTS.md。
2. 先阅读现有源码和测试，再开始修改。
3. 按 Clipboard -> Reader menu -> MCP writeback 顺序实施。
4. 先写回归测试，再改运行时代码。
5. 不编辑 dist、.scaffold 或生成 bundle。
6. Zotero/Gecko 兼容访问集中在兼容层，并运行 npm run check:api。
7. 不提交 Base64、用户 PDF、profile、API key、token 或真实论文内容。
8. 不覆盖用户 annotation comment。
9. 在 Zotero 10.0.4 实机验证菜单、图片输入和 comment 写回。
10. 交付 commit、测试结果、已知限制和可安装 XPI。

建议 commit message：

    feat(sidebar): ask Zopilot about PDF regions and save summaries

## 18. 参考资料

- https://www.zotero.org/support/pdf_reader
- https://www.zotero.org/support/kb/keyboard_shortcuts
- https://www.zotero.org/support/kb/annotations_in_database
- https://github.com/zotero/zotero/blob/main/types/xpcom/reader.d.ts
- https://gist.github.com/EwoutH/04c8df5a97963b5b46cec9f392ceb103/79c02c1a45f4145054cb9393a550049319cb69e3
- https://github.com/windingwind/zotero-actions-tags/discussions/220
- https://github.com/qyangcv/zopilot
