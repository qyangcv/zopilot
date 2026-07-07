import { assert } from "chai";
import JSZip from "jszip";
import {
  detectPdfHelperPlatform,
  PDF_HELPER_VERSION,
  getPdfHelperStatus,
  installPdfHelperDependency,
  removePdfHelperDependency,
  selectPdfHelperArtifact,
  type PdfHelperManifest,
} from "../../../src/document/pdfHelper.ts";

describe("PDF helper", function () {
  afterEach(function () {
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
      ]),
      version: PDF_HELPER_VERSION,
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "installed");
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
    const archiveBytes = await createHelperZip({
      "zopilot-pdf-helper-macos-arm64-v0.2.0/VERSION": `${PDF_HELPER_VERSION}\n`,
      "zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper":
        "helper",
    });
    const sha256 = await sha256Hex(archiveBytes);
    const finalExecutable =
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.2.0/bin/zopilot-pdf-helper/zopilot-pdf-helper";
    const existingPaths = new Set<string>();
    const writtenPaths: string[] = [];
    const madeDirs: string[] = [];
    const permissions: string[] = [];
    const progressPhases: string[] = [];
    const progressPercents: number[] = [];
    installRuntimeMocks({
      existingPaths,
      joinRejectsSlashSegments: true,
      version: PDF_HELPER_VERSION,
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
      async makeDirectory(path) {
        madeDirs.push(path);
      },
      async write(path, bytes) {
        writtenPaths.push(path);
        existingPaths.add(path);
        return bytes.byteLength;
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
      const status = await installPdfHelperDependency(
        {
          async call() {
            return {
              stdout: { readString: async () => "" },
              stderr: { readString: async () => "" },
              wait: async () => ({ exitCode: 0 }),
            };
          },
        },
        (progress) => {
          progressPhases.push(progress.phase);
          if (typeof progress.percent === "number") {
            progressPercents.push(progress.percent);
          }
        },
      );

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
      assert.include(writtenPaths, finalExecutable);
      assert.deepEqual(permissions, [finalExecutable]);
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

async function createHelperZip(
  files: Record<string, string>,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

function installRuntimeMocks({
  existingPaths = new Set<string>(),
  joinRejectsSlashSegments = false,
  removed = [],
  runtime = {
    OS: "Darwin",
    XPCOMABI: "aarch64-gcc3",
  },
  version = "",
}: {
  existingPaths?: Set<string>;
  joinRejectsSlashSegments?: boolean;
  removed?: string[];
  runtime?: {
    OS: string;
    XPCOMABI: string;
  };
  version?: string;
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
      return existingPaths.has(path);
    },
    async readUTF8() {
      return version;
    },
    async remove(path) {
      removed.push(path);
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
