import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import { ProviderBrandIcon } from "../../../ui/ProviderBrandIcon";
import { SingleSelect } from "../../../ui/primitives/index";
import type { SidebarActions, SidebarState } from "./types";

function ModelSelector({
  actions,
  state,
}: {
  actions: Pick<SidebarActions, "selectModel" | "selectModelEffort">;
  state: Pick<
    SidebarState,
    | "models"
    | "selectedModel"
    | "selectedProviderId"
    | "selectedReasoningEffort"
  >;
}): ReactElement {
  return (
    <SingleSelect
      aria-label={getString("sidebar-model-name")}
      allowFullTriggerLabel
      disabled={!state.models.length}
      onChange={actions.selectModel}
      onSubChange={actions.selectModelEffort}
      options={state.models.map((model) => {
        const selected =
          model.providerProfileId === state.selectedProviderId &&
          model.slug === state.selectedModel;
        return {
          groupIcon: model.providerBrand ? (
            <ProviderBrandIcon brand={model.providerBrand} size={14} />
          ) : undefined,
          groupLabel: model.providerLabel,
          label: model.displayName,
          subDefaultValue: resolveDefaultEffort(model),
          subOptions: model.supportedReasoningEfforts.map((effort) => ({
            label: formatEffortLabel(effort),
            value: effort,
          })),
          subValue: selected ? state.selectedReasoningEffort : undefined,
          triggerIcon: model.providerBrand ? (
            <ProviderBrandIcon brand={model.providerBrand} size={14} />
          ) : undefined,
          triggerDetail:
            selected && state.selectedReasoningEffort
              ? formatEffortLabel(state.selectedReasoningEffort)
              : undefined,
          value: createModelSelectValue(model.providerProfileId, model.slug),
        };
      })}
      popupWidth={160}
      showIndicator={false}
      subPopupLabel={getString("sidebar-reasoning-depth")}
      subPopupMinWidth={96}
      title={getString("sidebar-model-name")}
      value={createModelSelectValue(
        state.selectedProviderId,
        state.selectedModel,
      )}
      variant="compact"
    />
  );
}

function resolveDefaultEffort(model: SidebarState["models"][number]): string {
  const defaultEffort = model.defaultReasoningEffort;
  if (
    defaultEffort &&
    model.supportedReasoningEfforts.includes(defaultEffort)
  ) {
    return defaultEffort;
  }
  return model.supportedReasoningEfforts[0] || "";
}

function formatEffortLabel(effort: string): string {
  return effort.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase());
}

function createModelSelectValue(
  providerProfileId: string,
  model: string,
): string {
  return `${providerProfileId}\u0000${model}`;
}

export { ModelSelector };
