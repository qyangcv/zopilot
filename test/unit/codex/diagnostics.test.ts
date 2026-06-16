import { assert } from "chai";
import {
  checkCodexConnection,
  diagnoseCodexConnection,
} from "../../../src/codex/diagnostics.ts";

describe("Codex connection diagnostics", function () {
  let existingPaths: Set<string>;

  beforeEach(function () {
    existingPaths = new Set();
    installIoMock((path) => existingPaths.has(path));
  });

  afterEach(function () {
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("returns no diagnostic when Codex is connected", async function () {
    existingPaths.add("/usr/local/bin/codex");
    const subprocess = createSubprocess({
      loginStdout: "Logged in",
    });

    assert.isTrue(await checkCodexConnection(subprocess));
    assert.isUndefined(await diagnoseCodexConnection(subprocess));
  });

  it("reports cli_not_found before running Codex commands", async function () {
    const calls: SubprocessCall[] = [];

    const diagnostic = await diagnoseCodexConnection(
      createSubprocess({ calls }),
    );

    assert.equal(diagnostic?.code, "cli_not_found");
    assert.isEmpty(calls);
  });

  it("reports app_server_unavailable and skips login", async function () {
    existingPaths.add("/usr/local/bin/codex");
    const calls: SubprocessCall[] = [];

    const diagnostic = await diagnoseCodexConnection(
      createSubprocess({ calls, appServerExitCode: 1 }),
    );

    assert.equal(diagnostic?.code, "app_server_unavailable");
    assert.deepEqual(
      calls.map((call) => call.arguments?.join(" ")),
      ["app-server --help"],
    );
  });

  it("reports not_logged_in", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const diagnostic = await diagnoseCodexConnection(
      createSubprocess({ loginStdout: "Not logged in" }),
    );

    assert.equal(diagnostic?.code, "not_logged_in");
  });

  it("reports command_timeout", async function () {
    existingPaths.add("/usr/local/bin/codex");
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((callback: () => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    try {
      const diagnostic = await diagnoseCodexConnection(
        createSubprocess({ appServerNeverCompletes: true }),
      );

      assert.equal(diagnostic?.code, "command_timeout");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("reports permission_denied", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const diagnostic = await diagnoseCodexConnection(
      createSubprocess({
        appServerStderr: "Permission denied",
        appServerExitCode: 1,
      }),
    );

    assert.equal(diagnostic?.code, "permission_denied");
  });

  it("reports unknown_error for unexpected command failures", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const diagnostic = await diagnoseCodexConnection(
      createSubprocess({ throwOnAppServer: true }),
    );

    assert.equal(diagnostic?.code, "unknown_error");
  });
});

type SubprocessCall = {
  command?: string;
  arguments?: string[];
};

function createSubprocess(options: {
  calls?: SubprocessCall[];
  appServerExitCode?: number;
  appServerStderr?: string;
  appServerNeverCompletes?: boolean;
  loginStdout?: string;
  throwOnAppServer?: boolean;
}) {
  return {
    call: async (call: SubprocessCall) => {
      options.calls?.push(call);
      if (call.arguments?.join(" ") === "app-server --help") {
        if (options.throwOnAppServer) {
          throw new Error("unexpected failure");
        }
        if (options.appServerNeverCompletes) {
          return createNeverCompletingProcess();
        }
        return createProcess(
          "",
          options.appServerStderr || "",
          options.appServerExitCode ?? 0,
        );
      }
      if (call.arguments?.join(" ") === "login status") {
        return createProcess(options.loginStdout || "", "", 0);
      }
      return createProcess("", "", 1);
    },
    getEnvironment: () => ({
      HOME: "/Users/test",
      PATH: "/usr/bin",
    }),
  };
}

function createProcess(stdout: string, stderr: string, exitCode: number) {
  let stdoutRead = false;
  let stderrRead = false;
  return {
    kill: async () => ({ exitCode: 0 }),
    wait: async () => ({ exitCode }),
    stdout: {
      readString: async () => {
        if (stdoutRead) {
          return "";
        }
        stdoutRead = true;
        return stdout;
      },
    },
    stderr: {
      readString: async () => {
        if (stderrRead) {
          return "";
        }
        stderrRead = true;
        return stderr;
      },
    },
  };
}

function createNeverCompletingProcess() {
  return {
    kill: async () => ({ exitCode: 0 }),
    wait: async () => new Promise<{ exitCode: number }>(() => undefined),
    stdout: {
      readString: async () => new Promise<string>(() => undefined),
    },
    stderr: {
      readString: async () => new Promise<string>(() => undefined),
    },
  };
}

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}
