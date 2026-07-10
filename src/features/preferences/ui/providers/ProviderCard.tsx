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
          <h3>{profile.displayName}</h3>
          <p>
            {profile.kind === "codex-cli"
              ? "Local Codex CLI backend"
              : profile.baseURL}
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
            Test
          </button>
          {profile.kind !== "codex-cli" ? (
            <>
              <button
                className="zp-pref-button zp-pref-button-secondary"
                onClick={() => setEditing((value) => !value)}
                type="button"
              >
                <KeyRound size={14} />
                Edit
              </button>
              <button
                className="zp-pref-button zp-pref-button-danger"
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
        {profile.status}
        {profile.kind !== "codex-cli"
          ? profile.hasApiKey
            ? " · key saved"
            : " · key missing"
          : ""}
      </div>
      <div className="zp-pref-provider-meta">
        <span>{formatModelCount(profile)}</span>
        <span>{formatModelSummary(profile.models)}</span>
      </div>
      {editing ? (
        <div className="zp-pref-form-grid">
          <label>
            <span>Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Base URL</span>
            <input
              value={baseURL}
              onChange={(event) => setBaseURL(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>API key</span>
            <input
              autoComplete="off"
              placeholder={profile.hasApiKey ? "Saved" : ""}
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
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatModelSummary(models: AgentModelEntry[]): string {
  return models.length
    ? models
        .slice(0, 4)
        .map((model) => model.displayName)
        .join(", ")
    : "No models saved";
}

function formatModelCount(profile: ProviderProfile): string {
  const noun = profile.models.length === 1 ? "model" : "models";
  const state = profile.kind === "codex-cli" ? "available" : "enabled";
  return `${profile.models.length} ${noun} ${state}`;
}

export { ProviderCard };
export type { ProviderCardProps };
