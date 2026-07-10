import { assert } from "chai";
import {
  detectPdfHelperPlatform,
  PDF_HELPER_VERSION,
  getPdfHelperStatus,
  installPdfHelperDependency,
  removePdfHelperDependency,
  selectPdfHelperArtifact,
  updatePdfHelperDependency,
  type PdfHelperManifest,
} from "../../../src/document/pdf-helper/index.ts";

describe("PDF helper", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Components?: unknown }).Components;
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
    delete (globalThis as unknown as { PathUtils?: unknown }).PathUtils;
    delete (globalThis as unknown as { Services?: unknown }).Services;
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("detects macOS arm64", function () {
    assert.equal(
      detectPdfHelperPlatform({
        OS: "Darwin",
        XPCOMABI: "aarch64-gcc3",
      }),
      "macos-arm64",
    );
  });

  it("detects macOS x64", function () {
    assert.equal(
      detectPdfHelperPlatform({
        OS: "Darwin",
        XPCOMABI: "x86_64-gcc3",
      }),
      "macos-x64",
    );
  });

  it("detects Windows x64", function () {
    assert.equal(
      detectPdfHelperPlatform({
        OS: "WINNT",
        XPCOMABI: "x86_64-msvc",
      }),
      "windows-x64",
    );
  });

  it("rejects unsupported platforms", function () {
    assert.throws(
      () =>
        detectPdfHelperPlatform({
          OS: "WINNT",
          XPCOMABI: "aarch64-msvc",
        }),
      /macOS arm64, macOS x64, and Windows x64/,
    );
  });

  it("selects the requested platform artifact from a manifest", function () {
    const artifact = selectPdfHelperArtifact(createManifest(), "windows-x64");

    assert.equal(artifact.platform, "windows-x64");
    assert.equal(artifact.entrypoint, "helper/bin/zopilot-pdf-helper.exe");
  });

  it("rejects mismatched helper versions", function () {
    const manifest = createManifest({ version: "9.9.9" });

    assert.throws(
      () => selectPdfHelperArtifact(manifest, "macos-arm64"),
      /Unsupported PDF helper manifest version/,
    );
  });

  it("reports an installed helper when the executable and version match", async function () {
    installRuntimeMocks({
      existingPaths: new Set([
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0",
      ]),
      version: PDF_HELPER_VERSION,
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "installed");
    assert.equal(status.installedVersion, PDF_HELPER_VERSION);
    assert.equal(status.latestVersion, PDF_HELPER_VERSION);
    assert.isFalse(status.needsUpdate);
    assert.equal(
      status.installDir,
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0",
    );
    assert.include(
      status.executablePath,
      "/bin/zopilot-pdf-helper/zopilot-pdf-helper",
    );
  });

  it("reports not installed when the private helper is absent", async function () {
    installRuntimeMocks();

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "not-installed");
    assert.isFalse(status.hasInstallCandidate);
    assert.isFalse(status.needsUpdate);
  });

  it("reports an outdated helper when only an old install directory exists", async function () {
    installRuntimeMocks({
      children: [
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0",
      ],
      versionsByPath: {
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0/VERSION":
          "0.1.0\n",
      },
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "outdated");
    assert.equal(status.installedVersion, "0.1.0");
    assert.equal(status.latestVersion, PDF_HELPER_VERSION);
    assert.isTrue(status.hasInstallCandidate);
    assert.isTrue(status.needsUpdate);
  });

  it("reports an incomplete helper when the latest install directory is empty", async function () {
    installRuntimeMocks({
      children: [
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0",
      ],
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "outdated");
    assert.equal(status.installedVersion, PDF_HELPER_VERSION);
    assert.equal(status.installedVersionState, "incomplete");
    assert.isTrue(status.needsUpdate);
  });

  it("reports a Windows x64 helper executable with .exe suffix", async function () {
    installRuntimeMocks({
      runtime: {
        OS: "WINNT",
        XPCOMABI: "x86_64-msvc",
      },
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "not-installed");
    if (status.status === "unsupported") {
      assert.fail("Expected Windows x64 to be supported");
    }
    assert.equal(status.platform, "windows-x64");
    assert.include(status.executablePath, "/zopilot-pdf-helper.exe");
  });

  it("removes the private helper runtime directory", async function () {
    const removed: string[] = [];
    installRuntimeMocks({ removed });

    const status = await removePdfHelperDependency();

    assert.equal(status.status, "not-installed");
    assert.deepEqual(removed, ["/profile/zopilot/runtime/pdf-helper"]);
  });

  it("installs helper zip artifacts with slash-separated entrypoints", async function () {
    const archiveBytes = new TextEncoder().encode("mock zip");
    const sha256 = await sha256Hex(archiveBytes);
    const finalExecutable =
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper";
    const existingPaths = new Set<string>();
    const writtenPaths: string[] = [];
    const extractedPaths: string[] = [];
    const madeDirs: string[] = [];
    const movedPaths: Array<{ source: string; dest: string }> = [];
    const permissions: string[] = [];
    const progressPhases: string[] = [];
    const progressPercents: number[] = [];
    installRuntimeMocks({
      existingPaths,
      joinRejectsSlashSegments: true,
      version: PDF_HELPER_VERSION,
    });
    installNativeZipReaderMock({
      entries: [
        "zopilot-pdf-helper-macos-arm64-v0.2.0/VERSION",
        "zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
      ],
      existingPaths,
      extractedPaths,
    });
    (
      globalThis as typeof globalThis & {
        IOUtils: {
          exists(path: string): Promise<boolean>;
          readUTF8(path: string): Promise<string>;
          remove(
            path: string,
            options: { recursive?: boolean; ignoreAbsent?: boolean },
          ): Promise<void>;
          move(source: string, dest: string): Promise<void>;
          makeDirectory(
            path: string,
            options: { createAncestors?: boolean; ignoreExisting?: boolean },
          ): Promise<void>;
          write(
            path: string,
            bytes: Uint8Array,
            options: { flush?: boolean },
          ): Promise<number>;
          setPermissions(
            path: string,
            permissions: number,
            honorUmask?: boolean,
          ): Promise<void>;
        };
      }
    ).IOUtils = {
      ...(globalThis as unknown as { IOUtils: typeof IOUtils }).IOUtils,
      async remove(path) {
        for (const item of Array.from(existingPaths)) {
          if (item === path || item.startsWith(`${path}/`)) {
            existingPaths.delete(item);
          }
        }
      },
      async makeDirectory(path) {
        madeDirs.push(path);
        existingPaths.add(path);
      },
      async write(path, bytes) {
        writtenPaths.push(path);
        existingPaths.add(path);
        return bytes.byteLength;
      },
      async move(source, dest) {
        movedPaths.push({ source, dest });
        for (const item of Array.from(existingPaths)) {
          if (item === source || item.startsWith(`${source}/`)) {
            existingPaths.delete(item);
            existingPaths.add(`${dest}${item.slice(source.length)}`);
          }
        }
      },
      async setPermissions(path) {
        permissions.push(path);
      },
    };
    const originalFetch = globalThis.fetch;
    (
      globalThis as typeof globalThis & {
        fetch: typeof fetch;
      }
    ).fetch = (async (url: string) => {
      if (url.endsWith("pdf-helper-manifest.json")) {
        return {
          ok: true,
          json: async () =>
            createManifest({
              artifacts: [
                {
                  platform: "macos-arm64",
                  fileName: "helper.zip",
                  url: "https://example.test/helper.zip",
                  sha256,
                  size: archiveBytes.byteLength,
                  entrypoint:
                    "zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
                },
              ],
            }),
        };
      }
      return {
        ok: true,
        headers: {
          get: (name: string) =>
            name === "Content-Length" ? String(archiveBytes.byteLength) : null,
        },
        body: null,
        arrayBuffer: async () => archiveBytes.buffer,
      };
    }) as typeof fetch;

    try {
      const status = await installPdfHelperDependency((progress) => {
        progressPhases.push(progress.phase);
        if (typeof progress.percent === "number") {
          progressPercents.push(progress.percent);
        }
      });

      assert.equal(status.status, "installed");
      assert.includeMembers(progressPhases, [
        "manifest",
        "download",
        "verify",
        "write",
        "extract",
        "complete",
      ]);
      assert.include(progressPercents, 100);
      assert.include(madeDirs, "/profile/zopilot/runtime/pdf-helper/downloads");
      assert.include(
        writtenPaths,
        "/profile/zopilot/runtime/pdf-helper/downloads/helper.zip",
      );
      assert.isTrue(
        extractedPaths.some((path) =>
          path.endsWith(
            "/zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
          ),
        ),
      );
      assert.lengthOf(movedPaths, 1);
      assert.match(
        movedPaths[0].source,
        /^\/profile\/zopilot\/runtime\/pdf-helper\/\.installing-macos-arm64-\d+\/zopilot-pdf-helper-macos-arm64-v0\.2\.0$/,
      );
      assert.equal(
        movedPaths[0].dest,
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0",
      );
      assert.isTrue(existingPaths.has(finalExecutable));
      assert.deepEqual(permissions, [finalExecutable]);
    } finally {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
        originalFetch;
    }
  });

  it("updates by deleting the whole helper runtime before installing latest", async function () {
    const archiveBytes = new TextEncoder().encode("mock zip");
    const sha256 = await sha256Hex(archiveBytes);
    const existingPaths = new Set<string>([
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0",
    ]);
    const removed: string[] = [];
    installRuntimeMocks({
      children: [
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0",
      ],
      existingPaths,
      removed,
      version: PDF_HELPER_VERSION,
    });
    installNativeZipReaderMock({
      entries: [
        "zopilot-pdf-helper-macos-arm64-v0.2.0/VERSION",
        "zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
      ],
      existingPaths,
      extractedPaths: [],
    });
    patchInstallIOUtils(existingPaths);
    const originalFetch = mockPdfHelperFetch(archiveBytes, sha256);

    try {
      const status = await updatePdfHelperDependency();

      assert.equal(status.status, "installed");
      assert.equal(removed[0], "/profile/zopilot/runtime/pdf-helper");
    } finally {
      (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch =
        originalFetch;
    }
  });
});

function createManifest(
  patch: Partial<PdfHelperManifest> = {},
): PdfHelperManifest {
  return {
    schemaVersion: 2,
    version: PDF_HELPER_VERSION,
    artifacts: [
      {
        platform: "macos-arm64",
        fileName: "helper-macos-arm64.zip",
        url: "https://example.test/helper-macos-arm64.zip",
        sha256: "0".repeat(64),
        size: 1,
        entrypoint: "helper/bin/zopilot-pdf-helper",
      },
      {
        platform: "macos-x64",
        fileName: "helper-macos-x64.zip",
        url: "https://example.test/helper-macos-x64.zip",
        sha256: "0".repeat(64),
        size: 1,
        entrypoint: "helper/bin/zopilot-pdf-helper",
      },
      {
        platform: "windows-x64",
        fileName: "helper-windows-x64.zip",
        url: "https://example.test/helper-windows-x64.zip",
        sha256: "0".repeat(64),
        size: 1,
        entrypoint: "helper/bin/zopilot-pdf-helper.exe",
      },
    ],
    ...patch,
  };
}

function installRuntimeMocks({
  existingPaths = new Set<string>(),
  children = [],
  joinRejectsSlashSegments = false,
  removed = [],
  runtime = {
    OS: "Darwin",
    XPCOMABI: "aarch64-gcc3",
  },
  version = "",
  versionsByPath = {},
}: {
  existingPaths?: Set<string>;
  children?: string[];
  joinRejectsSlashSegments?: boolean;
  removed?: string[];
  runtime?: {
    OS: string;
    XPCOMABI: string;
  };
  version?: string;
  versionsByPath?: Record<string, string>;
} = {}): void {
  (
    globalThis as typeof globalThis & {
      Services: {
        appinfo: {
          OS: string;
          XPCOMABI: string;
        };
      };
      Zotero: {
        Profile: {
          dir: string;
        };
      };
      PathUtils: {
        join(...parts: string[]): string;
      };
      IOUtils: {
        exists(path: string): Promise<boolean>;
        readUTF8(path: string): Promise<string>;
        getChildren(path: string): Promise<string[]>;
        remove(
          path: string,
          options: { recursive?: boolean; ignoreAbsent?: boolean },
        ): Promise<void>;
      };
    }
  ).Services = {
    appinfo: runtime,
  };
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Profile: {
          dir: string;
        };
      };
    }
  ).Zotero = {
    Profile: {
      dir: "/profile",
    },
  };
  (
    globalThis as typeof globalThis & {
      PathUtils: {
        join(...parts: string[]): string;
      };
    }
  ).PathUtils = {
    join(...parts) {
      if (
        joinRejectsSlashSegments &&
        parts.slice(1).some((part) => part.includes("/"))
      ) {
        throw new Error("Path segment contains a slash.");
      }
      return parts.join("/").replace(/\/+/g, "/");
    },
  };
  (
    globalThis as typeof globalThis & {
      IOUtils: {
        exists(path: string): Promise<boolean>;
        readUTF8(path: string): Promise<string>;
        remove(
          path: string,
          options: { recursive?: boolean; ignoreAbsent?: boolean },
        ): Promise<void>;
      };
    }
  ).IOUtils = {
    async exists(path) {
      return existingPaths.has(path) || children.includes(path);
    },
    async readUTF8(path) {
      return versionsByPath[path] ?? version;
    },
    async getChildren(path) {
      return children.filter((child) => {
        if (!child.startsWith(`${path}/`)) {
          return false;
        }
        return !child.slice(path.length + 1).includes("/");
      });
    },
    async remove(path) {
      removed.push(path);
      for (const child of [...children]) {
        if (child === path || child.startsWith(`${path}/`)) {
          children.splice(children.indexOf(child), 1);
        }
      }
      for (const item of Array.from(existingPaths)) {
        if (item === path || item.startsWith(`${path}/`)) {
          existingPaths.delete(item);
        }
      }
    },
  };
}

