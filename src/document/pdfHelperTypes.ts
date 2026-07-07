import type { PdfHelperPlatform } from "../utils/platform";

export {
  type PdfHelperArtifact,
  type PdfHelperManifest,
  type PdfHelperInstallProgress,
  type PdfHelperStatus,
};

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
      latestVersion: string;
      installedVersion: string;
      installedVersionState: "current";
      hasInstallCandidate: true;
      needsUpdate: false;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "not-installed";
      platform: PdfHelperPlatform;
      version: string;
      latestVersion: string;
      installedVersion?: undefined;
      installedVersionState?: undefined;
      hasInstallCandidate: false;
      needsUpdate: false;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "outdated";
      platform: PdfHelperPlatform;
      version: string;
      latestVersion: string;
      installedVersion?: string;
      installedVersionState: "outdated" | "incomplete" | "unknown";
      hasInstallCandidate: true;
      needsUpdate: true;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "unsupported";
      version: string;
      latestVersion: string;
      installedVersion?: string;
      installedVersionState?: "outdated" | "incomplete" | "unknown";
      hasInstallCandidate: boolean;
      needsUpdate: boolean;
      installCandidateDirs: string[];
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
