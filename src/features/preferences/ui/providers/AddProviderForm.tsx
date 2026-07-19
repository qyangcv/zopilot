import { LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { useId, useMemo, useState, type ReactElement } from "react";
import type { AgentModelEntry } from "../../../../domain/agent/types";
import type { AgentProviderId } from "../../../../domain/agent/types";
import {
  PROVIDER_CATALOG,
  getProviderDefinition,
} from "../../../../domain/agent/modelCatalog";
import { localized, type LocalizedMessage } from "../../localization";
import { LocalizedMessageText, T } from "../PreferenceChrome";
import { providerErrorMessage } from "./providerMessages";
import { SingleSelect } from "../../../../ui/primitives/index";
import { ProviderBrandIcon } from "../../../../ui/ProviderBrandIcon";

type AddProviderFormProps = {
  onCancel: () => void;
  onCreate: (input: {
    providerId: Exclude<AgentProviderId, "codex">;
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: AgentModelEntry[];
  }) => void;
  onListModels: (input: {
    providerId: Exclude<AgentProviderId, "codex">;
    baseURL: string;
    apiKey: string;
  }) => Promise<AgentModelEntry[]>;
  onCreated: () => void;
};

function updateSelectedModelIds(
  current: string[],
  modelId: string,
  checked: boolean,
): string[] {
  return checked
    ? [...new Set([...current, modelId])]
    : current.filter((id) => id !== modelId);
}

function AddProviderForm(props: AddProviderFormProps): ReactElement {
  const providerLabelId = `zp-provider-label-${useId().replaceAll(":", "")}`;
  const selectableProviders = PROVIDER_CATALOG.filter(
    (provider) => provider.selectable,
  );
  const [providerId, setProviderId] =
    useState<Exclude<AgentProviderId, "codex">>("openrouter");
  const [baseURL, setBaseURL] = useState(
    getProviderDefinition("openrouter").defaultBaseURL || "",
  );
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<AgentModelEntry[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState<LocalizedMessage>();
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
        providerId,
        baseURL: baseURL.trim(),
        apiKey,
      });
      setModels(nextModels);
      setSelectedModels(nextModels.map((model) => model.id));
      setMessage(
        nextModels.length ? undefined : localized("pref-provider-models-empty"),
      );
    } catch (error) {
      resetModels();
      setMessage(providerErrorMessage(error));
    } finally {
      setLoadingModels(false);
    }
  };
  const createProvider = () => {
    if (!canCreate) return;
    props.onCreate({
      providerId,
      baseURL: baseURL.trim(),
      apiKey,
      models: selectedEntries,
    });
    setBaseURL(getProviderDefinition(providerId).defaultBaseURL || "");
    setApiKey("");
    resetModels();
    setMessage(localized("pref-provider-added"));
    props.onCreated();
  };

  return (
    <div className="zp-pref-provider-create">
      <div className="zp-pref-card-header">
        <div>
          <h3>
            <T id="pref-provider-add-title" />
          </h3>
          <p>
            <T id="pref-provider-add-description" />
          </p>
        </div>
        <button
          className="zp-pref-button zp-pref-button-secondary"
          onClick={props.onCancel}
          type="button"
        >
          <T id="pref-cancel" />
        </button>
      </div>
      <div className="zp-pref-provider-steps">
        <section className="zp-pref-provider-step">
          <h4>
            <T id="pref-provider-step-credentials" />
          </h4>
          <div className="zp-pref-form-grid">
            <div className="zp-pref-form-field">
              <span id={providerLabelId}>
                <T id="pref-provider-kind" />
              </span>
              <SingleSelect
                aria-labelledby={providerLabelId}
                onChange={(value) => {
                  const nextProviderId = value as Exclude<
                    AgentProviderId,
                    "codex"
                  >;
                  setProviderId(nextProviderId);
                  setBaseURL(
                    getProviderDefinition(nextProviderId).defaultBaseURL || "",
                  );
                  resetModels();
                }}
                options={selectableProviders.map((provider) => ({
                  icon: <ProviderBrandIcon brand={provider.id} size={16} />,
                  label: provider.displayName,
                  value: provider.id,
                }))}
                value={providerId}
                variant="form"
              />
            </div>
            <label>
              <T id="pref-provider-base-url" />
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
                <T id="pref-provider-base-url-hint" />
              </span>
            </label>
            <label>
              <T id="pref-provider-api-key" />
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
            <T
              id={
                loadingModels
                  ? "pref-provider-listing-models"
                  : "pref-provider-list-models"
              }
            />
          </button>
        </section>
        <section className="zp-pref-provider-step zp-pref-provider-model-step">
          <h4>
            <T id="pref-provider-step-models" />
          </h4>
          <div className="zp-pref-provider-model-area">
            {models.length ? (
              <div className="zp-pref-model-checklist">
                {models.map((model) => (
                  <label key={model.id}>
                    <input
                      checked={selectedModels.includes(model.id)}
                      type="checkbox"
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedModels((current) =>
                          updateSelectedModelIds(current, model.id, checked),
                        );
                      }}
                    />
                    <span>{model.displayName}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="zp-pref-muted">
                <T id="pref-provider-models-query-first" />
              </p>
            )}
          </div>
          {message || canCreate ? (
            <div className="zp-pref-provider-create-actions">
              {message ? (
                <div className="zp-pref-status zp-pref-status-message">
                  <LocalizedMessageText message={message} />
                </div>
              ) : null}
              {canCreate ? (
                <button
                  className="zp-pref-button zp-pref-button-secondary"
                  onClick={createProvider}
                  type="button"
                >
                  <Plus size={14} />
                  <T id="pref-provider-add" />
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export { AddProviderForm, updateSelectedModelIds };
export type { AddProviderFormProps };
