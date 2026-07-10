import { assert } from "chai";
import { createLogger } from "../../../src/runtime/logging/logger.ts";

type TestGlobals = typeof globalThis & {
  __env__?: "production" | "development";
  Zotero?: {
    Prefs?: {
      get: (name: string, global?: boolean) => unknown;
    };
    debug?: (message: string) => void;
    logError?: (error: Error) => void;
  };
  ztoolkit?: {
    log: (message: string, details?: unknown) => void;
  };
};

type LogEntry = {
  message: string;
  details: unknown;
};

const testGlobals = globalThis as TestGlobals;
const originalConsole = globalThis.console;

describe("logger", function () {
  let logs: LogEntry[];
  let warnings: LogEntry[];
  let errors: LogEntry[];
  let zoteroErrors: Error[];

  beforeEach(function () {
    logs = [];
    warnings = [];
    errors = [];
    zoteroErrors = [];
    testGlobals.__env__ = "production";
    testGlobals.ztoolkit = {
      log: (message, details) => logs.push({ message, details }),
    };
    testGlobals.Zotero = {
      Prefs: {
        get: () => false,
      },
      debug: (message) => logs.push({ message, details: undefined }),
      logError: (error) => zoteroErrors.push(error),
    };
    globalThis.console = {
      ...originalConsole,
      warn: (message?: unknown, details?: unknown) => {
        warnings.push({ message: String(message), details });
      },
      error: (message?: unknown, details?: unknown) => {
        errors.push({ message: String(message), details });
      },
    };
  });

  afterEach(function () {
    globalThis.console = originalConsole;
    delete testGlobals.__env__;
    delete testGlobals.Zotero;
    delete testGlobals.ztoolkit;
  });

  it("suppresses debug and info unless verbose logging is enabled", function () {
    const logger = createLogger("unit");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message", new Error("boom"));

    assert.deepEqual(
      logs.map((entry) => entry.message),
      [
        "[Zopilot][WARN][unit] warn message",
        "[Zopilot][ERROR][unit] error message",
      ],
    );
    assert.lengthOf(warnings, 1);
    assert.lengthOf(errors, 1);
  });

  it("emits all levels when log.verbose is true", function () {
    testGlobals.Zotero = {
      ...testGlobals.Zotero,
      Prefs: {
        get: (name: string) => name === "extensions.zotero.zopilot.log.verbose",
      },
    };
    const logger = createLogger("unit");

    logger.debug("debug message");
    logger.info("info message");
    logger.warn("warn message");
    logger.error("error message", new Error("boom"));

    assert.deepEqual(
      logs.map((entry) => entry.message),
      [
        "[Zopilot][DEBUG][unit] debug message",
        "[Zopilot][INFO][unit] info message",
        "[Zopilot][WARN][unit] warn message",
        "[Zopilot][ERROR][unit] error message",
      ],
    );
  });

  it("serializes Error details and passes the original Error to Zotero.logError", function () {
    const cause = new Error("inner failure");
    const error = new Error("outer failure", { cause });
    const logger = createLogger("unit");

    logger.error("failed operation", error, { conversationId: "conv-a" });

    assert.strictEqual(zoteroErrors[0], error);
    const details = logs[0].details as {
      error: {
        name: string;
        message: string;
        stack: string;
        cause: { message: string };
      };
      details: { conversationId: string };
    };
    assert.equal(details.error.name, "Error");
    assert.equal(details.error.message, "outer failure");
    assert.include(details.error.stack, "outer failure");
    assert.equal(details.error.cause.message, "inner failure");
    assert.deepEqual(details.details, { conversationId: "conv-a" });
  });

  it("handles non-Error inputs without throwing", function () {
    const logger = createLogger("unit");

    logger.error("non-error input", {
      reason: "bad shape",
      token: "secret",
    });

    assert.instanceOf(zoteroErrors[0], Error);
    assert.include(zoteroErrors[0].message, "non-error input");
    assert.notInclude(zoteroErrors[0].message, "secret");
    assert.deepEqual(logs[0].details, {
      error: { reason: "bad shape", token: "[REDACTED]" },
    });
  });

  it("redacts sensitive fields and truncates long strings", function () {
    const logger = createLogger("unit");

    logger.warn("redaction", {
      authorization: "Bearer secret",
      nested: {
        apiKey: "secret",
        text: "x".repeat(3000),
      },
    });

    const details = logs[0].details as {
      authorization: string;
      nested: { apiKey: string; text: string };
    };
    assert.equal(details.authorization, "[REDACTED]");
    assert.equal(details.nested.apiKey, "[REDACTED]");
    assert.isBelow(details.nested.text.length, 2100);
    assert.include(details.nested.text, "[truncated]");
  });

  it("safely degrades when Zotero, ztoolkit, and console sinks are missing", function () {
    delete testGlobals.Zotero;
    delete testGlobals.ztoolkit;
    globalThis.console = undefined as unknown as Console;
    const logger = createLogger("unit");

    assert.doesNotThrow(() => {
      logger.warn("missing sinks");
      logger.error("missing error sink", new Error("boom"));
    });
  });
});
