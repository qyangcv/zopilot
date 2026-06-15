import { assert } from "chai";
import { buildCodexSubprocessEnvironment } from "../../../src/codex/subprocessEnvironment.ts";

describe("Codex subprocess environment", function () {
  afterEach(function () {
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("prepends supported Codex binary directories when PATH is missing", async function () {
    installIoMock(() => false);

    const environment = await buildCodexSubprocessEnvironment(
      createSubprocess({}),
    );

    assert.equal(
      environment.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("keeps existing PATH entries after the supported defaults", async function () {
    installIoMock(() => false);

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
    installIoMock((path) => path === "/bin/zsh");

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
