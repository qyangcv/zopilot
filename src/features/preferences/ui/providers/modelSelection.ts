import type { DiscoveredAgentModel } from "../../../../domain/agent/types";
import { toAgentModelEntry } from "../../../../domain/agent/modelCatalog";

export {
  ALL_MODEL_AUTHORS,
  SELECTED_MODEL_AUTHOR,
  filterDiscoveredModels,
  formatModelContext,
  formatModelPrice,
  getModelAuthorGroups,
  toAgentModelEntry,
};
export type { ModelAuthorGroup, ModelCatalogFilter, ModelSort };

const ALL_MODEL_AUTHORS = "__all__";
const SELECTED_MODEL_AUTHOR = "__selected__";

type ModelSort = "popular" | "name" | "newest" | "price" | "context";

type ModelAuthorGroup = {
  count: number;
  label: string;
  slug: string;
};

type ModelCatalogFilter = {
  author: string;
  freeOnly: boolean;
  query: string;
  selectedIds: ReadonlySet<string>;
  sort: ModelSort;
};

function getModelAuthorGroups(
  models: DiscoveredAgentModel[],
): ModelAuthorGroup[] {
  const groups = new Map<string, DiscoveredAgentModel[]>();
  for (const model of models) {
    if (!model.authorSlug) continue;
    const group = groups.get(model.authorSlug) || [];
    group.push(model);
    groups.set(model.authorSlug, group);
  }
  return [...groups.entries()]
    .map(([slug, entries]) => ({
      count: entries.length,
      label: authorLabel(slug, entries),
      slug,
    }))
    .sort((left, right) => compareText(left.label, right.label));
}

function filterDiscoveredModels(
  models: DiscoveredAgentModel[],
  filter: ModelCatalogFilter,
): DiscoveredAgentModel[] {
  const query = filter.query.trim().toLocaleLowerCase();
  const filtered = models.filter((model) => {
    if (
      filter.author !== ALL_MODEL_AUTHORS &&
      filter.author !== SELECTED_MODEL_AUTHOR &&
      model.authorSlug !== filter.author
    ) {
      return false;
    }
    if (
      filter.author === SELECTED_MODEL_AUTHOR &&
      !filter.selectedIds.has(model.id)
    ) {
      return false;
    }
    if (filter.freeOnly && !model.isFree) return false;
    return (
      !query ||
      model.id.toLocaleLowerCase().includes(query) ||
      model.displayName.toLocaleLowerCase().includes(query)
    );
  });
  return filtered.sort(modelComparator(filter.sort));
}

function modelComparator(
  sort: ModelSort,
): (left: DiscoveredAgentModel, right: DiscoveredAgentModel) => number {
  switch (sort) {
    case "name":
      return (left, right) =>
        compareText(left.displayName, right.displayName) ||
        compareText(left.id, right.id);
    case "newest":
      return (left, right) =>
        compareOptionalNumberDescending(left.createdAt, right.createdAt) ||
        left.catalogOrder - right.catalogOrder;
    case "price":
      return (left, right) =>
        compareOptionalNumber(modelPrice(left), modelPrice(right)) ||
        left.catalogOrder - right.catalogOrder;
    case "context":
      return (left, right) =>
        compareOptionalNumberDescending(
          left.contextLength,
          right.contextLength,
        ) || left.catalogOrder - right.catalogOrder;
    case "popular":
      return (left, right) => left.catalogOrder - right.catalogOrder;
  }
}

function authorLabel(slug: string, models: DiscoveredAgentModel[]): string {
  const prefix = models[0]?.displayName.split(":", 1)[0]?.trim();
  if (prefix && models[0]?.displayName.includes(":") && prefix.length <= 32) {
    return prefix;
  }
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toLocaleUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function modelPrice(model: DiscoveredAgentModel): number | undefined {
  const prompt = parsePrice(model.pricing?.prompt);
  const completion = parsePrice(model.pricing?.completion);
  return prompt === undefined || completion === undefined
    ? undefined
    : prompt + completion;
}

function formatModelPrice(model: DiscoveredAgentModel): string | undefined {
  const prompt = pricePerMillion(model.pricing?.prompt);
  const completion = pricePerMillion(model.pricing?.completion);
  return prompt && completion ? `$${prompt} / $${completion}` : undefined;
}

function pricePerMillion(value: string | undefined): string | undefined {
  const price = parsePrice(value);
  if (price === undefined) return undefined;
  const perMillion = price * 1_000_000;
  if (perMillion >= 100) return perMillion.toFixed(0);
  if (perMillion >= 1) return trimFraction(perMillion.toFixed(2));
  return trimFraction(perMillion.toFixed(3));
}

function formatModelContext(value: number | undefined): string | undefined {
  if (!value) return undefined;
  if (value >= 1_000_000) {
    return `${trimFraction((value / 1_000_000).toFixed(1))}M`;
  }
  if (value >= 1_000) {
    return `${trimFraction((value / 1_000).toFixed(0))}K`;
  }
  return String(value);
}

function parsePrice(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : undefined;
}

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareOptionalNumberDescending(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return right - left;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function trimFraction(value: string): string {
  return value.replace(/\.?0+$/, "");
}
