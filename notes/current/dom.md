# Zopilot DOM / Zotero API 风险登记表

最后更新：2026-07-15  
支持范围：Zotero `9.0.*`  
验证基线：Zotero 9.0.6；发布时增加最新 9.0.x

## 1. 治理结论

Zopilot 自有 UI 已在节点所属窗口 Realm 中运行。插件 sandbox 不再写入
`window`、`document`、DOM constructors 或 observer。Reader/Library 全高侧栏没有公开的
等价注册 API，因此保留一层受控 DOM 兼容实现；MCP 入口同样保留
`Zotero.Server.Endpoints` 兼容层。

所有剩余例外必须满足以下条件：

1. 位于登记的兼容文件中；
2. 使用前完成 capability probe；
3. 失败时回滚或只禁用对应能力；
4. 有单元测试和真实 Zotero smoke test；
5. 明确未来删除条件。

`npm run check:api` 对禁用 API 和例外路径执行静态门禁。

## 2. 稳定级别

| 级别                        | 含义                                        | 使用策略                            |
| --------------------------- | ------------------------------------------- | ----------------------------------- |
| A：官方公开 API             | Zotero 文档或稳定类型公开的插件 API         | 正常使用，升级时回归                |
| B：Gecko 平台 API           | Firefox/Gecko 模块和 DOM 标准               | 只能经 `src/platform/gecko.ts` 使用 |
| C：有探测的 Zotero 兼容 API | Zotero 内部 DOM、XUL 或内部全局对象         | 只能位于登记兼容层，必须可恢复      |
| D：禁止的私有 API           | 下划线字段、原始数据库、跨 Realm globals 等 | 源码门禁禁止                        |

## 3. 当前风险登记

| ID     | 能力                                           | 级别 | 使用原因                                                                                                                               | Capability probe                                                           | 失败策略                                                     | 测试                                                 | 删除条件                              |
| ------ | ---------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| DOM-01 | Reader Context Pane 全高 deck                  | C    | `ItemPaneManager` section 不能等价提供 Reader 全高聊天                                                                                 | `probeContextPane()` 验证全部 selector、直接父子关系和 deck selection 能力 | 不创建半挂载节点；恢复 collapsed；关闭 Zopilot               | XUL 非 `HTMLElement`、幂等 attach、真实 Reader smoke | Zotero 提供 full-height pane API      |
| DOM-02 | Library Item Pane 全高 deck                    | C    | 保留 Library 全高聊天体验                                                                                                              | `probeLibraryItemPane()` 验证 item pane、deck、sidenav 和 selection 能力   | 不可用时关闭 Zopilot；恢复 selected panel 与 collapsed       | 嵌套切换、注销/注册、真实 Library smoke              | Zotero 提供 full-height pane API      |
| DOM-03 | XUL `createXULElement` 与 deck `selectedPanel` | C    | Zotero 9 deck 的节点和选择模型仍为 XUL                                                                                                 | 创建函数存在性与 `selectedPanel`/`selectedIndex` 二选一探测                | XHTML section fallback；无法选择时放弃挂载                   | XUL vbox Realm 测试、Zotero 9.0.x 矩阵               | 宿主迁移到公开 HTML pane API          |
| DOM-04 | Context/Library 内部 selectors                 | C    | 定位全高宿主、sidenav 和原生 panel                                                                                                     | probe 返回结构化缺失 selector、原因和 Zotero 版本                          | 仅禁用侧栏宿主，不影响普通插件启动                           | probe/重复节点/布局 smoke                            | 公开 pane API 可替代                  |
| DOM-05 | `ZoteroContextPane.collapsed`                  | C    | 无公开方法展开 Reader Context Pane，且不能再点击 Reader iframe 内部按钮                                                                | 检查对象和 boolean property；写入异常立即回滚                              | 完整回滚并报告宿主不可用                                     | 打开/关闭、shutdown 条件恢复                         | Zotero 提供公开展开 API               |
| API-01 | `Zotero_Tabs` 与 `ZoteroPane` selection        | C    | 识别 Library/Reader tab 和当前树选择                                                                                                   | 检查对象、selected type/id 和返回 row/item 的结构                          | 返回未选择状态，不扩大 workspace                             | tab notifier 与 selection 单元/真实 smoke            | 官方 tab/selection API 可替代         |
| API-02 | `Zotero.Server.Endpoints`                      | C    | 在 Zotero 本地 HTTP server 暴露受 token 保护的 MCP                                                                                     | registry、path 和 constructor 所有权探测                                   | 仅禁用 MCP并返回 `{status:"disabled", diagnostic}`；聊天继续 | path conflict、幂等注册、所有权注销                  | Zotero 提供公开 endpoint 注册 API     |
| API-03 | `Services.scriptloader` window bundle          | B    | 让 React 和 DOM primitives 在目标主窗口 Realm 运行                                                                                     | 主窗口、root URI、scriptloader 和 runtime factory 校验                     | 不挂载 React host，保留结构化日志                            | build、双窗口/关闭窗口 smoke                         | Zotero 提供每窗口 ES module 插件入口  |
| DOM-07 | `#zotero-pane-stack` portal overlay host       | C    | Library 的 `#zotero-pane` 是 tab deck 子节点，在 Reader 激活时不可见；portal 必须挂到同时覆盖 Library/Reader/Context Pane 的可见 stack | stack 与 panel 属于同一 document、已连接且包含当前 panel                   | 不创建不可见 portal；宿主重建后重新探测并移动唯一 portal     | Library/Reader/stacked 真实鼠标命中与宿主重建测试    | Zotero 提供公开的 chrome overlay root |
| API-04 | IOUtils、PathUtils、Subprocess、ZIP、Clipboard | B    | 文件持久化、PDF helper、后端进程和系统剪贴板                                                                                           | `src/platform/gecko.ts` 统一加载并在缺失时抛出明确错误                     | 对应功能失败，不直接污染 UI Realm                            | platform、PDF helper、clipboard、subprocess 单元测试 | Zotero 提供更高层公开适配器           |
| API-05 | Zotero `FilePicker` module                     | A/B  | Zotero 8/9 推荐的文件选择包装器                                                                                                        | module export 和 `FilePicker` constructor 探测                             | 上传附件操作失败并显示错误，聊天本身可继续                   | cancel、多选、PDF/image filters                      | 无；随 Zotero 官方模块演进            |
| DOM-06 | Markdown HTML sink                             | A    | Markdown、KaTeX、Shiki 需要结构化 HTML                                                                                                 | 只接受 `SanitizedHtml` 品牌类型                                            | sanitizer 返回空/安全子集；原始 HTML 禁用                    | URL、raw HTML、标签/属性白名单测试                   | React Markdown 渲染器可等价替代时评估 |

