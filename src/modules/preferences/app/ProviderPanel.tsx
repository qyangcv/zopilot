import {
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import type { AgentModelEntry, ProviderProfile } from "../../../agent/types";
import { PageHeader, T } from "./shared";

export { ProviderPanel };

type ProviderPanelProps = {
  checkingProviderId?: string;
  message?: string;
  onCheck: (profileId: string) => void;
  onCreate: (input: {
    preset?: "openai-compatible";
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: AgentModelEntry[];
  }) => void;
  onDelete: (profileId: string) => void;
  onListModels: (input: {
    baseURL: string;
    apiKey: string;
  }) => Promise<AgentModelEntry[]>;
  onUpdate: (
    profileId: string,
    input: {
      displayName?: string;
      baseURL?: string;
      apiKey?: string;
    },
  ) => void;
  profiles: ProviderProfile[];
};

function ProviderPanel(props: ProviderPanelProps): ReactElement {
  const [draftBaseURL, setDraftBaseURL] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftModels, setDraftModels] = useState<AgentModelEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | undefined>();

  const selectedModelEntries = useMemo(
    () => draftModels.filter((model) => selectedModels.includes(model.id)),
    [draftModels, selectedModels],
  );

  const canListModels = Boolean(draftBaseURL.trim() && draftApiKey.trim());
  const canCreate = Boolean(
    draftBaseURL.trim() && draftApiKey.trim() && selectedModelEntries.length,
  );

  const listModels = async () => {
    if (!canListModels) {
      return;
    }
    setLoadingModels(true);
    setDraftMessage(undefined);
    try {
      const models = await props.onListModels({
        baseURL: draftBaseURL.trim(),
        apiKey: draftApiKey,
      });
      setDraftModels(models);
      setSelectedModels(models.map((model) => model.id));
      setDraftMessage(
        models.length ? undefined : "No models were returned by this provider.",
      );
    } catch (error) {
      setDraftModels([]);
      setSelectedModels([]);
      setDraftMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  };

  const createProvider = () => {
    if (!canCreate) {
      return;
    }
    props.onCreate({
      preset: "openai-compatible",
      baseURL: draftBaseURL.trim(),
      apiKey: draftApiKey,
      models: selectedModelEntries,
    });
    setDraftBaseURL("");
    setDraftApiKey("");
    setDraftModels([]);
    setSelectedModels([]);
    setDraftMessage("Provider added.");
  };

  return (
    <section className="zp-pref-page">
      <PageHeader
        description={<T id="pref-provider-description">管理 AI Providers。</T>}
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
                填写兼容 OpenAI 的 URL 和 API
                key，在线读取模型后勾选需要启用的模型。
              </T>
            </p>
          </div>
        </div>
        <div className="zp-pref-provider-steps">
          <section className="zp-pref-provider-step">
            <h4>1. URL and API key</h4>
            <div className="zp-pref-form-grid">
              <label>
                <span>Base URL</span>
                <input
                  autoComplete="off"
                  placeholder="https://provider.example.com/v1"
                  value={draftBaseURL}
                  onChange={(event) => {
                    setDraftBaseURL(event.currentTarget.value);
                    setDraftModels([]);
                    setSelectedModels([]);
                  }}
                />
                <span className="zp-pref-muted zp-pref-url-hint">
                  填入 OpenAI-compatible API 的 endpoint 前缀
                </span>
              </label>
              <label>
                <span>API key</span>
                <input
                  autoComplete="off"
                  type="password"
                  value={draftApiKey}
                  onChange={(event) => {
                    setDraftApiKey(event.currentTarget.value);
                    setDraftModels([]);
                    setSelectedModels([]);
                  }}
                />
              </label>
            </div>
            <button
              className="zp-pref-button zp-pref-button-secondary"
              disabled={!canListModels || loadingModels}
              onClick={() => {
                void listModels();
              }}
              type="button"
            >
              {loadingModels ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <RotateCcw size={14} />
              )}
              List models
            </button>
          </section>
          <section className="zp-pref-provider-step">
            <h4>2. Models</h4>
            {draftModels.length ? (
              <div className="zp-pref-model-checklist">
                {draftModels.map((model) => (
                  <label key={model.id}>
                    <input
                      checked={selectedModels.includes(model.id)}
                      type="checkbox"
                      onChange={(event) =>
                        setSelectedModels((current) =>
                          event.currentTarget.checked
                            ? [...new Set([...current, model.id])]
                            : current.filter((id) => id !== model.id),
                        )
                      }
                    />
                    <span>{model.displayName}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="zp-pref-muted">
                Query the provider before adding it.
              </p>
            )}
          </section>
          <section className="zp-pref-provider-step">
            <h4>3. Add provider</h4>
            <button
              className="zp-pref-button zp-pref-button-primary"
              disabled={!canCreate}
              onClick={createProvider}
              type="button"
            >
              <Plus size={14} />
              <T id="pref-provider-add">添加</T>
            </button>
            {draftMessage ? (
              <div className="zp-pref-status zp-pref-status-message">
                {draftMessage}
              </div>
            ) : null}
          </section>
        </div>
      </div>
      <div className="zp-pref-provider-list">
        {props.profiles.map((profile) => (
          <ProviderCard
            checking={profile.id === props.checkingProviderId}
            key={profile.id}
            onCheck={() => props.onCheck(profile.id)}
            onDelete={() => props.onDelete(profile.id)}
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
  checking,
  onCheck,
  onDelete,
  onUpdate,
  profile,
}: {
  checking: boolean;
  onCheck: () => void;
  onDelete: () => void;
  onUpdate: (input: {
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
  }) => void;
  profile: ProviderProfile;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [baseURL, setBaseURL] = useState(profile.baseURL || "");
  const [apiKey, setApiKey] = useState("");
  const statusClass = `zp-pref-status zp-pref-status-${profile.status}`;

  const save = () => {
    onUpdate({
      displayName,
      baseURL,
      apiKey,
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
      <div className={statusClass}>
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
  if (!models.length) {
    return "No models saved";
  }
  return models
    .slice(0, 4)
    .map((model) => model.displayName)
    .join(", ");
}

function formatModelCount(profile: ProviderProfile): string {
  const noun = profile.models.length === 1 ? "model" : "models";
  const state = profile.kind === "codex-cli" ? "available" : "enabled";
  return `${profile.models.length} ${noun} ${state}`;
}
