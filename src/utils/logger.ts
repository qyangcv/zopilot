export { createLogger };
export type { Logger };

type Logger = {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, errorOrDetails?: unknown, details?: unknown): void;
};

type LogLevel = "debug" | "info" | "warn" | "error";
type ErrorLike = {
  name?: unknown;
  message: string;
  stack?: unknown;
  cause?: unknown;
};

const ADDON_LABEL = "Zopilot";
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

function createLogger(scope?: string): Logger {
  return {
    debug(message, details) {
      writeLog("debug", scope, message, details);
    },
    info(message, details) {
      writeLog("info", scope, message, details);
    },
    warn(message, details) {
      writeLog("warn", scope, message, details);
    },
    error(message, errorOrDetails, details) {
      writeErrorLog(scope, message, errorOrDetails, details);
    },
  };
}

function writeLog(
  level: LogLevel,
  scope: string | undefined,
  message: string,
  details?: unknown,
): void {
  if (!shouldEmit(level)) {
    return;
  }
  emit(level, formatPrefix(level, scope, message), sanitizeDetails(details));
}

function writeErrorLog(
  scope: string | undefined,
  message: string,
  errorOrDetails?: unknown,
  details?: unknown,
): void {
  const serialized = buildErrorDetails(errorOrDetails, details);

  emit("error", formatPrefix("error", scope, message), serialized);
  logErrorToZotero(errorOrDetails, message);
}

function shouldEmit(level: LogLevel): boolean {
  if (level === "warn" || level === "error") {
    return true;
  }
  return getEnvironment() === "development" || getVerbosePref();
}

function emit(level: LogLevel, message: string, details: unknown): void {
  try {
    if (level === "warn") {
      getConsole()?.warn?.(message, details);
    } else if (level === "error") {
      getConsole()?.error?.(message, details);
    }
  } catch {
    // Ignore sink failures; logging must not break plugin behavior.
  }

  try {
    const toolkit = getZToolkit();
    if (toolkit) {
      toolkit.log(message, details);
      return;
    }
  } catch {
    // Fall through to Zotero.debug.
  }

  try {
    getZotero()?.debug?.(formatDebugMessage(message, details));
  } catch {
    // No available logging sink.
  }
}

function logErrorToZotero(errorInput: unknown, message: string): void {
  try {
    const zotero = getZotero();
    if (!zotero?.logError) {
      return;
    }
    zotero.logError(toErrorForZotero(errorInput, message));
  } catch {
    // No available error sink.
  }
}

function formatPrefix(
  level: LogLevel,
  scope: string | undefined,
  message: string,
): string {
  return scope
    ? `[${ADDON_LABEL}][${level.toUpperCase()}][${scope}] ${message}`
    : `[${ADDON_LABEL}][${level.toUpperCase()}] ${message}`;
}

function formatDebugMessage(message: string, details: unknown): string {
  if (details === undefined) {
    return message;
  }
  return `${message} ${stringifyDetails(details)}`;
}

function buildErrorDetails(errorInput: unknown, details: unknown): unknown {
  const hasErrorInput = errorInput !== undefined;
  const errorDetails = hasErrorInput ? sanitizeDetails(errorInput) : undefined;
  const contextDetails = sanitizeDetails(details);
  if (!hasErrorInput) {
    return contextDetails;
  }
  if (contextDetails === undefined) {
    return isErrorLike(errorInput) ? errorDetails : { error: errorDetails };
  }
  return sanitizeDetails({
    error: errorDetails,
    details: contextDetails,
  });
}

function sanitizeDetails(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  const serialized = serializeValue(value, 0, new WeakSet<object>());
  const text = stringifyDetails(serialized);
  if (text.length <= MAX_DETAILS_LENGTH) {
    return serialized;
  }
  return `${text.slice(0, MAX_DETAILS_LENGTH)}${TRUNCATED_SUFFIX}`;
}

function serializeValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") {
    return truncateString(value, MAX_FIELD_LENGTH);
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (!value || typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (isErrorLike(value)) {
    return serializeError(value, 0, seen);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => serializeValue(item, depth + 1, seen));
    }
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      output[key] = serializeValue(
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
  if (seen.has(error)) {
    return { message: "[Circular]" };
  }
  seen.add(error);
  try {
    const value = error as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
      cause?: unknown;
    };
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
  if (errorInput instanceof Error) {
    return errorInput;
  }
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
  if (value instanceof Error) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
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
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}${TRUNCATED_SUFFIX}`;
}

function stringifyDetails(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getEnvironment(): "production" | "development" {
  if (typeof __env__ === "undefined") {
    return "production";
  }
  return __env__;
}

function getVerbosePref(): boolean {
  try {
    const zotero = getZotero();
    return (
      zotero?.Prefs?.get?.("extensions.zotero.zopilot.log.verbose", true) ===
      true
    );
  } catch {
    return false;
  }
}

function getConsole(): Console | undefined {
  return globalThis.console;
}

function getZotero(): _ZoteroTypes.Zotero | undefined {
  if (typeof Zotero === "undefined") {
    return undefined;
  }
  return Zotero;
}

function getZToolkit():
  | { log(message: string, details?: unknown): void }
  | undefined {
  if (typeof ztoolkit === "undefined") {
    return undefined;
  }
  return ztoolkit;
}
