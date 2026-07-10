import type { JsonValue } from "../../runtime/json/types";
import { isJsonObject } from "./protocol";

type McpHttpRequest = {
  method: string;
  headers: Record<string, string>;
  data: unknown;
};

type McpHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body?: string;
};

type ParsedRequestBody =
  | { ok: true; value: JsonValue }
  | { ok: false; error: string };

function validateRequestSecurity(
  request: McpHttpRequest,
  token: string,
): string | undefined {
  const authorization = getHeader(request.headers, "authorization");
  if (authorization !== `Bearer ${token}`) {
    return "Invalid MCP Authorization header.";
  }
  const host = getHeader(request.headers, "host");
  if (host && !isAllowedHost(host)) {
    return `Rejected MCP Host header: ${host}`;
  }
  const origin = getHeader(request.headers, "origin");
  if (origin && !isAllowedOrigin(origin)) {
    return `Rejected MCP Origin header: ${origin}`;
  }
  return undefined;
}

function parseRequestBody(data: unknown): ParsedRequestBody {
  if (typeof data === "string") {
    try {
      return { ok: true, value: JSON.parse(data) as JsonValue };
    } catch (error) {
      return { ok: false, error: `Invalid JSON body: ${String(error)}` };
    }
  }
  if (isJsonObject(data) || Array.isArray(data)) {
    return { ok: true, value: data as JsonValue };
  }
  return { ok: false, error: "MCP request body must be JSON." };
}

function jsonResponse(status: number, body: JsonValue): McpHttpResponse {
  return {
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const foundKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return foundKey ? headers[foundKey] : undefined;
}

function isAllowedHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized.startsWith("127.0.0.1:") || normalized.startsWith("localhost:")
  );
}

function isAllowedOrigin(origin: string): boolean {
  if (origin === "null") return true;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export { jsonResponse, parseRequestBody, validateRequestSecurity };
export type { McpHttpRequest, McpHttpResponse, ParsedRequestBody };
