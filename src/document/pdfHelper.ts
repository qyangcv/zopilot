import { waitForSubprocessResult } from "../utils/subprocess";

export {
  PDF_HELPER_MANIFEST_URL,
  PDF_HELPER_PLATFORM,
  PDF_HELPER_VERSION,
  detectPdfHelperPlatform,
  ensurePdfHelperExecutable,
  getPdfHelperStatus,
  getInstalledPdfHelperExecutablePath,
  installPdfHelperDependency,
  removePdfHelperDependency,
  selectPdfHelperArtifact,
  type PdfHelperArtifact,
  type PdfHelperManifest,
  type PdfHelperPlatform,
  type PdfHelperInstallProgress,
  type PdfHelperStatus,
  type PdfHelperSubprocessModule,
};

const PDF_HELPER_VERSION = "0.1.0";
const PDF_HELPER_PLATFORM = "macos-arm64";
const PDF_HELPER_MANIFEST_URL = `https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v${PDF_HELPER_VERSION}/pdf-helper-manifest.json`;

type PdfHelperPlatform = typeof PDF_HELPER_PLATFORM;

type PdfHelperArtifact = {
  platform: PdfHelperPlatform;
  fileName: string;
  url: string;
  sha256: string;
  size: number;
  entrypoint: string;
};

type PdfHelperManifest = {
  schemaVersion: 1;
  version: string;
  artifacts: PdfHelperArtifact[];
};

type PdfHelperStatus =
  | {
      status: "installed";
      platform: PdfHelperPlatform;
      version: string;
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "not-installed";
      platform: PdfHelperPlatform;
      version: string;
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "unsupported";
      version: string;
      installDir: string;
      executablePath: string;
      manifestUrl: string;
      reason: string;
    };

type PdfHelperInstallProgress = {
  phase: "manifest" | "download" | "verify" | "write" | "extract" | "complete";
  loaded?: number;
  total?: number;
  percent?: number;
};

type PdfHelperSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<PdfHelperSubprocessProcess>;
};

type PdfHelperSubprocessProcess = {
  stdout?: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
};

type ByteStreamReader = {
  read(): Promise<{ done?: boolean; value?: Uint8Array | ArrayBuffer }>;
};

type RuntimeInfo = {
  OS?: string;
  XPCOMABI?: string;
  userAgent?: string;
  platform?: string;
};

type ZoteroWithProfile = typeof Zotero & {
  Profile: {
    readonly dir: string;
  };
};

let installPromise: Promise<string> | undefined;

async function ensurePdfHelperExecutable(
  subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const executable = getInstalledPdfHelperExecutablePath();
  if (await isInstalledPdfHelperReady(executable)) {
    return executable;
  }
  if (installPromise) {
    return installPromise;
  }
  installPromise = installPdfHelper(subprocess, onProgress);
  try {
    return await installPromise;
  } finally {
    installPromise = undefined;
  }
}

