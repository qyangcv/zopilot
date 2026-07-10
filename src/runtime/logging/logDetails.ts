type ErrorLike = {
  name?: unknown;
  message: string;
  stack?: unknown;
  cause?: unknown;
};

const MAX_FIELD_LENGTH = 2048;
const MAX_DETAILS_LENGTH = 4096;
const MAX_DEPTH = 4;
const MAX_ERROR_CAUSE_DEPTH = 3;
const REDACTED = "[REDACTED]";
const TRUNCATED_SUFFIX = "...[truncated]";
const SENSITIVE_KEYS = [
  "authorization",
  "token",
  "password",
  "secret",
  "apikey",
];

function buildErrorDetails(errorInput: unknown, details: unknown): unknown {
  const hasErrorInput = errorInput !== undefined;
  const errorDetails = hasErrorInput ? sanitizeDetails(errorInput) : undefined;
  const contextDetails = sanitizeDetails(details);
  if (!hasErrorInput) return contextDetails;
  if (contextDetails === undefined) {
    return isErrorLike(errorInput) ? errorDetails : { error: errorDetails };
  }
  return sanitizeDetails({ error: errorDetails, details: contextDetails });
}

function sanitizeDetails(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = serializeValue(value, 0, new WeakSet<object>());
  const text = stringifyDetails(serialized);
  return text.length <= MAX_DETAILS_LENGTH
    ? serialized
    : `${text.slice(0, MAX_DETAILS_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function serializeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return truncateString(value, MAX_FIELD_LENGTH);
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "bigint" || typeof value === "symbol")
    return String(value);
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`;
  if (!value || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (isErrorLike(value)) return serializeError(value, 0, seen);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[MaxDepth]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => serializeValue(item, depth + 1, seen));
    }
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      output[key] = isSensitiveKey(key)
        ? REDACTED
        : serializeValue(
            (value as Record<string, unknown>)[key],
            depth + 1,
            seen,
          );
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function serializeError(
  error: object,
  causeDepth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  if (seen.has(error)) return { message: "[Circular]" };
  seen.add(error);
  try {
    const value = error as ErrorLike;
    const output: Record<string, unknown> = {
      name: typeof value.name === "string" ? value.name : "Error",
      message:
        typeof value.message === "string"
          ? truncateString(value.message, MAX_FIELD_LENGTH)
          : String(error),
    };
    if (typeof value.stack === "string") {
      output.stack = truncateString(value.stack, MAX_FIELD_LENGTH);
    }
    if (value.cause !== undefined) {
      output.cause =
        causeDepth >= MAX_ERROR_CAUSE_DEPTH
          ? "[MaxCauseDepth]"
          : serializeValue(value.cause, causeDepth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(error);
  }
}

function toErrorForZotero(errorInput: unknown, message: string): Error {
  if (errorInput instanceof Error) return errorInput;
  const text =
    errorInput === undefined
      ? message
      : `${message}: ${truncateString(
          stringifyDetails(sanitizeDetails(errorInput)),
          512,
        )}`;
  return new Error(text);
}

function isErrorLike(value: unknown): value is Error | ErrorLike {
  if (value instanceof Error) return true;
  if (!value || typeof value !== "object") return false;
  return (
    ("message" in value || "stack" in value) &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

function truncateString(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}${TRUNCATED_SUFFIX}`;
}

function stringifyDetails(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export {
  buildErrorDetails,
  sanitizeDetails,
  stringifyDetails,
  toErrorForZotero,
};
