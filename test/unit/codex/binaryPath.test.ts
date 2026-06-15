import { assert } from "chai";
import { resolveCodexBinaryPath } from "../../../src/codex/binaryPath.ts";

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

    const resolved = await resolveCodexBinaryPath();

    assert.equal(resolved, "/opt/homebrew/bin/codex");
  });

  it("falls back to the Intel Homebrew and npm global Codex path", async function () {
    existingPaths.add("/usr/local/bin/codex");

    const resolved = await resolveCodexBinaryPath();

    assert.equal(resolved, "/usr/local/bin/codex");
  });

  it("finds Codex on the prepared PATH", async function () {
    existingPaths.add("/Users/test/.nvm/versions/node/v22.12.0/bin/codex");

    const resolved = await resolveCodexBinaryPath(
      "/Users/test/.nvm/versions/node/v22.12.0/bin:/usr/bin",
    );

    assert.equal(resolved, "/Users/test/.nvm/versions/node/v22.12.0/bin/codex");
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
});

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}
