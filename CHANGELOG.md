# Changelog

## 0.8.3

- Add the Reader image annotation context menu entry for asking Zopilot about a region.
- Copy selected region PNGs into Zopilot-owned profile storage before attaching them.
- Open or reuse the current PDF workspace and focus the Composer without auto-sending.

## 0.8.2

- Add Cmd+V image attachments to the composer for PNG, JPEG, WebP, and GIF images.
- Store pasted images under the Zotero profile without putting image bytes in
  conversation state or logs.
- Keep text paste behavior unchanged and ignore unsupported clipboard formats.

## 0.8.1

- Update the Zotero compatibility range to include Zotero 10 (`10.*`).
- Keep the plugin ID and runtime behavior unchanged.
- Preserve the existing Zotero 10 runtime guards for selected items, PDF readers,
  and optional MCP endpoint registration.
