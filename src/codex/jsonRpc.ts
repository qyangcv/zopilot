import type { JsonValue } from "./types";

type JsonRpcRequest = {
  id: number;
  method: string;
  params?: JsonValue;
};

type JsonRpcResponse = {
  id: number;
  result?: JsonValue;
  error?: {
    code?: number;
    message?: string;
    data?: JsonValue;
  };
};

type JsonRpcNotification = {
  method: string;
  params?: JsonValue;
};

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

function parseJsonRpcMessage(line: string): JsonRpcMessage {
  return JSON.parse(line) as JsonRpcMessage;
}

function encodeJsonRpcMessage(message: JsonRpcMessage): string {
  return `${JSON.stringify(message)}\n`;
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

function isJsonRpcResponse(
  message: JsonRpcMessage,
): message is JsonRpcResponse {
  return "id" in message && !("method" in message);
}

export {
  encodeJsonRpcMessage,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
};
