import { assert } from "chai";
import {
  getUserHomeDirectory,
  resolveCodexBinaryPath,
} from "../../../src/codex/binaryPath.ts";
import type { CodexSubprocessModule } from "../../../src/codex/types.ts";

describe("Codex binary path resolution", function () {
  let existingPaths: Set<string>;

  beforeEach(function () {
    existingPaths = new Set();
    installPrefMock("");
    installIoMock((path) => existingPaths.has(path));
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("searches common Windows npm shim locations when PATH is not enough", async function () {
    const appData = "C:\\Users\\Ada\\AppData\\Roaming";
    const codexPath = `${appData}\\npm\\codex.cmd`;
    existingPaths.add(codexPath);

    const resolved = await resolveCodexBinaryPath(
      createSubprocess({
        environment: {
          APPDATA: appData,
          USERPROFILE: "C:\\Users\\Ada",
        },
        pathSearch: async () => {
          throw new Error("not in PATH");
        },
      }),
    );

    assert.equal(resolved, codexPath);
  });

  it("treats configured Windows absolute paths as executable paths", async function () {
    const configuredPath = "C:\\Tools\\OpenAI\\codex.cmd";
    installPrefMock(configuredPath);

    const resolved = await resolveCodexBinaryPath(
      createSubprocess({
        environment: {
          USERPROFILE: "C:\\Users\\Ada",
        },
        pathSearch: async () => {
          throw new Error("pathSearch should not be called");
        },
      }),
    );

    assert.equal(resolved, configuredPath);
  });

  it("uses USERPROFILE as the user home when HOME is absent", function () {
    assert.equal(
      getUserHomeDirectory({
        USERPROFILE: "C:\\Users\\Ada",
      }),
      "C:\\Users\\Ada",
    );
  });
});

function installPrefMock(value: string): void {
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Prefs: {
      get: () => value,
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

function createSubprocess(options: {
  environment: Record<string, string>;
  pathSearch: (command: string) => Promise<string>;
}): CodexSubprocessModule {
  return {
    call: async () => {
      throw new Error("call should not be used by this test");
    },
    getEnvironment: () => options.environment,
    pathSearch: options.pathSearch,
  };
}
