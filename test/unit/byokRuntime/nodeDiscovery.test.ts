import { assert } from "chai";
import { resolveNodeBinaryPath } from "../../../src/byokRuntime/nodeDiscovery.ts";

describe("BYOK Node discovery", function () {
  let existingPaths: Set<string>;

  beforeEach(function () {
    existingPaths = new Set();
    installIoMock((path) => existingPaths.has(path));
  });

  afterEach(function () {
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
  });

  it("finds node on a POSIX PATH", async function () {
    existingPaths.add("/Users/test/.nvm/current/bin/node");

    const resolved = await resolveNodeBinaryPath(
      "/Users/test/.nvm/current/bin:/usr/bin",
      "macos",
    );

    assert.equal(resolved, "/Users/test/.nvm/current/bin/node");
  });

  it("finds node.exe on a Windows PATH", async function () {
    existingPaths.add("C:\\Program Files\\nodejs\\node.exe");

    const resolved = await resolveNodeBinaryPath(
      "C:\\Program Files\\nodejs;C:\\custom\\bin",
      "windows",
    );

    assert.equal(resolved, "C:\\Program Files\\nodejs\\node.exe");
  });
});

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}
