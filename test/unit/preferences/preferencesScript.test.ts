import { assert } from "chai";
import { readFileSync } from "node:fs";
import vm from "node:vm";

describe("preferences.js", function () {
  it("waits for the preference pane markup before initializing", function () {
    const script = readFileSync("addon/content/preferences.js", "utf8");
    const timers: Array<() => void> = [];
    let statusElement: StatusElement | null = null;
    let l10nId = "";

    const context = vm.createContext({
      ChromeUtils: {
        importESModule() {
          throw new Error("Subprocess should not be loaded before IO checks");
        },
      },
      IOUtils: {
        exists: async () => false,
      },
      clearTimeout: () => undefined,
      document: {
        getElementById(id: string) {
          return id === "zopilot-codex-status-value" ? statusElement : null;
        },
        l10n: {
          setAttributes(_element: StatusElement, id: string) {
            l10nId = id;
          },
          translateElements: async () => undefined,
        },
      },
      setTimeout(callback: () => void) {
        timers.push(callback);
        return timers.length;
      },
    });

    assert.doesNotThrow(() => vm.runInContext(script, context));
    assert.lengthOf(timers, 1);

    assert.doesNotThrow(() => timers.shift()?.());
    assert.lengthOf(timers, 1);

    statusElement = { dataset: {}, textContent: "stale" };

    assert.doesNotThrow(() => timers.shift()?.());
    assert.equal(statusElement.dataset.status, "missing");
    assert.equal(statusElement.textContent, "");
    assert.equal(l10nId, "__addonRef__-pref-codex-status-missing");
  });

  it("runs Codex status checks with a GUI-safe PATH", async function () {
    const script = readFileSync("addon/content/preferences.js", "utf8");
    const calls: Array<{
      command?: string;
      arguments?: string[];
      environment?: { PATH: string };
    }> = [];
    const statusElement: StatusElement = { dataset: {}, textContent: "stale" };

    const subprocess = {
      call: async (options: {
        arguments?: string[];
        environment?: { PATH: string };
        command?: string;
      }) => {
        calls.push(options);
        let stdoutRead = false;
        let stdout = "";
        if (options.command === "/bin/zsh") {
          stdout =
            "\n__ZOPILOT_PATH_START__/Users/test/.nvm/versions/node/v22.12.0/bin:/usr/bin__ZOPILOT_PATH_END__\n";
        } else if (options.arguments?.join(" ") === "login status") {
          stdout = "Logged in";
        }
        return {
          kill: async () => ({ exitCode: 0 }),
          wait: async () => ({ exitCode: 0 }),
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
            readString: async () => "",
          },
        };
      },
      getEnvironment: () => ({
        HOME: "/Users/test",
        SHELL: "/bin/zsh",
        PATH: "/usr/bin:/custom/bin",
      }),
    };

    const context = vm.createContext({
      ChromeUtils: {
        importESModule() {
          return { Subprocess: subprocess };
        },
      },
      IOUtils: {
        exists: async (path: string) =>
          path === "/bin/zsh" ||
          path === "/Users/test/.nvm/versions/node/v22.12.0/bin/codex",
      },
      clearTimeout,
      document: {
        getElementById(id: string) {
          return id === "zopilot-codex-status-value" ? statusElement : null;
        },
        l10n: {
          setAttributes: () => undefined,
          translateElements: async () => undefined,
        },
      },
      setTimeout,
    });

    assert.doesNotThrow(() => vm.runInContext(script, context));
    await waitFor(() => calls.length === 3);

    const codexCalls = calls.filter((call) => call.command?.endsWith("/codex"));
    assert.deepEqual(codexCalls[0].arguments, ["app-server", "--help"]);
    assert.deepEqual(codexCalls[1].arguments, ["login", "status"]);
    assert.equal(
      codexCalls[0].command,
      "/Users/test/.nvm/versions/node/v22.12.0/bin/codex",
    );
    assert.equal(
      codexCalls[0].environment?.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/test/.local/bin:/Users/test/.npm-global/bin:/Users/test/.bun/bin:/Users/test/.volta/bin:/Users/test/.local/share/mise/shims:/Users/test/.nvm/current/bin:/Users/test/.nvm/versions/node/v22.12.0/bin:/custom/bin",
    );
    assert.equal(statusElement.dataset.status, "connected");
  });
});

type StatusElement = {
  dataset: Record<string, string>;
  textContent: string;
};

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
