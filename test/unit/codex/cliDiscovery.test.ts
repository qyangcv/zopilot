import { assert } from "chai";
import {
  buildCodexSubprocessEnvironment,
  resolveCodexBinaryPath,
} from "../../../src/integrations/codex/cliDiscovery.ts";

const originalConsole = globalThis.console;

describe("Codex CLI discovery", function () {
  let existingPaths: Set<string>;

  beforeEach(function () {
    existingPaths = new Set();
    installIoMock((path) => existingPaths.has(path));
    globalThis.console = {
      ...originalConsole,
      error: () => undefined,
      warn: () => undefined,
    };
  });

  afterEach(function () {
    globalThis.console = originalConsole;
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("returns the Apple Silicon Homebrew Codex path when present", async function () {
    existingPaths.add("/opt/homebrew/bin/codex");

    const resolved = await resolveCodexBinaryPath();

    assert.equal(resolved.command, "/opt/homebrew/bin/codex");
    assert.deepEqual(resolved.argsPrefix, []);
  });

  it("falls back to the Intel Homebrew and npm global Codex path", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const resolved = await resolveCodexBinaryPath();

    assert.equal(resolved.command, "/usr/local/bin/codex");
  });

  it("finds Codex on the prepared PATH", async function () {
    existingPaths.add("/Users/test/.nvm/versions/node/v22.12.0/bin/codex");

    const resolved = await resolveCodexBinaryPath(
      "/Users/test/.nvm/versions/node/v22.12.0/bin:/usr/bin",
    );

    assert.equal(
      resolved.command,
      "/Users/test/.nvm/versions/node/v22.12.0/bin/codex",
    );
  });

  it("throws when neither supported macOS default Codex path exists", async function () {
    try {
      await resolveCodexBinaryPath();
      assert.fail("Expected resolveCodexBinaryPath to throw");
    } catch (error) {
      assert.instanceOf(error, Error);
      assert.match((error as Error).message, /Unable to find the Codex CLI/);
    }
  });

  it("prepends supported Codex binary directories when PATH is missing", async function () {
    const environment = await buildCodexSubprocessEnvironment(
      createSubprocess({}),
    );

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("keeps existing PATH entries after the supported defaults", async function () {
    const environment = await buildCodexSubprocessEnvironment(
      createSubprocess({
        PATH: "/custom/bin:/another/bin",
      }),
    );

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/custom/bin:/another/bin",
    );
  });

  it("merges login shell PATH before the GUI environment PATH", async function () {
    existingPaths.add("/bin/zsh");

    const environment = await buildCodexSubprocessEnvironment(
      createSubprocess(
        {
          HOME: "/Users/test",
          SHELL: "/bin/zsh",
          PATH: "/usr/bin:/custom/bin",
        },
        "/Users/test/.nvm/versions/node/v22.12.0/bin:/Users/test/.local/bin",
      ),
    );

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/test/.local/bin:/Users/test/.npm-global/bin:/Users/test/.bun/bin:/Users/test/.volta/bin:/Users/test/.local/share/mise/shims:/Users/test/.nvm/current/bin:/Users/test/.nvm/versions/node/v22.12.0/bin:/custom/bin",
    );
  });

  it("uses Windows PATH delimiters and skips login shell probing", async function () {
    const environment = await buildCodexSubprocessEnvironment(
      createSubprocess({
        OS: "Windows_NT",
        USERPROFILE: "C:\\Users\\test",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
        Path: "C:\\custom\\bin;D:\\tools",
      }),
    );

    assert.equal(
      environment.PATH,
      "C:\\Users\\test\\AppData\\Roaming\\npm;C:\\Users\\test\\AppData\\Local\\Programs\\nodejs;C:\\Program Files\\nodejs;C:\\custom\\bin;D:\\tools",
    );
  });

  it("wraps Windows cmd shims with cmd.exe", async function () {
    existingPaths.add("C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd");

    const resolved = await resolveCodexBinaryPath(
      "C:\\Users\\test\\AppData\\Roaming\\npm",
      "windows",
    );

    assert.equal(resolved.command, "cmd.exe");
    assert.deepEqual(resolved.argsPrefix, [
      "/d",
      "/s",
      "/c",
      "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd",
    ]);
  });
});

function createSubprocess(
  environment: Record<string, string>,
  shellPath?: string,
) {
  return {
    call: async () => createProcess(shellPath),
    getEnvironment: () => environment,
  };
}

function createProcess(shellPath?: string) {
  let stdoutRead = false;
  const stdout = shellPath
    ? `\n__ZOPILOT_PATH_START__${shellPath}__ZOPILOT_PATH_END__\n`
    : "";
  return {
    kill: async () => ({ exitCode: 0 }),
    wait: async () => ({ exitCode: shellPath ? 0 : 1 }),
    stdout: {
      readString: async () => {
        if (stdoutRead) {
          return "";
        }
        stdoutRead = true;
        return stdout;
      },
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
