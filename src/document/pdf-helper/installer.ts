import { createLogger } from "../../runtime/logging/logger";
import { PDF_HELPER_MANIFEST_URL, PDF_HELPER_VERSION } from "./constants";
import { downloadBytes, downloadJson, sha256Hex } from "./download";
import { detectPdfHelperPlatform, selectPdfHelperArtifact } from "./manifest";
import { joinRelativePath } from "./paths";
import { getInstalledPdfHelperDir, getPdfHelperRuntimeDir } from "./status";
import type { PdfHelperInstallProgress, PdfHelperManifest } from "./types";
import { extractAndInstallZip } from "./zip";
import { geckoIO, geckoPath } from "../../platform/gecko";

const logger = createLogger("pdf-helper.install");

async function installPdfHelper(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  const installStartedAt = Date.now();
  onProgress?.({ phase: "manifest", percent: 2 });
  const manifest = await downloadJson<PdfHelperManifest>(
    PDF_HELPER_MANIFEST_URL,
  );
  const artifact = selectPdfHelperArtifact(manifest, platform);
  const runtimeDir = getPdfHelperRuntimeDir();
  const installDir = getInstalledPdfHelperDir(platform);
  const downloadDir = geckoPath.join(runtimeDir, "downloads");
  const archivePath = geckoPath.join(downloadDir, artifact.fileName);
  const finalExecutable = joinRelativePath(runtimeDir, artifact.entrypoint);
  const tempDir = geckoPath.join(
    runtimeDir,
    `.installing-${platform}-${Date.now()}`,
  );

  await geckoIO.makeDirectory(downloadDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await geckoIO.makeDirectory(runtimeDir, {
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
  await geckoIO.write(archivePath, archiveBytes, { flush: true });
  onProgress?.({ phase: "extract", percent: 97 });

  try {
    logger.info("pdf helper extraction started", {
      archivePath,
      installDir,
      platform,
      size: actualSize,
    });
    await extractAndInstallZip(archivePath, tempDir, installDir, artifact);
    if (!(await geckoIO.exists(finalExecutable).catch(() => false))) {
      throw new Error("PDF helper install did not produce an executable.");
    }
    logger.info("pdf helper installed", {
      durationMs: Date.now() - installStartedAt,
      executablePath: finalExecutable,
      installDir,
      platform,
      version: PDF_HELPER_VERSION,
    });
  } catch (error) {
    logger.error("pdf helper install failed", error, {
      archivePath,
      installDir,
      platform,
      tempDir,
    });
    throw error;
  } finally {
    await geckoIO
      .remove(tempDir, {
        recursive: true,
        ignoreAbsent: true,
      })
      .catch(() => undefined);
  }
  if (platform !== "windows-x64") {
    await geckoIO
      .setPermissions(finalExecutable, 0o755, false)
      .catch(() => undefined);
  }
  onProgress?.({ phase: "complete", percent: 100 });
  return finalExecutable;
}

export { installPdfHelper };
