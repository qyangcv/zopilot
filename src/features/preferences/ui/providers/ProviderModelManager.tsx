import { LoaderCircle, RotateCcw, Save } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { toAgentModelEntry } from "../../../../domain/agent/modelCatalog";
import type {
  AgentModelEntry,
  DiscoveredAgentModel,
} from "../../../../domain/agent/types";
import { type LocalizedMessage } from "../../localization";
import { LocalizedMessageText, T } from "../PreferenceChrome";
import { ModelCatalogPicker } from "./ModelCatalogPicker";
import { toDiscoveredModelCatalogEntry } from "./modelSelection";
import { providerErrorPresentation } from "./providerMessages";

type ProviderModelManagerProps = {
  configuredModels: AgentModelEntry[];
  onCancel: () => void;
  onListModels: () => Promise<DiscoveredAgentModel[]>;
  onSave: (models: AgentModelEntry[]) => void;
};

function ProviderModelManager(props: ProviderModelManagerProps): ReactElement {
  const configuredModelIds = useMemo(
    () => props.configuredModels.map((model) => model.id),
    [props.configuredModels],
  );
  const [models, setModels] = useState<DiscoveredAgentModel[]>(() =>
    mergeConfiguredModelsIntoCatalog([], props.configuredModels),
  );
  const [selectedModelIds, setSelectedModelIds] =
    useState<string[]>(configuredModelIds);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<LocalizedMessage>();
  const requestId = useRef(0);

  const loadModels = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setMessage(undefined);
    try {
      const discovered = await props.onListModels();
      if (currentRequestId !== requestId.current) return;
      setModels(
        mergeConfiguredModelsIntoCatalog(discovered, props.configuredModels),
      );
    } catch (error) {
      if (currentRequestId !== requestId.current) return;
      setMessage(providerErrorPresentation(error).message);
    } finally {
      if (currentRequestId === requestId.current) setLoading(false);
    }
  }, [props.configuredModels, props.onListModels]);

  useEffect(() => {
    void loadModels();
    return () => {
      requestId.current += 1;
    };
  }, [loadModels]);

  const save = () => {
    const modelsById = new Map(models.map((model) => [model.id, model]));
    const selectedModels = selectedModelIds
      .map((id) => modelsById.get(id))
      .filter((model): model is DiscoveredAgentModel => Boolean(model))
      .map(toAgentModelEntry);
    if (!selectedModels.length) return;
    props.onSave(selectedModels);
  };

  return (
    <section className="zp-pref-provider-model-manager">
      <div className="zp-pref-provider-model-manager-header">
        <div>
          <h4>
            <T id="pref-provider-manage-models-title" />
          </h4>
          <p>
            <T id="pref-provider-manage-models-description" />
          </p>
        </div>
        <button
          className="zp-pref-button zp-pref-button-secondary"
          disabled={loading}
          onClick={() => void loadModels()}
          type="button"
        >
          {loading ? (
            <LoaderCircle className="zp-pref-spin" size={14} />
          ) : (
            <RotateCcw size={14} />
          )}
          <T
            id={
              loading
                ? "pref-provider-listing-models"
                : "pref-provider-refresh-models"
            }
          />
        </button>
      </div>
      <div className="zp-pref-provider-model-manager-catalog">
        <ModelCatalogPicker
          models={models}
          onSelectedModelIdsChange={setSelectedModelIds}
          selectedModelIds={selectedModelIds}
        />
      </div>
      <div className="zp-pref-provider-model-manager-actions">
        {message ? (
          <div className="zp-pref-status zp-pref-status-message" role="alert">
            <LocalizedMessageText message={message} />
          </div>
        ) : null}
        <button
          className="zp-pref-button zp-pref-button-secondary"
          onClick={props.onCancel}
          type="button"
        >
          <T id="pref-cancel" />
        </button>
        <button
          className="zp-pref-button zp-pref-button-primary"
          disabled={loading || selectedModelIds.length === 0}
          onClick={save}
          type="button"
        >
          <Save aria-hidden="true" size={14} />
          <T id="pref-provider-save-models" />
        </button>
      </div>
    </section>
  );
}

function mergeConfiguredModelsIntoCatalog(
  discovered: DiscoveredAgentModel[],
  configured: AgentModelEntry[],
): DiscoveredAgentModel[] {
  const configuredById = new Map(configured.map((model) => [model.id, model]));
  const merged = discovered.map((model) => {
    configuredById.delete(model.id);
    return model;
  });
  for (const model of configuredById.values()) {
    merged.push(toDiscoveredModelCatalogEntry(model, merged.length));
  }
  return merged;
}

export { ProviderModelManager, mergeConfiguredModelsIntoCatalog };
export type { ProviderModelManagerProps };
