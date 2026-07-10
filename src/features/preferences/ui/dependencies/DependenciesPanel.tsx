import { Download, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import type { PdfHelperStatus } from "../../../../document/pdf-helper/index";
import type { DependencyState } from "../types";
import { LocalizedMessageText, PageHeader, T } from "../PreferenceChrome";
import { DependencyPathList } from "./DependencyPathList";
import { DependencyProgress, DependencyStatus } from "./DependencyStatus";

type DependenciesPanelProps = {
  onCheck: () => void;
  onInstall: () => void;
  onRemove: () => void;
  state: DependencyState;
};

function DependenciesPanel({
  onCheck,
  onInstall,
  onRemove,
  state,
}: DependenciesPanelProps): ReactElement {
  const helper =
    state.status === "ready" || state.status === "error"
      ? state.helper
      : undefined;
  const busy = ["checking", "installing", "removing"].includes(state.status);
  const unsupported = helper?.status === "unsupported";
  const showUpdate = Boolean(helper?.hasInstallCandidate && !unsupported);
  const alreadyLatest = showUpdate && helper?.needsUpdate === false;

  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-dependencies-description">
            管理 Zopilot 的 PDF 解析工具，无需向系统 Python 安装软件包。
          </T>
        }
        title={<T id="pref-dependencies-title">依赖管理</T>}
      />
      <div className="zp-pref-card zp-pref-dependency-card">
        <div className="zp-pref-dependency-header">
          <DependencyHeading helper={helper} state={state} />
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
              disabled={busy || unsupported || alreadyLatest}
              onClick={onInstall}
              type="button"
            >
              {state.status === "installing" ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <Download size={14} />
              )}
              {showUpdate ? (
                <T id="pref-dependencies-update">更新</T>
              ) : (
                <T id="pref-dependencies-install">安装</T>
              )}
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
            <LocalizedMessageText message={state.message} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DependencyHeading({
  helper,
  state,
}: {
  helper?: PdfHelperStatus;
  state: DependencyState;
}): ReactElement {
  return (
    <div className="zp-pref-dependency-heading">
      <div className="zp-pref-dependency-title-row">
        <h3>
          <T id="pref-pdf-helper-card-title">PDF 解析工具</T>
        </h3>
        {state.status === "installing" ? null : (
          <DependencyStatus state={state} />
        )}
        {helper ? (
          <span className="zp-pref-dependency-meta">
            <span>
              {helper.status === "unsupported" ? (
                <T id="pref-dependencies-platform-unsupported">不支持</T>
              ) : (
                helper.platform
              )}
            </span>
            <span>v{helper.installedVersion || helper.latestVersion}</span>
          </span>
        ) : null}
      </div>
      <p>
        <T id="pref-pdf-helper-card-description">
          用于解析 PDF、提取文本和渲染页面图片。
        </T>
      </p>
    </div>
  );
}

export { DependenciesPanel };
