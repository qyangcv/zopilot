# Zopilot 非公开依赖

最后更新：2026-07-16  
支持版本：Zotero 9.0.x

## 当前情况

- 已知的危险私有 API：**0 处**
- 仍需保留的非公开依赖：**8 项**

“非公开依赖”是指：Zotero 内部存在，但官方没有承诺长期保持不变的接口或页面结构。
Zotero 升级后，它们可能发生变化。

这些依赖主要用于保留 Zopilot 的全高侧栏。Zotero 目前没有公开 API 可以实现完全相同的界面。

## 依赖清单

| #   | 使用的非公开能力              | 用来做什么                       | 失效时怎么处理                     |
| --- | ----------------------------- | -------------------------------- | ---------------------------------- |
| 1   | Reader 内部面板               | 在 PDF Reader 中显示全高 Zopilot | 关闭 Zopilot 面板，不影响 Reader   |
| 2   | Library 内部面板              | 在文库中显示全高 Zopilot         | 关闭 Zopilot 面板，不影响文库      |
| 3   | XUL 面板创建和切换            | 创建并打开全高侧栏               | 无法创建时停止挂载                 |
| 4   | Zotero 内部 DOM ID            | 找到侧栏、导航栏和条目列表       | 找不到时只停用相关功能             |
| 5   | `ZoteroContextPane.collapsed` | 展开 Reader 右侧区域             | 写入失败时恢复原状态               |
| 6   | `Zotero_Tabs`、`ZoteroPane`   | 获取当前标签页和选中条目         | 获取失败时显示“未选择”             |
| 7   | `Zotero.Server.Endpoints`     | 注册 Zopilot MCP 地址            | 只关闭 MCP，普通聊天继续工作       |
| 8   | `#zotero-pane-stack`          | 显示 Prompt、模型和历史弹窗      | 找不到时不显示弹窗，不创建错误节点 |

## 使用规则

以上依赖必须遵守以下规则：

1. 只能放在专门的兼容层中，不能写进普通业务代码。
2. 使用前必须先检查它是否存在、结构是否正确。
3. 失效时只关闭相关功能，不能影响 Zotero 或普通聊天。
4. 关闭插件时必须恢复 Zotero 原来的界面状态。
5. 必须有单元测试和真实 Zotero 测试。
6. Zotero 提供公开替代 API 后，应删除对应依赖。

主要兼容层位于：

- `src/features/sidebar/host/`
- `src/integrations/zotero/reader.ts`
- `src/integrations/zotero/selectedWorkspace.ts`
- `src/integrations/zotero/compat/`

## 已经删除的危险用法

以下用法已经清除，并通过静态检查禁止重新加入：

- Reader 的 `_iframeWindow`、`_readers`、`_initPromise`
- 直接查询 `Zotero.DB` 和 SQLite
- 使用 `Zotero.Profile.dir`
- 向全局写入 `window`、`document` 和 DOM 类型
- 在业务代码中直接使用 Gecko 底层对象
- 全页面 DOM 变化监听
- `ztoolkit` 全局对象
- 未清洗的 HTML 写入

运行以下命令可以检查这些危险用法是否被重新引入：

```bash
npm run check:api
```