function patchInstallIOUtils(existingPaths: Set<string>): void {
  (
    globalThis as typeof globalThis & {
      IOUtils: typeof IOUtils & {
        makeDirectory(path: string): Promise<void>;
        move(source: string, dest: string): Promise<void>;
        write(path: string, bytes: Uint8Array): Promise<number>;
        setPermissions(path: string): Promise<void>;
      };
    }
  ).IOUtils = {
    ...(globalThis as unknown as { IOUtils: typeof IOUtils }).IOUtils,
    async makeDirectory(path) {
      existingPaths.add(path);
    },
    async move(source, dest) {
      for (const item of Array.from(existingPaths)) {
        if (item === source || item.startsWith(`${source}/`)) {
          existingPaths.delete(item);
          existingPaths.add(`${dest}${item.slice(source.length)}`);
        }
      }
    },
    async write(path, bytes) {
      existingPaths.add(path);
      return bytes.byteLength;
    },
    async setPermissions() {
      return undefined;
    },
  };
}

function mockPdfHelperFetch(
  archiveBytes: Uint8Array,
  sha256: string,
): typeof fetch {
  const originalFetch = globalThis.fetch;
  (
    globalThis as typeof globalThis & {
      fetch: typeof fetch;
    }
  ).fetch = (async (url: string) => {
    if (url.endsWith("pdf-helper-manifest.json")) {
      return {
        ok: true,
        json: async () =>
          createManifest({
            artifacts: [
              {
                platform: "macos-arm64",
                fileName: "helper.zip",
                url: "https://example.test/helper.zip",
                sha256,
                size: archiveBytes.byteLength,
                entrypoint:
                  "zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
              },
            ],
          }),
      };
    }
    return {
      ok: true,
      headers: {
        get: (name: string) =>
          name === "Content-Length" ? String(archiveBytes.byteLength) : null,
      },
      body: null,
      arrayBuffer: async () => archiveBytes.buffer,
    };
  }) as typeof fetch;
  return originalFetch;
}

