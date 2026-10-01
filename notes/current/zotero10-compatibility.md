# Zotero 10 兼容性记录

## 已完成

- addon manifest 的 `strict_max_version` 更新为 `10.*`。
- 插件版本更新为 `0.8.1`，插件 ID 保持 `zopilot@qyangcv.github.io`。
- `getSelectedItems()` 用于主窗口多选；未选择和多选会返回明确的空状态或标题。
- Reader 访问通过 `Zotero.Reader.getByTabID?.()`，Reader 尚未初始化或已关闭时返回空值。
- MCP 注册通过兼容层探测 `Zotero.Server.Endpoints`，接口缺失或路径冲突只禁用 MCP。
- shutdown 会等待插件清理，重载前会等待上一次 shutdown，避免重复注册。
- bootstrap 继续使用 Zotero 10 可用的 `registerChrome()`、`Services.scriptloader` 和
  `onMainWindowLoad`/`onMainWindowUnload` 生命周期。
- 发布配置继续从版本号生成稳定版 `update.json` 地址；本源码树没有单独提交生成后的
  `update.json`，避免把未发布的下载地址写进源码。

## 构建证据

`dist/zopilot-0.8.1.xpi`（另有带 Zotero 10 标记的同内容副本）由源码构建生成，
同时生成了 `dist/update.json`。构建产物中的 manifest、bundle 内嵌版本号和
Zotero 兼容上限保持一致。源码位于工作区的 `zopilot/`。

## 尚未验证

当前环境没有可自动驱动的 Zotero UI 测试会话，所以 Provider、PDF helper、
MCP endpoint 的端到端操作仍需在 Zotero 10.0.4 中按工程计划逐项手工冒烟。
