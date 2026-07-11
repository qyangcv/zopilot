import { assert } from "chai";
import type { ProviderProfile } from "../../../src/domain/agent/types.ts";
import { createProviderCatalogSignature } from "../../../src/features/sidebar/providers/ProviderCatalogController.ts";

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
