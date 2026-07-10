import { LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import type { AgentModelEntry } from "../../../../domain/agent/types";
import { T } from "../PreferenceChrome";

type AddProviderFormProps = {
  onCreate: (input: {
    preset?: "openai-compatible";
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: AgentModelEntry[];
  }) => void;
  onListModels: (input: {
    baseURL: string;
    apiKey: string;
  }) => Promise<AgentModelEntry[]>;
};

function AddProviderForm(props: AddProviderFormProps): ReactElement {
  const [baseURL, setBaseURL] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<AgentModelEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState<string>();
  const selectedEntries = useMemo(
    () => models.filter((model) => selectedModels.includes(model.id)),
    [models, selectedModels],
  );
  const canList = Boolean(baseURL.trim() && apiKey.trim());
  const canCreate = Boolean(canList && selectedEntries.length);

  const resetModels = () => {
    setModels([]);
    setSelectedModels([]);
  };
  const listModels = async () => {
    if (!canList) return;
    setLoadingModels(true);
    setMessage(undefined);
    try {
      const nextModels = await props.onListModels({
        baseURL: baseURL.trim(),
        apiKey,
      });
      setModels(nextModels);
      setSelectedModels(nextModels.map((model) => model.id));
      setMessage(
        nextModels.length
          ? undefined
          : "No models were returned by this provider.",
      );
    } catch (error) {
      resetModels();
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  };
  const createProvider = () => {
    if (!canCreate) return;
    props.onCreate({
      preset: "openai-compatible",
      baseURL: baseURL.trim(),
      apiKey,
      models: selectedEntries,
    });
    setBaseURL("");
    setApiKey("");
    resetModels();
    setMessage("Provider added.");
  };

  return (
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
                value={baseURL}
                onChange={(event) => {
                  setBaseURL(event.currentTarget.value);
                  resetModels();
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
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.currentTarget.value);
                  resetModels();
                }}
              />
            </label>
          </div>
          <button
            className="zp-pref-button zp-pref-button-secondary"
            disabled={!canList || loadingModels}
            onClick={() => void listModels()}
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
          {models.length ? (
            <div className="zp-pref-model-checklist">
              {models.map((model) => (
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
          {message ? (
            <div className="zp-pref-status zp-pref-status-message">
              {message}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export { AddProviderForm };
export type { AddProviderFormProps };
