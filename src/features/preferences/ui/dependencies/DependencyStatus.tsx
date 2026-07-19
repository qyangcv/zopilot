import { CircleAlert, LoaderCircle, PackageCheck } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { PdfHelperInstallProgress } from "../../../../document/pdf-helper/index";
import type { LocalizedMessage } from "../../localization";
import type { DependencyState } from "../types";
import { T } from "../PreferenceChrome";

function DependencyProgress({
  progress,
}: {
  progress?: PdfHelperInstallProgress;
}): ReactElement {
  const percent = normalizeInstallPercent(progress?.percent);
  return (
    <div className="zp-pref-progress" role="status">
      <div className="zp-pref-progress-header">
        <span>{installProgressLabel(progress?.phase)}</span>
        <span>{percent}%</span>
      </div>
      <progress max={100} value={percent} />
      {progress?.phase === "download" &&
      typeof progress.loaded === "number" &&
      typeof progress.total === "number" ? (
        <div className="zp-pref-progress-meta">
          {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
        </div>
      ) : null}
    </div>
  );
}

function DependencyStatus({ state }: { state: DependencyState }): ReactElement {
  if (state.status === "checking") {
    return <BusyStatus id="pref-dependencies-status-checking" />;
  }
  if (state.status === "installing") {
    return <BusyStatus id="pref-dependencies-status-installing" />;
  }
  if (state.status === "removing") {
    return <BusyStatus id="pref-dependencies-status-removing" />;
  }
  const helper = state.helper;
  if (helper?.status === "installed") {
    return (
      <div className="zp-pref-status zp-pref-status-connected">
        <PackageCheck size={16} />
        <T id="pref-dependencies-status-installed" />
      </div>
    );
  }
  const status = helper?.status;
  const messageIds = {
    outdated: "pref-dependencies-status-update-available",
    unsupported: "pref-dependencies-status-unsupported",
    "not-installed": "pref-dependencies-status-not-installed",
    error: "pref-dependencies-status-error",
  } as const;
  const id = messageIds[status ?? "error"];
  return (
    <div className="zp-pref-status zp-pref-status-missing">
      <CircleAlert size={16} />
      <T id={id} />
    </div>
  );
}

function BusyStatus({ id }: { id: LocalizedMessage["id"] }): ReactElement {
  return (
    <div className="zp-pref-status">
      <LoaderCircle className="zp-pref-spin" size={16} />
      <T id={id} />
    </div>
  );
}

function normalizeInstallPercent(percent?: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function installProgressLabel(
  phase?: PdfHelperInstallProgress["phase"],
): ReactNode {
  switch (phase) {
    case "manifest":
      return <T id="pref-dependencies-progress-manifest" />;
    case "download":
      return <T id="pref-dependencies-progress-download" />;
    case "verify":
      return <T id="pref-dependencies-progress-verify" />;
    case "write":
      return <T id="pref-dependencies-progress-write" />;
    case "extract":
      return <T id="pref-dependencies-progress-extract" />;
    case "complete":
      return <T id="pref-dependencies-progress-complete" />;
    default:
      return <T id="pref-dependencies-progress-starting" />;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const formatted =
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

export { DependencyProgress, DependencyStatus };
