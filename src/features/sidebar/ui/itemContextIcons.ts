import type { ItemContextNode } from "../../../domain/conversation";
import type { IconName } from "./Icon";

const ITEM_CONTEXT_ICONS = {
  note: "notebookText",
  pdf: "file",
  unsupportedAttachment: "paperclip",
} as const satisfies Record<string, IconName>;

function iconForItemContextNode(node: ItemContextNode): IconName {
  if (node.kind === "pdf") return ITEM_CONTEXT_ICONS.pdf;
  if (node.kind === "note") return ITEM_CONTEXT_ICONS.note;
  return ITEM_CONTEXT_ICONS.unsupportedAttachment;
}

export { ITEM_CONTEXT_ICONS, iconForItemContextNode };