## 4. 已清除的禁止项

以下项目属于 D 级，已删除并由静态检查禁止重新引入：

- `reader._iframeWindow`、`reader._initPromise`、`Zotero.Reader._readers`；
- `_unregisterEventListenerByPluginID` 和 Legacy Reader Toolbar cleanup；
- `Zotero.DB` 及 SQLite schema 查询；
- `Zotero.Profile.dir`；
- 插件 Realm 的 `globalThis.window/document` 与 DOM constructor 注入；
- 业务/UI 层直接访问 `Components`、`ChromeUtils`、`IOUtils`、`PathUtils`；
- `zotero-plugin-toolkit` 和 `ztoolkit` global；
- 全文档 `childList + subtree` observer；
- portal 挂到 `documentElement`；
- 静态复制图标的 `innerHTML` 写入。

## 5. 宿主不变量

每个 Zotero 主窗口必须始终满足：

- 最多一个 Reader panel、Library panel、对应按钮、portal、stylesheet 和 React root；
- panel 使用 `Element`、`ownerDocument`、`isConnected` 和节点身份验证，不使用
  `HTMLElement` 判断 XUL；
- panel、mount node 和 React root 未变化时，reconcile 不调用 attach、`onReady` 或
  `root.render`；
- 唯一 `HostMutationCoordinator` 只观察已探测宿主及祖先链的直接 `childList`，属性仅限
  `collapsed`、`view-type` 和登记的选择状态；
- Zopilot 消息/Markdown/portal 子树变化不会触发宿主 reconcile；
- observer、RAF、timeout、listener 和 Zotero subscription 都有对称 disposer；
- `window-unload` 只释放引用；`plugin-shutdown` 在宿主仍存活时条件恢复状态；
- 恢复只在当前值仍等于 Zopilot 写入值时执行，避免覆盖并发宿主变化。

## 6. 升级与发布矩阵

每次 Zotero 9.0.x 升级和正式发布前执行：

- [ ] Library 与 PDF Reader 中打开、切换、关闭 Zopilot；
- [ ] stacked/narrow layout 和 Reader tab 切换；
- [ ] unregister/register 后没有重复 panel/button/portal/style/root；
- [ ] 插件 shutdown 后 selected panel、collapsed、class 和 ARIA 恢复；
- [ ] 100 次流式更新不增加 mount，消息 DOM mutation 不调度宿主 reconcile；
- [ ] 连续 20 次开关及 Library/Reader 切换无 controller、timer、listener 累积；
- [ ] 双窗口可用时，关闭一个窗口后另一个窗口继续工作；
- [ ] 发送“你好”，回答完成后观察 5 分钟：最后 60 秒 CPU 均值不超过空会话基线
      10 个百分点，且无持续 10 秒以上高于基线 30 个百分点；
- [ ] `npm run build`、`npm run test:unit`、`npm test`、`npm run lint:check` 全部通过。

## 7. 参考资料

- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero 8 for Developers](https://www.zotero.org/support/dev/zotero_8_for_developers)
- [Zotero JavaScript API](https://www.zotero.org/support/dev/client_coding/javascript_api)
