import { assert } from "chai";
import type { ProviderProfile } from "../../../src/domain/agent/types.ts";
import {
  createProviderCatalogSignature,
  createProviderRefreshSignature,
  createVisibleModelCatalog,
} from "../../../src/features/sidebar/providers/ProviderCatalogController.ts";

describe("sidebar provider catalog subscription", function () {
  it("does not rebuild the catalog when only the active provider changes", function () {
    const profiles = [
      createProfile({ id: "codex-cli.default" }),
      createProfile(),
    ];
    const codexActive = createProviderCatalogSignature({
      activeProviderId: "codex-cli.default",
      profiles,
    });
    const deepseekActive = createProviderCatalogSignature({
      activeProviderId: "deepseek.custom",
      profiles,
    });

    assert.equal(deepseekActive, codexActive);
  });

  it("ignores transient connection metadata", function () {
    const original = createProviderCatalogSignature({
      profiles: [
        createProfile({ status: "connected", lastCheckedAt: "before" }),
      ],
    });
    const updated = createProviderCatalogSignature({
      profiles: [createProfile({ status: "checking", lastCheckedAt: "after" })],
    });

    assert.equal(updated, original);
  });

  it("detects changes that require rebuilding the model catalog", function () {
    const original = createProviderCatalogSignature({
      profiles: [createProfile()],
    });
    const changedModels = createProviderCatalogSignature({
      profiles: [
        createProfile({
          models: [
            {
              id: "deepseek-v4-pro",
              displayName: "DeepSeek V4 Pro",
              supportedReasoningEfforts: ["medium", "high"],
            },
          ],
        }),
      ],
    });
    const changedEndpoint = createProviderCatalogSignature({
      profiles: [createProfile({ baseURL: "https://new.example.com/v1" })],
    });

    assert.notEqual(changedModels, original);
    assert.notEqual(changedEndpoint, original);
  });

  it("rebuilds locally without refreshing providers for visibility-only changes", function () {
    const visible = {
      profiles: [createProfile()],
    };
    const hidden = {
      profiles: [
        createProfile({
          models: [
            {
              ...createProfile().models[0],
              visible: false,
            },
          ],
        }),
      ],
    };

    assert.notEqual(
      createProviderCatalogSignature(visible),
      createProviderCatalogSignature(hidden),
    );
    assert.equal(
      createProviderRefreshSignature(visible),
      createProviderRefreshSignature(hidden),
    );
  });

  it("builds the immediate sidebar catalog from visible models only", function () {
    const models = createVisibleModelCatalog([
      createProfile({
        models: [
          {
            id: "deepseek-v4-flash",
            displayName: "DeepSeek V4 Flash",
            supportedReasoningEfforts: ["medium", "high"],
          },
          {
            id: "deepseek-v4-pro",
            displayName: "DeepSeek V4 Pro",
            supportedReasoningEfforts: ["medium", "high"],
            visible: false,
          },
        ],
      }),
      createProfile({
        id: "disabled-provider",
        enabled: false,
        models: [
          {
            id: "disabled-model",
            displayName: "Disabled Model",
            supportedReasoningEfforts: [],
          },
        ],
      }),
    ]);

    assert.deepEqual(
      models.map((model) => model.slug),
      ["deepseek-v4-flash"],
    );
  });
});

function createProfile(patch: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "deepseek.custom",
    providerId: "deepseek",
    displayName: "DeepSeek",
    kind: "openai-compatible",
    enabled: true,
    baseURL: "https://api.deepseek.com/v1",
    capabilities: {
      streaming: true,
      toolCalling: true,
      reasoning: true,
      vision: false,
    },
    models: [
      {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        supportedReasoningEfforts: ["low", "medium", "high"],
      },
    ],
    status: "connected",
    ...patch,
  };
}
