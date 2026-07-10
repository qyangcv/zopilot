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
    return (
      <BusyStatus
        id="pref-dependencies-status-checking"
        text="正在检测依赖..."
      />
    );
  }
  if (state.status === "installing") {
    return (
      <BusyStatus
        id="pref-dependencies-status-installing"
        text="正在安装依赖..."
      />
    );
  }
  if (state.status === "removing") {
    return (
      <BusyStatus
        id="pref-dependencies-status-removing"
        text="正在删除依赖..."
      />
    );
  }
  const helper = state.helper;
  if (helper?.status === "installed") {
    return (
      <div className="zp-pref-status zp-pref-status-connected">
        <PackageCheck size={16} />
        <T id="pref-dependencies-status-installed">已安装</T>
      </div>
    );
  }
  const status = helper?.status;
  const labels = {
    outdated: ["pref-dependencies-status-update-available", "需要更新"],
    unsupported: ["pref-dependencies-status-unsupported", "当前平台暂不支持"],
    "not-installed": ["pref-dependencies-status-not-installed", "未安装"],
    error: ["pref-dependencies-status-error", "依赖状态检测失败"],
  } as const;
  const [id, text] = labels[status ?? "error"];
  return (
    <div className="zp-pref-status zp-pref-status-missing">
      <CircleAlert size={16} />
      <T id={id}>{text}</T>
    </div>
  );
}

function BusyStatus({
  id,
  text,
}: {
  id: LocalizedMessage["id"];
  text: string;
}): ReactElement {
  return (
    <div className="zp-pref-status">
      <LoaderCircle className="zp-pref-spin" size={16} />
      <T id={id}>{text}</T>
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
      return <T id="pref-dependencies-progress-manifest">读取版本清单</T>;
    case "download":
      return <T id="pref-dependencies-progress-download">下载解析工具</T>;
    case "verify":
      return <T id="pref-dependencies-progress-verify">校验下载</T>;
    case "write":
      return <T id="pref-dependencies-progress-write">写入文件</T>;
    case "extract":
      return <T id="pref-dependencies-progress-extract">解压安装</T>;
    case "complete":
      return <T id="pref-dependencies-progress-complete">安装完成</T>;
    default:
      return <T id="pref-dependencies-progress-starting">准备安装</T>;
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
