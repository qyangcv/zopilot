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
    installIoMock((path) => existingPaths.has(path));
  });

  afterEach(function () {
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("returns the Apple Silicon Homebrew Codex path when present", async function () {
    existingPaths.add("/opt/homebrew/bin/codex");

    const resolved = await resolveCodexBinaryPath(createSubprocess());

    assert.equal(resolved, "/opt/homebrew/bin/codex");
  });

  it("falls back to the Intel Homebrew and npm global Codex path", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const resolved = await resolveCodexBinaryPath(createSubprocess());

    assert.equal(resolved, "/usr/local/bin/codex");
  });

  it("throws when neither supported macOS default Codex path exists", async function () {
    try {
      await resolveCodexBinaryPath(createSubprocess());
      assert.fail("Expected resolveCodexBinaryPath to throw");
    } catch (error) {
      assert.instanceOf(error, Error);
      assert.match((error as Error).message, /Unable to find the Codex CLI/);
    }
  });

  it("returns HOME as the user home directory", function () {
    assert.equal(
      getUserHomeDirectory({
        HOME: "/Users/ada",
      }),
      "/Users/ada",
    );
  });

  it("returns undefined when HOME is absent", function () {
    assert.isUndefined(getUserHomeDirectory({}));
  });
});

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}

function createSubprocess(): CodexSubprocessModule {
  return {
    call: async () => {
      throw new Error("call should not be used by this test");
    },
    getEnvironment: () => ({}),
  };
}
