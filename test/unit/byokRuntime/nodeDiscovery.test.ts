import { assert } from "chai";
import { resolveNodeBinaryPath } from "../../../src/integrations/byok/runtime/nodeDiscovery.ts";

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
      async () => 22,
    );

    assert.equal(resolved, "/Users/test/.nvm/current/bin/node");
  });

  it("finds node.exe on a Windows PATH", async function () {
    existingPaths.add("C:\\Program Files\\nodejs\\node.exe");

    const resolved = await resolveNodeBinaryPath(
      "C:\\Program Files\\nodejs;C:\\custom\\bin",
      "windows",
      async () => 24,
    );

    assert.equal(resolved, "C:\\Program Files\\nodejs\\node.exe");
  });

  it("skips Node versions older than 22", async function () {
    existingPaths.add("/opt/homebrew/bin/node");
    existingPaths.add("/Users/test/.nvm/current/bin/node");

    const resolved = await resolveNodeBinaryPath(
      "/Users/test/.nvm/current/bin",
      "macos",
      async (path) => (path === "/opt/homebrew/bin/node" ? 20 : 22),
    );

    assert.equal(resolved, "/Users/test/.nvm/current/bin/node");
  });

  it("reports an unsupported Node version", async function () {
    existingPaths.add("/usr/bin/node");

    let message = "";
    try {
      await resolveNodeBinaryPath("/usr/bin", "macos", async () => 21);
    } catch (error) {
      message = String(error);
    }

    assert.include(message, "requires Node.js 22");
  });
});

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}
