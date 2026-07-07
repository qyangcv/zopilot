import {
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type {
  PdfHelperInstallProgress,
  PdfHelperStatus,
} from "../../../document/pdfHelper";
import { copyText } from "../../sidebar/app/clipboard";
import type { DependencyState } from "./types";
import { PageHeader, T } from "./shared";

export { DependenciesPanel };

function DependenciesPanel({
  onCheck,
  onInstall,
  onRemove,
  state,
}: {
  onCheck: () => void;
  onInstall: () => void;
  onRemove: () => void;
  state: DependencyState;
}): ReactElement {
  const helper =
    state.status === "ready" || state.status === "error"
      ? state.helper
      : undefined;
  const busy =
    state.status === "checking" ||
    state.status === "installing" ||
    state.status === "removing";
  const installed = helper?.status === "installed";
  const unsupported = helper?.status === "unsupported";
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-dependencies-description">
            管理 Zopilot 的 PDF 解析依赖。
          </T>
        }
        title={<T id="pref-dependencies-title">依赖管理</T>}
      />
      <div className="zp-pref-card zp-pref-dependency-card">
        <div className="zp-pref-dependency-header">
          <div className="zp-pref-dependency-heading">
            <div className="zp-pref-dependency-title-row">
              <h3>
                <T id="pref-pdf-helper-card-title">PDF 解析 helper</T>
              </h3>
              <DependencyStatus state={state} />
              {helper ? (
                <span className="zp-pref-dependency-meta">
                  <span>{helperPlatformLabel(helper)}</span>
                  <span>v{helper.version}</span>
                </span>
              ) : null}
            </div>
            <p>
              <T id="pref-pdf-helper-card-description">
                用于解析 PDF、提取文本、渲染页面图片。
              </T>
            </p>
          </div>
          <div className="zp-pref-button-group">
            <button
              className="zp-pref-button zp-pref-button-secondary"
              disabled={busy}
              onClick={onCheck}
              type="button"
            >
              <RotateCcw size={14} />
              <T id="pref-dependencies-check">检测</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-primary"
              disabled={busy || installed || unsupported}
              onClick={onInstall}
              type="button"
            >
              {state.status === "installing" ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <Download size={14} />
              )}
              <T id="pref-dependencies-install">安装</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-danger"
              disabled={busy || unsupported}
              onClick={onRemove}
              type="button"
            >
              {state.status === "removing" ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <Trash2 size={14} />
              )}
              <T id="pref-dependencies-remove">删除</T>
            </button>
          </div>
        </div>
        {state.status === "installing" ? (
          <DependencyProgress progress={state.progress} />
        ) : null}
        {helper ? <DependencyPathList helper={helper} /> : null}
        {state.status === "error" ? (
          <div className="zp-pref-message" data-kind="error" role="status">
            {state.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}

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
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-checking">正在检测依赖...</T>
      </div>
    );
  }
  if (state.status === "installing") {
    return (
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-installing">正在安装依赖...</T>
      </div>
    );
  }
  if (state.status === "removing") {
    return (
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-removing">正在删除依赖...</T>
      </div>
    );
  }
  const helper = state.helper;
  if (!helper) {
    return (
      <div className="zp-pref-status zp-pref-status-missing">
        <CircleAlert size={16} />
        <T id="pref-dependencies-status-error">依赖状态检测失败</T>
      </div>
    );
  }
  if (helper.status === "installed") {
    return (
      <div className="zp-pref-status zp-pref-status-connected">
        <PackageCheck size={16} />
        <T id="pref-dependencies-status-installed">已安装</T>
      </div>
    );
  }
  if (helper.status === "unsupported") {
    return (
      <div className="zp-pref-status zp-pref-status-missing">
        <CircleAlert size={16} />
        <T id="pref-dependencies-status-unsupported">当前平台暂不支持</T>
      </div>
    );
  }
  return (
    <div className="zp-pref-status zp-pref-status-missing">
      <CircleAlert size={16} />
      <T id="pref-dependencies-status-not-installed">未安装</T>
    </div>
  );
}

function DependencyPathList({
  helper,
}: {
  helper: PdfHelperStatus;
}): ReactElement {
  const rows = [
    {
      action: "reveal" as const,
      key: "installDir",
      label: <T id="pref-dependencies-install-dir">安装目录</T>,
      value: helper.installDir,
    },
    {
      action: "reveal" as const,
      key: "executablePath",
      label: <T id="pref-dependencies-executable-path">可执行文件</T>,
      value: helper.executablePath,
    },
    {
      action: "open-url" as const,
      key: "manifestUrl",
      label: <T id="pref-dependencies-manifest-url">Manifest</T>,
      value: helper.manifestUrl,
    },
  ];
  return (
    <dl className="zp-pref-path-list">
      {rows.map((row) => (
        <div className="zp-pref-path-row" key={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
          <div className="zp-pref-path-actions">
            <button
              className="zp-pref-button zp-pref-button-secondary zp-pref-path-action"
              onClick={() => copyDependencyValue(row.value)}
              type="button"
            >
              <Copy size={13} />
              <T id="pref-dependencies-copy">复制</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-secondary zp-pref-path-action"
              onClick={() => openDependencyValue(row.value, row.action)}
              type="button"
            >
              {row.action === "open-url" ? (
                <ExternalLink size={13} />
              ) : (
                <FolderOpen size={13} />
              )}
              {row.action === "open-url" ? (
                <T id="pref-dependencies-open-url">打开链接</T>
              ) : (
                <T id="pref-dependencies-reveal">在文件管理器中显示</T>
              )}
            </button>
          </div>
        </div>
      ))}
      {helper.status === "unsupported" ? (
        <div className="zp-pref-path-row">
          <dt>
            <T id="pref-dependencies-unsupported-reason">原因</T>
          </dt>
          <dd title={helper.reason}>{helper.reason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function helperPlatformLabel(helper: PdfHelperStatus): string {
  return helper.status === "unsupported" ? "unsupported" : helper.platform;
}

function copyDependencyValue(value: string): void {
  void copyText(value).catch(() => undefined);
}

function openDependencyValue(
  value: string,
  action: "open-url" | "reveal",
): void {
  if (action === "open-url") {
    Zotero.launchURL(value);
    return;
  }
  void Zotero.File.reveal(value).catch(() => undefined);
}

function normalizeInstallPercent(percent?: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function installProgressLabel(
  phase?: PdfHelperInstallProgress["phase"],
): ReactNode {
  switch (phase) {
    case "manifest":
      return <T id="pref-dependencies-progress-manifest">读取 manifest</T>;
    case "download":
      return <T id="pref-dependencies-progress-download">下载 helper</T>;
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
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
