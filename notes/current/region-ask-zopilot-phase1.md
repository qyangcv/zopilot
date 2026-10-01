# Region Ask Zopilot：Phase 1 实现记录

## 本次完成

- Composer textarea 现在只拦截包含 PNG、JPEG、WebP 或 GIF 的剪贴板粘贴。
- 纯文本粘贴、组合输入和普通 Cmd+V 行为保持原生处理。
- 图片以字节流写入 `<Zotero profile>/zopilot/attachments/clipboard/`，Composer
  只保存 `LocalAttachmentRef`，不保存 Base64、Blob 或图片内容。
- 单张粘贴图片限制为 10 MiB；发送时继续复用现有图片管线的 30 MiB 总量和
  10 张图片限制。
- 写入失败会清理半成品文件；切换 workspace 或会话时，过期的异步粘贴结果会被丢弃。
- Composer 附件上限沿用现有 `MAX_LOCAL_ATTACHMENTS`。

## 验证

- `clipboardAttachment.test.ts` 覆盖 MIME 过滤、路径、字节写入、大小限制和失败清理。
- `composerEditor.test.tsx` 覆盖 paste 事件绑定。
- 后续 Phase 2 仍需接入 Reader `createAnnotationContextMenu`，本次没有修改 Zotero
  annotation 或文献数据。
