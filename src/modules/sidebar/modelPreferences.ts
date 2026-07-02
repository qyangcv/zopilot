import type { SidebarModelView, SidebarState } from "./app/types";

export {
  buildModelSelectionPatch,
  getReasoningEffortsForModel,
  parseSavedReasoningEfforts,
};

type ModelSelectionPatch = Pick<
  SidebarState,
  | "models"
  | "selectedModel"
  | "availableReasoningEfforts"
  | "selectedReasoningEffort"
>;

function buildModelSelectionPatch(
  models: SidebarModelView[],
  selectedModel: string,
  savedReasoningEfforts: Record<string, string>,
): ModelSelectionPatch {
  const efforts = getReasoningEffortsForModel(selectedModel, models);
  const savedEffort = savedReasoningEfforts[selectedModel];
  const defaultEffort = models.find(
    (item) => item.slug === selectedModel,
  )?.defaultReasoningEffort;
  const selectedReasoningEffort = efforts.includes(savedEffort)
    ? savedEffort
    : defaultEffort && efforts.includes(defaultEffort)
      ? defaultEffort
      : efforts[0];

  return {
    models,
    selectedModel,
    availableReasoningEfforts: efforts,
    selectedReasoningEffort,
  };
}

function getReasoningEffortsForModel(
  model: string,
  models: SidebarModelView[],
): string[] {
  return (
    models.find((item) => item.slug === model)?.supportedReasoningEfforts || []
  );
}

function parseSavedReasoningEfforts(raw: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw || "{}")) as unknown;
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
