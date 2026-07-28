import { Search } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import type { DiscoveredAgentModel } from "../../../../domain/agent/types";
import { l10nAttributes } from "../../localization";
import { T } from "../PreferenceChrome";
import {
  ALL_MODEL_AUTHORS,
  SELECTED_MODEL_AUTHOR,
  filterDiscoveredModels,
  formatModelContext,
  formatModelPrice,
  getModelAuthorGroups,
  type ModelSort,
} from "./modelSelection";

export { ModelCatalogPicker };

type ModelCatalogPickerProps = {
  models: DiscoveredAgentModel[];
  onSelectedModelIdsChange: (modelIds: string[]) => void;
  selectedModelIds: string[];
};

function ModelCatalogPicker(props: ModelCatalogPickerProps): ReactElement {
  const [author, setAuthor] = useState(ALL_MODEL_AUTHORS);
  const [freeOnly, setFreeOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ModelSort>("popular");
  const selectedIds = useMemo(
    () => new Set(props.selectedModelIds),
    [props.selectedModelIds],
  );
  const authorGroups = useMemo(
    () => getModelAuthorGroups(props.models),
    [props.models],
  );
  const visibleModels = useMemo(
    () =>
      filterDiscoveredModels(props.models, {
        author,
        freeOnly,
        query,
        selectedIds,
        sort,
      }),
    [author, freeOnly, props.models, query, selectedIds, sort],
  );
  const showAuthorNavigation = authorGroups.length > 1;
  const hasScopedBulkSelection =
    author !== ALL_MODEL_AUTHORS || Boolean(query.trim()) || freeOnly;
  const allVisibleSelected =
    visibleModels.length > 0 &&
    visibleModels.every((model) => selectedIds.has(model.id));

  const setModelSelected = (modelId: string, selected: boolean) => {
    const next = new Set(selectedIds);
    if (selected) {
      next.add(modelId);
    } else {
      next.delete(modelId);
    }
    props.onSelectedModelIdsChange([...next]);
  };
  const setVisibleSelected = (selected: boolean) => {
    const next = new Set(selectedIds);
    for (const model of visibleModels) {
      if (selected) {
        next.add(model.id);
      } else {
        next.delete(model.id);
      }
    }
    props.onSelectedModelIdsChange([...next]);
  };

  return (
    <div className="zp-pref-model-catalog">
      <div className="zp-pref-model-toolbar">
        <label className="zp-pref-model-search">
          <Search aria-hidden="true" size={14} />
          <input
            {...l10nAttributes("pref-provider-model-search")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            type="search"
          />
        </label>
        <select
          {...l10nAttributes("pref-provider-model-sort")}
          value={sort}
          onChange={(event) => setSort(event.currentTarget.value as ModelSort)}
        >
          <option
            {...l10nAttributes("pref-provider-model-sort-popular")}
            value="popular"
          />
          <option
            {...l10nAttributes("pref-provider-model-sort-name")}
            value="name"
          />
          <option
            {...l10nAttributes("pref-provider-model-sort-newest")}
            value="newest"
          />
          <option
            {...l10nAttributes("pref-provider-model-sort-price")}
            value="price"
          />
          <option
            {...l10nAttributes("pref-provider-model-sort-context")}
            value="context"
          />
        </select>
        <label className="zp-pref-model-filter">
          <input
            checked={freeOnly}
            onChange={(event) => setFreeOnly(event.currentTarget.checked)}
            type="checkbox"
          />
          <T id="pref-provider-model-free-only" />
        </label>
      </div>
      <div
        className="zp-pref-model-browser"
        data-has-authors={showAuthorNavigation || undefined}
      >
        {showAuthorNavigation ? (
          <nav
            {...l10nAttributes("pref-provider-model-authors")}
            className="zp-pref-model-authors"
          >
            <AuthorButton
              active={author === ALL_MODEL_AUTHORS}
              count={props.models.length}
              label={<T id="pref-provider-model-author-all" />}
              onClick={() => setAuthor(ALL_MODEL_AUTHORS)}
            />
            <AuthorButton
              active={author === SELECTED_MODEL_AUTHOR}
              count={selectedIds.size}
              label={<T id="pref-provider-model-author-selected" />}
              onClick={() => setAuthor(SELECTED_MODEL_AUTHOR)}
            />
            {authorGroups.map((group) => (
              <AuthorButton
                active={author === group.slug}
                count={group.count}
                key={group.slug}
                label={group.label}
                onClick={() => setAuthor(group.slug)}
              />
            ))}
          </nav>
        ) : null}
        <div className="zp-pref-model-results">
          <div className="zp-pref-model-result-actions">
            <span className="zp-pref-muted">
              <T
                args={{ count: visibleModels.length }}
                id="pref-provider-model-results"
              />
            </span>
            {hasScopedBulkSelection && visibleModels.length ? (
              <button
                className="zp-pref-link-button"
                onClick={() => setVisibleSelected(!allVisibleSelected)}
                type="button"
              >
                <T
                  id={
                    allVisibleSelected
                      ? "pref-provider-model-clear-shown"
                      : "pref-provider-model-select-shown"
                  }
                />
              </button>
            ) : null}
          </div>
          <div className="zp-pref-model-checklist">
            {visibleModels.length ? (
              visibleModels.map((model) => (
                <ModelRow
                  checked={selectedIds.has(model.id)}
                  key={model.id}
                  model={model}
                  onChange={(checked) => setModelSelected(model.id, checked)}
                />
              ))
            ) : (
              <p className="zp-pref-muted zp-pref-model-no-results">
                <T id="pref-provider-model-no-results" />
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="zp-pref-model-selection-summary" aria-live="polite">
        <T
          args={{ count: selectedIds.size }}
          id="pref-provider-model-selected-count"
        />
        {selectedIds.size ? (
          <button
            className="zp-pref-link-button"
            onClick={() => props.onSelectedModelIdsChange([])}
            type="button"
          >
            <T id="pref-provider-model-clear-all" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AuthorButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: ReactElement | string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-pressed={active}
      className="zp-pref-model-author"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span>{count}</span>
    </button>
  );
}

function ModelRow({
  checked,
  model,
  onChange,
}: {
  checked: boolean;
  model: DiscoveredAgentModel;
  onChange: (checked: boolean) => void;
}): ReactElement {
  const context = formatModelContext(model.contextLength);
  const price = formatModelPrice(model);
  const supportsImages = model.inputModalities.includes("image");
  const supportsReasoning = model.supportedParameters.includes("reasoning");
  const supportsTools = model.supportedParameters.includes("tools");

  return (
    <label className="zp-pref-model-row">
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="zp-pref-model-row-content">
        <span className="zp-pref-model-row-title">{model.displayName}</span>
        <span className="zp-pref-model-row-id">{model.id}</span>
        <span className="zp-pref-model-row-meta">
          {model.isFree ? (
            <span>
              <T id="pref-provider-model-free" />
            </span>
          ) : price ? (
            <span>
              <T args={{ price }} id="pref-provider-model-price" />
            </span>
          ) : null}
          {context ? (
            <span>
              <T args={{ context }} id="pref-provider-model-context" />
            </span>
          ) : null}
          {supportsTools ? (
            <span>
              <T id="pref-provider-model-tools" />
            </span>
          ) : null}
          {supportsImages ? (
            <span>
              <T id="pref-provider-model-vision" />
            </span>
          ) : null}
          {supportsReasoning ? (
            <span>
              <T id="pref-provider-model-reasoning" />
            </span>
          ) : null}
        </span>
      </span>
    </label>
  );
}
