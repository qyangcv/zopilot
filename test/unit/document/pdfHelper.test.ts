import { assert } from "chai";
import {
  detectPdfHelperPlatform,
  PDF_HELPER_PLATFORM,
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
      PDF_HELPER_PLATFORM,
    );
  });

  it("rejects unsupported platforms", function () {
    assert.throws(
      () =>
        detectPdfHelperPlatform({
          OS: "WINNT",
          XPCOMABI: "x86_64-msvc",
        }),
      /only macOS arm64/,
    );
  });

  it("selects the macOS arm64 artifact from a manifest", function () {
    const artifact = selectPdfHelperArtifact(createManifest());

    assert.equal(artifact.platform, PDF_HELPER_PLATFORM);
    assert.equal(artifact.entrypoint, "helper/bin/zopilot-pdf-helper");
  });

  it("rejects mismatched helper versions", function () {
    const manifest = createManifest({ version: "9.9.9" });

    assert.throws(
      () => selectPdfHelperArtifact(manifest),
      /Unsupported PDF helper manifest version/,
    );
  });

  it("reports an installed helper when the executable and version match", async function () {
    installRuntimeMocks({
      existingPaths: new Set([
        "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
      ]),
      version: PDF_HELPER_VERSION,
    });

    const status = await getPdfHelperStatus();

    assert.equal(status.status, "installed");
    assert.equal(
      status.installDir,
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0",
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

  it("removes the private helper runtime directory", async function () {
    const removed: string[] = [];
    installRuntimeMocks({ removed });

    const status = await removePdfHelperDependency();

    assert.equal(status.status, "not-installed");
    assert.deepEqual(removed, ["/profile/zopilot/runtime/pdf-helper"]);
  });

  it("installs helper artifacts with slash-separated entrypoints", async function () {
    const archiveBytes = new Uint8Array([1, 2, 3]);
    const sha256 = await sha256Hex(archiveBytes);
    const finalExecutable =
      "/profile/zopilot/runtime/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0/bin/zopilot-pdf-helper/zopilot-pdf-helper";
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
                  platform: PDF_HELPER_PLATFORM,
                  fileName: "helper.tar.gz",
                  url: "https://example.test/helper.tar.gz",
                  sha256,
                  size: archiveBytes.byteLength,
                  entrypoint:
                    "zopilot-pdf-helper-macos-arm64-v0.1.0/bin/zopilot-pdf-helper/zopilot-pdf-helper",
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
          async call(call) {
            assert.equal(call.command, "/usr/bin/tar");
            existingPaths.add(finalExecutable);
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
        "/profile/zopilot/runtime/pdf-helper/downloads/helper.tar.gz",
      );
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
    schemaVersion: 1,
    version: PDF_HELPER_VERSION,
    artifacts: [
      {
        platform: PDF_HELPER_PLATFORM,
        fileName: "helper.tar.gz",
        url: "https://example.test/helper.tar.gz",
        sha256: "0".repeat(64),
        size: 1,
        entrypoint: "helper/bin/zopilot-pdf-helper",
      },
    ],
    ...patch,
  };
}

function installRuntimeMocks({
  existingPaths = new Set<string>(),
  joinRejectsSlashSegments = false,
  removed = [],
  version = "",
}: {
  existingPaths?: Set<string>;
  joinRejectsSlashSegments?: boolean;
  removed?: string[];
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
    appinfo: {
      OS: "Darwin",
      XPCOMABI: "aarch64-gcc3",
    },
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
