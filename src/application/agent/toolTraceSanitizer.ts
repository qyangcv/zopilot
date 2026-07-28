import type { JsonValue } from "../../runtime/json/types";

const MAX_TOOL_TRACE_CHARS = 8000;
const TOOL_TRACE_TRUNCATION_MARKER = "\n[truncated]";
const SENSITIVE_KEY =
  /^(authorization|api[-_]?key|password|secret|token|access[-_]?token|refresh[-_]?token)$/i;
const BASE64_DATA_URL = /data:image\/[^;,]+;base64,[a-z0-9+/=]+/gi;
const LARGE_BASE64 = /\b[A-Za-z0-9+/]{256,}={0,2}\b/g;
const ABSOLUTE_PATH =
  /(?:^|[\s"'=:])\/(?:Users|home|private|tmp|var)\/[^\s"',}\]]+/g;
const SENSITIVE_JSON_VALUE =
  /("(?:authorization|api[-_]?key|password|secret|token|access[-_]?token|refresh[-_]?token)"\s*:\s*)"[^"]*"/gi;

function sanitizeToolTraceValue(
  value: unknown,
  options: { truncateStrings?: boolean } = {},
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeToolTraceValue(entry, options));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "image" || record.type === "input_image") {
      const mimeType =
        typeof record.mimeType === "string"
          ? record.mimeType
          : typeof record.mime_type === "string"
            ? record.mime_type
            : "image";
      const page =
        typeof record.page === "number" ? `, page ${record.page}` : "";
      return `[${mimeType}${page}]`;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key)
          ? "[redacted]"
          : sanitizeToolTraceValue(entry, options),
      ]),
    );
  }
  if (typeof value === "string") {
    return sanitizeToolTraceTextInternal(
      value,
      options.truncateStrings !== false,
    );
  }
  return value;
}

function sanitizeToolTraceText(value: string): string {
  return sanitizeToolTraceTextInternal(value, true);
}

function sanitizeToolTraceTextInternal(
  value: string,
  truncate: boolean,
): string {
  const sanitized = value
    .replace(SENSITIVE_JSON_VALUE, '$1"[redacted]"')
    .replace(BASE64_DATA_URL, "[image data omitted]")
    .replace(LARGE_BASE64, "[base64 omitted]")
    .replace(
      ABSOLUTE_PATH,
      (match) =>
        `${match.slice(0, 1).trim() ? match.slice(0, 1) : ""}[local path omitted]`,
    );
  return !truncate || sanitized.length <= MAX_TOOL_TRACE_CHARS
    ? sanitized
    : `${sanitized.slice(0, MAX_TOOL_TRACE_CHARS)}${TOOL_TRACE_TRUNCATION_MARKER}`;
}

function isToolTraceTextTruncated(value: string | undefined): boolean {
  return value?.endsWith(TOOL_TRACE_TRUNCATION_MARKER) === true;
}

function formatToolTraceValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const sanitized = sanitizeToolTraceValue(value);
  const text =
    typeof sanitized === "string"
      ? sanitized
      : JSON.stringify(sanitized, null, 2);
  return sanitizeToolTraceText(text);
}

function sanitizeToolTraceJson(value: unknown): JsonValue | undefined {
  return toJsonValue(sanitizeToolTraceValue(value, { truncateStrings: false }));
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry) ?? null);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, toJsonValue(entry)] as const)
      .filter(
        (entry): entry is readonly [string, JsonValue] =>
          entry[1] !== undefined,
      );
    return Object.fromEntries(entries);
  }
  return undefined;
}

export {
  MAX_TOOL_TRACE_CHARS,
  isToolTraceTextTruncated,
  formatToolTraceValue,
  sanitizeToolTraceJson,
  sanitizeToolTraceText,
  sanitizeToolTraceValue,
};