function installNativeZipReaderMock({
  entries,
  existingPaths,
  extractedPaths,
}: {
  entries: string[];
  existingPaths: Set<string>;
  extractedPaths: string[];
}): void {
  type MockLocalFile = {
    path: string;
    initWithPath(path: string): void;
  };
  (
    globalThis as typeof globalThis & {
      Components: {
        classes: Record<
          string,
          {
            createInstance(): unknown;
          }
        >;
        interfaces: Record<string, unknown>;
      };
    }
  ).Components = {
    classes: {
      "@mozilla.org/file/local;1": {
        createInstance() {
          return {
            path: "",
            initWithPath(path: string) {
              this.path = path;
            },
          } satisfies MockLocalFile;
        },
      },
      "@mozilla.org/libjar/zip-reader;1": {
        createInstance() {
          return {
            close() {
              return undefined;
            },
            extract(_entryName: string, targetFile: MockLocalFile) {
              extractedPaths.push(targetFile.path);
              existingPaths.add(targetFile.path);
            },
            findEntries() {
              let index = 0;
              return {
                getNext() {
                  return entries[index++];
                },
                hasMore() {
                  return index < entries.length;
                },
              };
            },
            getEntry(entryName: string) {
              return { isDirectory: entryName.endsWith("/") };
            },
            open(_file: MockLocalFile) {
              return undefined;
            },
          };
        },
      },
    },
    interfaces: {
      nsIFile: {},
      nsIZipReader: {},
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
