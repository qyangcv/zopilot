import { assert } from "chai";
import {
  buildExecutablePathCandidates,
  detectHostRuntime,
  getEnvironmentPath,
  getHomeDir,
  getPathDelimiter,
  mergePathEntries,
  platformPathJoin,
  splitPathEntries,
  SUPPORTED_PDF_HELPER_PLATFORMS,
} from "../../../src/runtime/platform/host.ts";

describe("platform utilities", function () {
  it("detects supported PDF helper host platforms", function () {
    assert.deepEqual(SUPPORTED_PDF_HELPER_PLATFORMS, [
      "macos-arm64",
      "macos-x64",
      "windows-x64",
    ]);
    assert.deepInclude(
      detectHostRuntime({ OS: "Darwin", XPCOMABI: "aarch64-gcc3" }),
      {
        os: "macos",
        arch: "arm64",
        pdfHelperPlatform: "macos-arm64",
      },
    );
    assert.deepInclude(
      detectHostRuntime({ OS: "Darwin", XPCOMABI: "x86_64-gcc3" }),
      {
        os: "macos",
        arch: "x64",
        pdfHelperPlatform: "macos-x64",
      },
    );
    assert.deepInclude(
      detectHostRuntime({ OS: "WINNT", XPCOMABI: "x86_64-msvc" }),
      {
        os: "windows",
        arch: "x64",
        pdfHelperPlatform: "windows-x64",
      },
    );
  });

  it("reports unsupported OS and architecture without a PDF helper platform", function () {
    assert.deepInclude(
      detectHostRuntime({ OS: "Linux", XPCOMABI: "x86_64-gcc3" }),
      {
        os: "unsupported",
        arch: "x64",
      },
    );
    assert.isUndefined(
      detectHostRuntime({ OS: "Linux", XPCOMABI: "x86_64-gcc3" })
        .pdfHelperPlatform,
    );
    assert.deepInclude(
      detectHostRuntime({ OS: "WINNT", XPCOMABI: "aarch64-msvc" }),
      {
        os: "windows",
        arch: "arm64",
      },
    );
    assert.isUndefined(
      detectHostRuntime({ OS: "WINNT", XPCOMABI: "aarch64-msvc" })
        .pdfHelperPlatform,
    );
  });

  it("handles environment PATH and home directory variants", function () {
    assert.equal(
      getEnvironmentPath({ Path: "C:\\Windows\\System32" }),
      "C:\\Windows\\System32",
    );
    assert.equal(getEnvironmentPath({ path: "/usr/bin" }), "/usr/bin");
    assert.equal(getHomeDir({ HOME: "/Users/test" }), "/Users/test");
    assert.equal(
      getHomeDir({ USERPROFILE: "C:\\Users\\test" }),
      "C:\\Users\\test",
    );
    assert.equal(
      getHomeDir({ HOMEDRIVE: "C:", HOMEPATH: "\\Users\\test" }),
      "C:\\Users\\test",
    );
  });

  it("splits and merges PATH entries with host-specific delimiters", function () {
    assert.equal(getPathDelimiter("macos"), ":");
    assert.equal(getPathDelimiter("windows"), ";");
    assert.deepEqual(splitPathEntries("/a:/b::/a", "macos"), [
      "/a",
      "/b",
      "/a",
    ]);
    assert.equal(mergePathEntries(["/a", "/b"], "/b:/c", "macos"), "/a:/b:/c");
    assert.equal(
      mergePathEntries(["C:\\A"], "C:\\A;D:\\B", "windows"),
      "C:\\A;D:\\B",
    );
  });

  it("joins platform paths without duplicating separators", function () {
    assert.equal(
      platformPathJoin("macos", "/Users/test/", "/.local/bin/", "codex"),
      "/Users/test/.local/bin/codex",
    );
    assert.equal(
      platformPathJoin(
        "windows",
        "C:\\Users\\test\\",
        "\\AppData\\Roaming",
        "npm",
      ),
      "C:\\Users\\test\\AppData\\Roaming\\npm",
    );
    assert.equal(platformPathJoin("windows", "C:\\"), "C:");
  });

  it("builds executable candidates from PATH entries", function () {
    assert.deepEqual(
      buildExecutablePathCandidates("/bin:/usr/bin:/bin", ["node"], "macos"),
      ["/bin/node", "/usr/bin/node"],
    );
    assert.deepEqual(
      buildExecutablePathCandidates(
        "C:\\Tools\\;C:\\Program Files\\nodejs",
        ["node.exe", "node.cmd"],
        "windows",
      ),
      [
        "C:\\Tools\\node.exe",
        "C:\\Tools\\node.cmd",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files\\nodejs\\node.cmd",
      ],
    );
  });
});
