# Region Ask Zopilot：Phase 2 实现记录

## 本次完成

- 注册 Zotero Reader 的 `createAnnotationContextMenu` 公开事件。
- 仅当当前 annotation 属于正在查看的 PDF attachment 且 `annotationType` 为
  `image` 时，添加“询问 Zopilot”菜单项。
- 点击菜单时读取 Zotero annotation cache PNG，并复制到
  `<Zotero profile>/zopilot/attachments/regions/`。
- 复用或创建当前 PDF workspace conversation，将区域图片作为待处理 Composer
  附件注入并聚焦输入框，不自动发送。
- Reader listener 在插件 shutdown/reload 时注销；跨窗口通过当前 reader 归属匹配
  SidebarHostController。

## 当前边界

- 本阶段只使用 `currentID`，不处理多区域同时写入。
- 当前尚未保存 `RegionContextRef` 或 active region 元数据，因此暂不支持便签写回。
- highlight、underline、note、text、ink annotation 不添加该菜单入口。

## 验证

- `zoteroAnnotationService.test.ts` 覆盖 image 类型过滤、当前 attachment 校验和
  cache PNG 复制。
- `readerRegionMenu.test.ts` 覆盖菜单注册、image annotation 菜单插入和注销。
