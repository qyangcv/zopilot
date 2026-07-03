import { CircleAlert, LoaderCircle, PlugZap, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import type { CodexConnectionState } from "./types";
import { PageHeader, T } from "./shared";

export { ConnectionPanel };

function ConnectionPanel({
  connection,
  onCheck,
}: {
  connection: CodexConnectionState;
  onCheck: () => void;
}): ReactElement {
  const statusClass = `zp-pref-status zp-pref-status-${connection.status}`;
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-connection-description">
            检查 Zopilot 是否能连接本地 Codex app-server。
          </T>
        }
        title={<T id="pref-connection-title">连接</T>}
      />
      <div className="zp-pref-card">
        <div className="zp-pref-card-header">
          <div>
            <h3>
              <T id="pref-codex-card-title">Codex CLI</T>
            </h3>
            <p>
              <T id="pref-codex-card-description">当前作为本地智能体运行时。</T>
            </p>
          </div>
          <button
            className="zp-pref-button zp-pref-button-secondary"
            disabled={connection.status === "checking"}
            onClick={onCheck}
            type="button"
          >
            <RotateCcw size={14} />
            <T id="pref-codex-check">重新检查</T>
          </button>
        </div>
        <div className={statusClass}>
          {connection.status === "checking" ? (
            <LoaderCircle className="zp-pref-spin" size={16} />
          ) : connection.status === "connected" ? (
            <PlugZap size={16} />
          ) : (
            <CircleAlert size={16} />
          )}
          {connection.status === "checking" ? (
            <T id="pref-codex-status-checking">正在检查 Codex 连接...</T>
          ) : connection.status === "connected" ? (
            <T id="pref-codex-status-connected">已连接</T>
          ) : (
            <T id="pref-codex-status-missing">未连接</T>
          )}
        </div>
      </div>
    </section>
  );
}
