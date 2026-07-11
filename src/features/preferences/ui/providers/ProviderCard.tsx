import {
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState, type ReactElement } from "react";
import type {
  AgentModelEntry,
  ProviderProfile,
} from "../../../../domain/agent/types";
import { l10nAttributes, type LocalizedMessage } from "../../localization";
import { T } from "../PreferenceChrome";
import { ProviderBrandIcon } from "../../../sidebar/ui/ProviderBrandIcon";

type ProviderCardProps = {
  checking: boolean;
  onCheck: () => void;
  onDelete: () => void;
  onUpdate: (input: {
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
  }) => void;
  profile: ProviderProfile;
};

function ProviderCard({
  checking,
  onCheck,
  onDelete,
  onUpdate,
  profile,
}: ProviderCardProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [baseURL, setBaseURL] = useState(profile.baseURL || "");
  const [apiKey, setApiKey] = useState("");
  const save = () => {
    onUpdate({ displayName, baseURL, apiKey });
    setApiKey("");
    setEditing(false);
  };
  return (
    <div className="zp-pref-card zp-pref-provider-card">
      <div className="zp-pref-card-header">
        <div>
          <h3 className="zp-pref-provider-title">
            <ProviderBrandIcon brand={profile.providerId} size={18} />
            {profile.displayName}
          </h3>
          <p>
            {profile.kind === "codex-cli" ? (
              <T id="pref-provider-codex-description">本地 Codex CLI 后端</T>
            ) : (
              profile.baseURL
            )}
          </p>
        </div>
        <div className="zp-pref-button-group">
          <button
            className="zp-pref-button zp-pref-button-secondary"
            disabled={checking}
            onClick={onCheck}
            type="button"
          >
            {checking ? (
              <LoaderCircle className="zp-pref-spin" size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
            <T id={checking ? "pref-provider-testing" : "pref-provider-test"}>
              {checking ? "正在测试…" : "测试连接"}
            </T>
          </button>
          {profile.kind !== "codex-cli" ? (
            <>
              <button
                className="zp-pref-button zp-pref-button-secondary"
                onClick={() => setEditing((value) => !value)}
                type="button"
              >
                <KeyRound size={14} />
                <T id="pref-provider-edit">编辑</T>
              </button>
              <button
                className="zp-pref-button zp-pref-button-danger"
                {...l10nAttributes("pref-provider-delete-button")}
                onClick={onDelete}
                type="button"
              >
                <Trash2 size={14} />
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className={`zp-pref-status zp-pref-status-${profile.status}`}>
        {profile.status === "connected" ? (
          <PlugZap size={16} />
        ) : (
          <CircleAlert size={16} />
        )}
        <T id={getStatusMessageId(profile.status)} />
        {profile.kind !== "codex-cli" ? (
          profile.hasApiKey ? (
            <>
              {" · "}
              <T id="pref-provider-key-saved">API 密钥已保存</T>
            </>
          ) : (
            <>
              {" · "}
              <T id="pref-provider-key-missing">缺少 API 密钥</T>
            </>
          )
        ) : (
          ""
        )}
      </div>
      <div className="zp-pref-provider-meta">
        <T
          args={{ count: profile.models.length }}
          id={
            profile.kind === "codex-cli"
              ? "pref-provider-models-available"
              : "pref-provider-models-enabled"
          }
        />
        <span>
          {profile.models.length ? (
            formatModelSummary(profile.models)
          ) : (
            <T id="pref-provider-no-models">暂无已保存的模型</T>
          )}
        </span>
      </div>
      {editing ? (
        <div className="zp-pref-form-grid">
          <label>
            <T id="pref-provider-name">名称</T>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          <label>
            <T id="pref-provider-base-url">API 基础地址</T>
            <input
              value={baseURL}
              onChange={(event) => setBaseURL(event.currentTarget.value)}
            />
          </label>
          <label>
            <T id="pref-provider-api-key">API 密钥</T>
            <input
              autoComplete="off"
              {...(profile.hasApiKey
                ? l10nAttributes("pref-provider-api-key-input-saved")
                : {})}
              placeholder=""
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
            />
          </label>
          <div className="zp-pref-button-group">
            <button
              className="zp-pref-button zp-pref-button-primary"
              onClick={save}
              type="button"
            >
              <T id="pref-provider-save">保存</T>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatModelSummary(models: AgentModelEntry[]): string {
  return models
    .slice(0, 4)
    .map((model) => model.displayName)
    .join(", ");
}

function getStatusMessageId(
  status: ProviderProfile["status"],
): LocalizedMessage["id"] {
  return STATUS_MESSAGE_IDS[status];
}

const STATUS_MESSAGE_IDS = {
  unchecked: "pref-provider-status-unchecked",
  checking: "pref-provider-status-checking",
  connected: "pref-provider-status-connected",
  disconnected: "pref-provider-status-disconnected",
} as const;

export { ProviderCard };
export type { ProviderCardProps };
