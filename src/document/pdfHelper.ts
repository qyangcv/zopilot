import JSZip from "jszip";
import {
  SUPPORTED_PDF_HELPER_PLATFORMS,
  detectHostRuntime,
  type PdfHelperPlatform,
} from "../utils/platform";

export {
  PDF_HELPER_MANIFEST_URL,
  SUPPORTED_PDF_HELPER_PLATFORMS,
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
  type PdfHelperInstallProgress,
  type PdfHelperStatus,
  type PdfHelperSubprocessModule,
};

const PDF_HELPER_VERSION = "0.2.0";
const PDF_HELPER_MANIFEST_URL = `https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v${PDF_HELPER_VERSION}/pdf-helper-manifest.json`;

type PdfHelperArtifact = {
  platform: PdfHelperPlatform;
  fileName: string;
  url: string;
  sha256: string;
  size: number;
  entrypoint: string;
};

type PdfHelperManifest = {
  schemaVersion: 2;
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
  _subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  const executable = getInstalledPdfHelperExecutablePath(platform);
  if (await isInstalledPdfHelperReady(executable, platform)) {
    return executable;
  }
  if (installPromise) {
    return installPromise;
  }
  installPromise = installPdfHelper(onProgress);
  try {
    return await installPromise;
  } finally {
    installPromise = undefined;
  }
}

async function getPdfHelperStatus(): Promise<PdfHelperStatus> {
  try {
    const platform = detectPdfHelperPlatform();
    const installDir = getInstalledPdfHelperDir(platform);
    const executablePath = getInstalledPdfHelperExecutablePath(platform);
    return {
      status: (await isInstalledPdfHelperReady(executablePath, platform))
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
      installDir: getPdfHelperRuntimeDir(),
      executablePath: "",
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

function getInstalledPdfHelperExecutablePath(
  platform = detectPdfHelperPlatform(),
): string {
  return PathUtils.join(
    getInstalledPdfHelperDir(platform),
    "bin",
    "zopilot-pdf-helper",
    platform === "windows-x64"
      ? "zopilot-pdf-helper.exe"
      : "zopilot-pdf-helper",
  );
}

function getInstalledPdfHelperDir(platform: PdfHelperPlatform): string {
  return PathUtils.join(
    getPdfHelperRuntimeDir(),
    `zopilot-pdf-helper-${platform}-v${PDF_HELPER_VERSION}`,
  );
}

function selectPdfHelperArtifact(
  manifest: PdfHelperManifest,
  platform = detectPdfHelperPlatform(),
): PdfHelperArtifact {
  if (manifest.schemaVersion !== 2) {
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

function detectPdfHelperPlatform(runtime?: RuntimeInfo): PdfHelperPlatform {
  const host = detectHostRuntime(runtime);
  if (host.pdfHelperPlatform) {
    return host.pdfHelperPlatform;
  }
  throw new Error(
    [
      "Zopilot PDF helper supports macOS arm64, macOS x64, and Windows x64.",
      `Detected OS=${host.rawOS || "unknown"} ABI=${host.rawABI || "unknown"}.`,
    ].join(" "),
  );
}

async function installPdfHelper(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  onProgress?.({ phase: "manifest", percent: 2 });
  const manifest = await downloadJson<PdfHelperManifest>(
    PDF_HELPER_MANIFEST_URL,
  );
  const artifact = selectPdfHelperArtifact(manifest, platform);
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
  await extractZip(archiveBytes, runtimeDir);
  if (!(await IOUtils.exists(finalExecutable).catch(() => false))) {
    throw new Error("PDF helper install did not produce an executable.");
  }
  if (platform !== "windows-x64") {
    await IOUtils.setPermissions(finalExecutable, 0o755, false).catch(
      () => undefined,
    );
  }
  onProgress?.({ phase: "complete", percent: 100 });
  return finalExecutable;
}

async function isInstalledPdfHelperReady(
  executable: string,
  platform: PdfHelperPlatform,
): Promise<boolean> {
  if (!(await IOUtils.exists(executable).catch(() => false))) {
    return false;
  }
  const versionPath = PathUtils.join(
    getInstalledPdfHelperDir(platform),
    "VERSION",
  );
  const version = await IOUtils.readUTF8(versionPath).catch(() => "");
  return version.trim() === PDF_HELPER_VERSION;
}

async function extractZip(
  bytes: Uint8Array,
  runtimeDir: string,
): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const relativePath = normalizeZipEntryPath(entry.name);
    if (!relativePath) {
      continue;
    }
    const outputPath = joinRelativePath(runtimeDir, relativePath);
    if (entry.dir) {
      await IOUtils.makeDirectory(outputPath, {
        createAncestors: true,
        ignoreExisting: true,
      });
      continue;
    }
    await makeParentDirectory(runtimeDir, relativePath);
    const fileBytes = await entry.async("uint8array");
    await IOUtils.write(outputPath, fileBytes, { flush: true });
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
  const normalized = normalizeZipEntryPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (
    !parts.length ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid PDF helper artifact entrypoint: ${relativePath}`);
  }
  return PathUtils.join(base, ...parts);
}

async function makeParentDirectory(
  base: string,
  relativePath: string,
): Promise<void> {
  const parts = normalizeZipEntryPath(relativePath).split("/").filter(Boolean);
  const parentParts = parts.slice(0, -1);
  if (!parentParts.length) {
    return;
  }
  await IOUtils.makeDirectory(PathUtils.join(base, ...parentParts), {
    createAncestors: true,
    ignoreExisting: true,
  });
}

function normalizeZipEntryPath(path: string): string {
  return path.replace(/\\/gu, "/");
}

function progressPercent(loaded: number, total: number): number | undefined {
  if (!total || total <= 0) {
    return undefined;
  }
  const downloadPercent = Math.min(loaded / total, 1);
  return Math.max(5, Math.min(90, Math.round(downloadPercent * 90)));
}
