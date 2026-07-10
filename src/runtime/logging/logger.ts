import {
  buildErrorDetails,
  sanitizeDetails,
  stringifyDetails,
  toErrorForZotero,
} from "./logDetails";

type Logger = {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, errorOrDetails?: unknown, details?: unknown): void;
};

type LogLevel = "debug" | "info" | "warn" | "error";
const ADDON_LABEL = "Zopilot";

function createLogger(scope?: string): Logger {
  return {
    debug: (message, details) => writeLog("debug", scope, message, details),
    info: (message, details) => writeLog("info", scope, message, details),
    warn: (message, details) => writeLog("warn", scope, message, details),
    error: (message, errorOrDetails, details) =>
      writeErrorLog(scope, message, errorOrDetails, details),
  };
}

function writeLog(
  level: LogLevel,
  scope: string | undefined,
  message: string,
  details?: unknown,
): void {
  if (!shouldEmit(level)) return;
  emit(level, formatPrefix(level, scope, message), sanitizeDetails(details));
}

function writeErrorLog(
  scope: string | undefined,
  message: string,
  errorOrDetails?: unknown,
  details?: unknown,
): void {
  emit(
    "error",
    formatPrefix("error", scope, message),
    buildErrorDetails(errorOrDetails, details),
  );
  logErrorToZotero(errorOrDetails, message);
}

function shouldEmit(level: LogLevel): boolean {
  return (
    level === "warn" ||
    level === "error" ||
    getEnvironment() === "development" ||
    getVerbosePref()
  );
}

function emit(level: LogLevel, message: string, details: unknown): void {
  try {
    if (level === "warn") getConsole()?.warn?.(message, details);
    else if (level === "error") getConsole()?.error?.(message, details);
  } catch {
    // Logging must not break plugin behavior.
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
    getZotero()?.logError?.(toErrorForZotero(errorInput, message));
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
  return details === undefined
    ? message
    : `${message} ${stringifyDetails(details)}`;
}

function getEnvironment(): "production" | "development" {
  return typeof __env__ === "undefined" ? "production" : __env__;
}

function getVerbosePref(): boolean {
  try {
    return (
      getZotero()?.Prefs?.get?.(
        "extensions.zotero.zopilot.log.verbose",
        true,
      ) === true
    );
  } catch {
    return false;
  }
}

function getConsole(): Console | undefined {
  return globalThis.console;
}

function getZotero(): _ZoteroTypes.Zotero | undefined {
  return typeof Zotero === "undefined" ? undefined : Zotero;
}

function getZToolkit():
  | { log(message: string, details?: unknown): void }
  | undefined {
  return typeof ztoolkit === "undefined" ? undefined : ztoolkit;
}

export { createLogger };
export type { Logger };