async function getPdfHelperStatus(): Promise<PdfHelperStatus> {
  const installDir = getInstalledPdfHelperDir();
  const executablePath = getInstalledPdfHelperExecutablePath();
  try {
    const platform = detectPdfHelperPlatform();
    return {
      status: (await isInstalledPdfHelperReady(executablePath))
        ? "installed"
        : "not-installed",
      platform,
      version: PDF_HELPER_VERSION,
      installDir,
      executablePath,
      manifestUrl: PDF_HELPER_MANIFEST_URL,
    };
  } catch (error) {
    return {
      status: "unsupported",
      version: PDF_HELPER_VERSION,
      installDir,
      executablePath,
      manifestUrl: PDF_HELPER_MANIFEST_URL,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function installPdfHelperDependency(
  subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  await ensurePdfHelperExecutable(subprocess, onProgress);
  return getPdfHelperStatus();
}

async function removePdfHelperDependency(): Promise<PdfHelperStatus> {
  await IOUtils.remove(getPdfHelperRuntimeDir(), {
    recursive: true,
    ignoreAbsent: true,
  });
  return getPdfHelperStatus();
}

function getInstalledPdfHelperExecutablePath(): string {
  return PathUtils.join(
    getInstalledPdfHelperDir(),
    "bin",
    "zopilot-pdf-helper",
    "zopilot-pdf-helper",
  );
}

function getInstalledPdfHelperDir(): string {
  return PathUtils.join(
    getPdfHelperRuntimeDir(),
    `zopilot-pdf-helper-${PDF_HELPER_PLATFORM}-v${PDF_HELPER_VERSION}`,
  );
}

function selectPdfHelperArtifact(
  manifest: PdfHelperManifest,
  platform = PDF_HELPER_PLATFORM,
): PdfHelperArtifact {
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported PDF helper manifest schema.");
  }
  if (manifest.version !== PDF_HELPER_VERSION) {
    throw new Error(
      `Unsupported PDF helper manifest version: ${manifest.version}`,
    );
  }
  const artifact = manifest.artifacts.find(
    (item) => item.platform === platform,
  );
  if (!artifact) {
    throw new Error(`No PDF helper artifact is available for ${platform}.`);
  }
  return artifact;
}

function detectPdfHelperPlatform(
  runtime = readRuntimeInfo(),
): PdfHelperPlatform {
  const os = runtime.OS || "";
  const abi = runtime.XPCOMABI || "";
  const userAgent = runtime.userAgent || "";
  const platform = runtime.platform || "";
  const isMac =
    os === "Darwin" ||
    /\bMac\b/i.test(platform) ||
    /\bMac OS X\b/i.test(userAgent);
  const isArm64 =
    /aarch64|arm64/i.test(abi) ||
    /arm64|aarch64/i.test(platform) ||
    /arm64|aarch64/i.test(userAgent);
  if (isMac && isArm64) {
    return PDF_HELPER_PLATFORM;
  }
  throw new Error(
    [
      "Zopilot PDF helper currently supports only macOS arm64.",
      `Detected OS=${os || "unknown"} ABI=${abi || "unknown"}.`,
    ].join(" "),
  );
}

async function installPdfHelper(
  subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  detectPdfHelperPlatform();
  onProgress?.({ phase: "manifest", percent: 2 });
  const manifest = await downloadJson<PdfHelperManifest>(
    PDF_HELPER_MANIFEST_URL,
  );
  const artifact = selectPdfHelperArtifact(manifest);
  const runtimeDir = getPdfHelperRuntimeDir();
  const downloadDir = PathUtils.join(runtimeDir, "downloads");
  const archivePath = PathUtils.join(downloadDir, artifact.fileName);
  const finalExecutable = joinRelativePath(runtimeDir, artifact.entrypoint);

  await IOUtils.makeDirectory(downloadDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.makeDirectory(runtimeDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const archiveBytes = await downloadBytes(
    artifact.url,
    artifact.size,
    (item) => onProgress?.(item),
  );
  onProgress?.({ phase: "verify", percent: 92 });
  const actualSize = archiveBytes.byteLength;
  if (actualSize !== artifact.size) {
    throw new Error(
      `PDF helper download size mismatch: expected ${artifact.size}, got ${actualSize}.`,
    );
  }
  const actualSha256 = await sha256Hex(archiveBytes);
  if (actualSha256 !== artifact.sha256.toLowerCase()) {
    throw new Error("PDF helper download checksum mismatch.");
  }
  onProgress?.({ phase: "write", percent: 95 });
  await IOUtils.write(archivePath, archiveBytes, { flush: true });

  onProgress?.({ phase: "extract", percent: 97 });
  await extractTarGz(subprocess, archivePath, runtimeDir);
  if (!(await IOUtils.exists(finalExecutable).catch(() => false))) {
    throw new Error("PDF helper install did not produce an executable.");
  }
  await IOUtils.setPermissions(finalExecutable, 0o755, false).catch(
    () => undefined,
  );
  onProgress?.({ phase: "complete", percent: 100 });
  return finalExecutable;
}

async function isInstalledPdfHelperReady(executable: string): Promise<boolean> {
  if (!(await IOUtils.exists(executable).catch(() => false))) {
    return false;
  }
  const versionPath = PathUtils.join(getInstalledPdfHelperDir(), "VERSION");
  const version = await IOUtils.readUTF8(versionPath).catch(() => "");
  return version.trim() === PDF_HELPER_VERSION;
}

async function extractTarGz(
  subprocess: PdfHelperSubprocessModule,
  archivePath: string,
  runtimeDir: string,
): Promise<void> {
  const proc = await subprocess.call({
    command: "/usr/bin/tar",
    arguments: ["-xzf", archivePath, "-C", runtimeDir],
    stdout: "pipe",
    stderr: "pipe",
  });
  const { exitCode, stdout, stderr } = await waitForSubprocessResult(proc);
  if (exitCode !== 0) {
    throw new Error(
      `PDF helper extraction failed (${exitCode}): ${stderr || stdout}`,
    );
  }
}

async function downloadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper manifest download failed (${response.status}): ${url}`,
    );
  }
  return (await response.json()) as T;
}

async function downloadBytes(
  url: string,
  expectedSize: number,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper archive download failed (${response.status}): ${url}`,
    );
  }
  const headerSize = Number(response.headers.get("Content-Length") || 0);
  const total = headerSize || expectedSize;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      phase: "download",
      loaded: bytes.byteLength,
      total,
      percent: progressPercent(bytes.byteLength, total),
    });
    return bytes;
  }
  const reader = response.body.getReader() as ByteStreamReader;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    loaded += chunk.byteLength;
    onProgress?.({
      phase: "download",
      loaded,
      total,
      percent: progressPercent(loaded, total),
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getPdfHelperRuntimeDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "runtime",
    "pdf-helper",
  );
}

function joinRelativePath(base: string, relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (
    !parts.length ||
    relativePath.startsWith("/") ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid PDF helper artifact entrypoint: ${relativePath}`);
  }
  return PathUtils.join(base, ...parts);
}

function progressPercent(loaded: number, total: number): number | undefined {
  if (!total || total <= 0) {
    return undefined;
  }
  const downloadPercent = Math.min(loaded / total, 1);
  return Math.max(5, Math.min(90, Math.round(downloadPercent * 90)));
}

function readRuntimeInfo(): RuntimeInfo {
  const services = (
    globalThis as typeof globalThis & {
      Services?: {
        appinfo?: {
          OS?: string;
          XPCOMABI?: string;
        };
      };
    }
  ).Services;
  return {
    OS: services?.appinfo?.OS,
    XPCOMABI: services?.appinfo?.XPCOMABI,
    userAgent: globalThis.navigator?.userAgent,
    platform: globalThis.navigator?.platform,
  };
}
