import { assert } from "chai";
import type { DiscoveredAgentModel } from "../../../src/domain/agent/types.ts";
import {
  ALL_MODEL_AUTHORS,
  SELECTED_MODEL_AUTHOR,
  filterDiscoveredModels,
  formatModelContext,
  formatModelPrice,
  getModelAuthorGroups,
  toAgentModelEntry,
} from "../../../src/features/preferences/ui/providers/modelSelection.ts";

describe("preference model selection", function () {
  let models: DiscoveredAgentModel[];

  beforeEach(function () {
    models = [
      createModel({
        authorSlug: "google",
        catalogOrder: 0,
        contextLength: 1_000_000,
        createdAt: 30,
        displayName: "Google: Gemini Pro",
        id: "google/gemini-pro",
        pricing: { completion: "0.00001", prompt: "0.000002" },
      }),
      createModel({
        authorSlug: "anthropic",
        catalogOrder: 1,
        contextLength: 200_000,
        createdAt: 20,
        displayName: "Anthropic: Claude Sonnet",
        id: "anthropic/claude-sonnet",
        pricing: { completion: "0.000015", prompt: "0.000003" },
      }),
      createModel({
        authorSlug: "anthropic",
        catalogOrder: 2,
        contextLength: 100_000,
        createdAt: 10,
        displayName: "Anthropic: Claude Haiku",
        id: "anthropic/claude-haiku:free",
        isFree: true,
        pricing: { completion: "0", prompt: "0" },
      }),
    ];
  });

  it("groups model authors alphabetically with readable labels", function () {
    assert.deepEqual(getModelAuthorGroups(models), [
      { count: 2, label: "Anthropic", slug: "anthropic" },
      { count: 1, label: "Google", slug: "google" },
    ]);
  });

  it("filters by author, search, free status, and selected models", function () {
    const selectedIds = new Set(["google/gemini-pro"]);
    assert.deepEqual(
      filterDiscoveredModels(models, {
        author: "anthropic",
        freeOnly: true,
        query: "haiku",
        selectedIds,
        sort: "popular",
      }).map((model) => model.id),
      ["anthropic/claude-haiku:free"],
    );
    assert.deepEqual(
      filterDiscoveredModels(models, {
        author: SELECTED_MODEL_AUTHOR,
        freeOnly: false,
        query: "",
        selectedIds,
        sort: "popular",
      }).map((model) => model.id),
      ["google/gemini-pro"],
    );
  });

  it("provides stable catalog sorting options", function () {
    const selectedIds = new Set<string>();
    const filter = {
      author: ALL_MODEL_AUTHORS,
      freeOnly: false,
      query: "",
      selectedIds,
    };
    assert.deepEqual(
      filterDiscoveredModels(models, { ...filter, sort: "name" }).map(
        (model) => model.id,
      ),
      [
        "anthropic/claude-haiku:free",
        "anthropic/claude-sonnet",
        "google/gemini-pro",
      ],
    );
    assert.deepEqual(
      filterDiscoveredModels(models, { ...filter, sort: "context" }).map(
        (model) => model.id,
      ),
      [
        "google/gemini-pro",
        "anthropic/claude-sonnet",
        "anthropic/claude-haiku:free",
      ],
    );
  });

  it("formats model metadata and strips catalog fields before saving", function () {
    assert.equal(formatModelContext(1_000_000), "1M");
    assert.equal(formatModelContext(128_000), "128K");
    assert.equal(formatModelPrice(models[0]), "$2 / $10");
    assert.deepEqual(toAgentModelEntry(models[0]), {
      contextLength: 1_000_000,
      defaultReasoningEffort: undefined,
      displayName: "Google: Gemini Pro",
      id: "google/gemini-pro",
      supportedReasoningEfforts: [],
    });
  });
});

function createModel(
  input: Partial<DiscoveredAgentModel> &
    Pick<DiscoveredAgentModel, "catalogOrder" | "displayName" | "id">,
): DiscoveredAgentModel {
  return {
    catalogOrder: input.catalogOrder,
    displayName: input.displayName,
    id: input.id,
    inputModalities: ["text"],
    isFree: false,
    outputModalities: ["text"],
    supportedParameters: ["tools"],
    supportedReasoningEfforts: [],
    ...input,
  };
}
