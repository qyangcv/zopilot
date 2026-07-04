import {
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState, type ReactElement } from "react";
import type {
  AgentProviderPreset,
  ProviderProfile,
} from "../../../agent/types";
import { PageHeader, T } from "./shared";

export { ProviderPanel };

type ProviderPanelProps = {
  activeProviderId: string;
  checkingProviderId?: string;
  message?: string;
  onCheck: (profileId: string) => void;
  onCreate: (input: {
    preset: Exclude<AgentProviderPreset, "codex-cli">;
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    defaultModel?: string;
  }) => void;
  onDelete: (profileId: string) => void;
  onSelect: (profileId: string) => void;
  onUpdate: (
    profileId: string,
    input: {
      displayName?: string;
      baseURL?: string;
      apiKey?: string;
      defaultModel?: string;
    },
  ) => void;
  presets: Exclude<AgentProviderPreset, "codex-cli">[];
  profiles: ProviderProfile[];
};

function ProviderPanel(props: ProviderPanelProps): ReactElement {
  const [draftPreset, setDraftPreset] =
    useState<Exclude<AgentProviderPreset, "codex-cli">>("deepseek");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftModel, setDraftModel] = useState("");

  const createProvider = () => {
    props.onCreate({
      preset: draftPreset,
      apiKey: draftApiKey,
      defaultModel: draftModel || undefined,
    });
    setDraftApiKey("");
    setDraftModel("");
  };

  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-provider-description">
            管理 Codex CLI 和自带 API key 的 OpenAI-compatible providers。
          </T>
        }
        title={<T id="pref-provider-title">Provider</T>}
      />
      <div className="zp-pref-card zp-pref-provider-create">
        <div className="zp-pref-card-header">
          <div>
            <h3>
              <T id="pref-provider-add-title">添加 BYOK provider</T>
            </h3>
            <p>
              <T id="pref-provider-add-description">
                选择已验证 preset，填写 API key 和默认 model。
              </T>
            </p>
          </div>
          <button
            className="zp-pref-button zp-pref-button-primary"
            disabled={!draftApiKey.trim()}
            onClick={createProvider}
            type="button"
          >
            <Plus size={14} />
            <T id="pref-provider-add">添加</T>
          </button>
        </div>
        <div className="zp-pref-form-grid">
          <label>
            <span>Preset</span>
            <select
              value={draftPreset}
              onChange={(event) =>
                setDraftPreset(
                  event.currentTarget.value as Exclude<
                    AgentProviderPreset,
                    "codex-cli"
                  >,
                )
              }
            >
              {props.presets.map((preset) => (
                <option key={preset} value={preset}>
                  {formatPreset(preset)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>API key</span>
            <input
              autoComplete="off"
              type="password"
              value={draftApiKey}
              onChange={(event) => setDraftApiKey(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Default model</span>
            <input
              value={draftModel}
              onChange={(event) => setDraftModel(event.currentTarget.value)}
              placeholder="provider model id"
            />
          </label>
        </div>
      </div>
      <div className="zp-pref-provider-list">
        {props.profiles.map((profile) => (
          <ProviderCard
            active={profile.id === props.activeProviderId}
            checking={profile.id === props.checkingProviderId}
            key={profile.id}
            onCheck={() => props.onCheck(profile.id)}
            onDelete={() => props.onDelete(profile.id)}
            onSelect={() => props.onSelect(profile.id)}
            onUpdate={(input) => props.onUpdate(profile.id, input)}
            profile={profile}
          />
        ))}
      </div>
      {props.message ? (
        <div className="zp-pref-status zp-pref-status-message">
          {props.message}
        </div>
      ) : null}
    </section>
  );
}

function ProviderCard({
  active,
  checking,
  onCheck,
  onDelete,
  onSelect,
  onUpdate,
  profile,
}: {
  active: boolean;
  checking: boolean;
  onCheck: () => void;
  onDelete: () => void;
  onSelect: () => void;
  onUpdate: (input: {
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    defaultModel?: string;
  }) => void;
  profile: ProviderProfile;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [baseURL, setBaseURL] = useState(profile.baseURL || "");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(profile.defaultModel);
  const statusClass = `zp-pref-status zp-pref-status-${profile.status}`;

  const save = () => {
    onUpdate({
      displayName,
      baseURL,
      apiKey,
      defaultModel,
    });
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
              : `${formatPreset(profile.preset)} · ${profile.baseURL}`}
          </p>
        </div>
        <div className="zp-pref-button-group">
          <button
            className="zp-pref-button zp-pref-button-secondary"
            disabled={active}
            onClick={onSelect}
            type="button"
          >
            {active ? "Active" : "Use"}
          </button>
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
      <div className={statusClass}>
        {profile.status === "connected" ? (
          <PlugZap size={16} />
        ) : (
          <CircleAlert size={16} />
        )}
        {active ? "Active · " : ""}
        {profile.status}
        {profile.kind !== "codex-cli"
          ? profile.hasApiKey
            ? " · key saved"
            : " · key missing"
          : ""}
      </div>
      <div className="zp-pref-provider-meta">
        <span>Model: {profile.defaultModel}</span>
        <span>
          Capabilities:{" "}
          {Object.entries(profile.capabilities)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .join(", ")}
        </span>
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
          <label>
            <span>Default model</span>
            <input
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.currentTarget.value)}
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

function formatPreset(preset: AgentProviderPreset): string {
  if (preset === "codex-cli") {
    return "Codex CLI";
  }
  if (preset === "z-ai") {
    return "Z.AI / GLM";
  }
  return preset.charAt(0).toUpperCase() + preset.slice(1);
}
