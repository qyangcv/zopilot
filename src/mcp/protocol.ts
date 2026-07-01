import type { JsonValue } from "../codex/types";
import type { BoundWorkspaceScope } from "./paperBinding";

export {
  MCP_PROTOCOL_VERSION,
  createJsonRpcError,
  createJsonRpcResult,
  getJsonRpcId,
  isJsonObject,
};
export type { McpTool, McpToolCallContext, McpToolCallResult };

const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonObject = { [key: string]: JsonValue };

type McpContent = JsonObject & {
  type: "text";
  text: string;
};

type McpToolDefinition = JsonObject & {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonObject;
  annotations?: JsonObject;
};

type McpToolCallResult = JsonObject & {
  content: McpContent[];
  structuredContent?: JsonValue;
  isError?: boolean;
  _meta?: JsonObject;
};

type McpTool = {
  definition: McpToolDefinition;
  call(
    input: JsonValue | undefined,
    context: McpToolCallContext,
  ): Promise<McpToolCallResult>;
};

type McpToolCallContext = {
  workspaceScope?: BoundWorkspaceScope;
  paperBindingError?: string;
};

function createJsonRpcResult(id: JsonValue, result: JsonValue): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function createJsonRpcError(
  id: JsonValue,
  code: number,
  message: string,
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function getJsonRpcId(message: JsonObject): JsonValue {
  const id = message.id;
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
