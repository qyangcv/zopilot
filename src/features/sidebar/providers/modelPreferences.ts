import type { SidebarModelView, SidebarState } from "../ui/types";

export {
  buildModelSelectionPatch,
  createReasoningPreferenceKey,
  getReasoningEffortsForModel,
  parseSavedReasoningEfforts,
  parseSavedSelectedModels,
  resolveSelectedModel,
};

type ModelSelectionPatch = Pick<
  SidebarState,
  | "models"
  | "selectedProviderId"
  | "selectedModel"
  | "availableReasoningEfforts"
  | "selectedReasoningEffort"
>;

function buildModelSelectionPatch(
  models: SidebarModelView[],
  selectedProviderId: string,
  selectedModel: string,
  savedReasoningEfforts: Record<string, string>,
): ModelSelectionPatch {
  const efforts = getReasoningEffortsForModel(
    selectedProviderId,
    selectedModel,
    models,
  );
  const savedEffort =
    savedReasoningEfforts[
      createReasoningPreferenceKey(selectedProviderId, selectedModel)
    ] || savedReasoningEfforts[selectedModel];
  const defaultEffort = models.find(
    (item) =>
      item.providerProfileId === selectedProviderId &&
      item.slug === selectedModel,
  )?.defaultReasoningEffort;
  const selectedReasoningEffort = efforts.includes(savedEffort)
    ? savedEffort
    : defaultEffort && efforts.includes(defaultEffort)
      ? defaultEffort
      : efforts[0];

  return {
    models,
    selectedProviderId,
    selectedModel,
    availableReasoningEfforts: efforts,
    selectedReasoningEffort,
  };
}

function getReasoningEffortsForModel(
  providerProfileId: string,
  model: string,
  models: SidebarModelView[],
): string[] {
  return (
    models.find(
      (item) =>
        item.providerProfileId === providerProfileId && item.slug === model,
    )?.supportedReasoningEfforts || []
  );
}

function createReasoningPreferenceKey(
  providerProfileId: string,
  model: string,
): string {
  return `${providerProfileId}:${model}`;
}

function parseSavedReasoningEfforts(raw: unknown): Record<string, string> {
  return parseStringRecord(raw, "{}");
}

function parseSavedSelectedModels(raw: unknown): Record<string, string> {
  return parseStringRecord(raw, "{}");
}

function resolveSelectedModel(input: {
  models: SidebarModelView[];
  activeProviderId: string;
  currentProviderId: string;
  currentModel: string;
  savedSelectedModels: Record<string, string>;
}): SidebarModelView | undefined {
  const savedActiveModel = input.savedSelectedModels[input.activeProviderId];
  const savedActive = input.models.find(
    (model) =>
      model.providerProfileId === input.activeProviderId &&
      model.slug === savedActiveModel,
  );
  if (savedActive) {
    return savedActive;
  }

  const current = input.models.find(
    (model) =>
      model.providerProfileId === input.currentProviderId &&
      model.slug === input.currentModel,
  );
  if (current?.providerProfileId === input.activeProviderId) {
    return current;
  }

  return (
    input.models.find(
      (model) => model.providerProfileId === input.activeProviderId,
    ) ||
    current ||
    input.models[0]
  );
}

function parseStringRecord(
  raw: unknown,
  fallback: string,
): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw || fallback)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
