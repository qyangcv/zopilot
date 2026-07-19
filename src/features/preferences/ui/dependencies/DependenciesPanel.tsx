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
  const showInstall = helper?.status === "not-installed";
  const showUpdate = helper?.status === "outdated";
  const showInstalling = state.status === "installing";
  const showRemove = Boolean(helper?.hasInstallCandidate);

  return (
    <section className="zp-pref-page">
      <PageHeader
        description={<T id="pref-dependencies-description" />}
        title={<T id="pref-dependencies-title" />}
      />
      <div className="zp-pref-dependency-section">
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
              <T id="pref-dependencies-check" />
            </button>
            {showInstall || showUpdate || showInstalling ? (
              <button
                className="zp-pref-button zp-pref-button-secondary"
                disabled={busy}
                onClick={onInstall}
                type="button"
              >
                {showInstalling ? (
                  <LoaderCircle className="zp-pref-spin" size={14} />
                ) : (
                  <Download size={14} />
                )}
                {showUpdate ? (
                  <T id="pref-dependencies-update" />
                ) : (
                  <T id="pref-dependencies-install" />
                )}
              </button>
            ) : null}
            {showRemove ? (
              <button
                className="zp-pref-button zp-pref-button-danger"
                disabled={busy}
                onClick={onRemove}
                type="button"
              >
                {state.status === "removing" ? (
                  <LoaderCircle className="zp-pref-spin" size={14} />
                ) : (
                  <Trash2 size={14} />
                )}
                <T id="pref-dependencies-remove" />
              </button>
            ) : null}
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
          <T id="pref-pdf-helper-card-title" />
        </h3>
        {state.status === "installing" ? null : (
          <DependencyStatus state={state} />
        )}
        {helper ? (
          <span className="zp-pref-dependency-meta">
            <span>
              {helper.status === "unsupported" ? (
                <T id="pref-dependencies-platform-unsupported" />
              ) : (
                helper.platform
              )}
            </span>
            <span>v{helper.installedVersion || helper.latestVersion}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export { DependenciesPanel };
