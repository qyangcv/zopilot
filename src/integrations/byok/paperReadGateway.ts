import type { ConversationMetadata } from "../../domain/conversation";
import { isJsonValue, isRecord } from "../../runtime/json/guards";
import type { JsonValue } from "../../runtime/json/types";
import {
  PAPER_BINDING_MISSING_MESSAGE,
  conversationToWorkspaceQueryScope,
} from "../mcp/workspaceBinding";
import { createPaperReadTool } from "../mcp/tools/paperRead";

async function callPaperRead(
  params: JsonValue | undefined,
): Promise<JsonValue> {
  const value = isRecord(params) ? params : {};
  const conversation = value.conversation as ConversationMetadata | undefined;
  if (!conversation) {
    throw new Error("BYOK runtime paper_read request has no conversation.");
  }
  const toolInput = isJsonValue(value.input) ? value.input : {};
  const result = await createPaperReadTool().call(toolInput, {
    workspaceScope: conversationToWorkspaceQueryScope(conversation),
    paperBindingError: conversation.defaultSource
      ? undefined
      : PAPER_BINDING_MISSING_MESSAGE,
  });
  return {
    text: result.content
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n"),
    isError: Boolean(result.isError),
  };
}

export { callPaperRead };
