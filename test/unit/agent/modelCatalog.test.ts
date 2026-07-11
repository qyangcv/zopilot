import { assert } from "chai";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_CATALOG,
  createProviderProfile,
  getProviderDefinition,
  resolveProviderId,
} from "../../../src/domain/agent/modelCatalog.ts";

describe("provider catalog", function () {
  it("contains exactly the selectable built-in providers", function () {
    assert.deepEqual(
      PROVIDER_CATALOG.filter((provider) => provider.selectable).map(
        (provider) => provider.id,
      ),
      [
        "openrouter",
        "deepseek",
        "z-ai",
        "minimax",
        "moonshot",
        "alibaba-bailian",
        "xiaomi-mimo",
        "custom",
      ],
    );
  });

  it("gives every branded provider one name, endpoint, and icon", function () {
    for (const provider of PROVIDER_CATALOG.filter(
      (item) => item.selectable && item.id !== "custom",
    )) {
      assert.isNotEmpty(provider.displayName);
      assert.match(provider.defaultBaseURL || "", /^https:\/\//u);
      assert.isNotEmpty(provider.iconFile);
      assert.isTrue(
        existsSync(
          fileURLToPath(
            new URL(
              `../../../addon/content/icons/providers/${provider.iconFile}`,
              import.meta.url,
            ),
          ),
        ),
        `Missing icon asset for ${provider.id}`,
      );
    }
  });

  it("uses the domestic default endpoints selected for the catalog", function () {
    assert.equal(
      getProviderDefinition("minimax").defaultBaseURL,
      "https://api.minimaxi.com/v1",
    );
    assert.equal(
      getProviderDefinition("moonshot").defaultBaseURL,
      "https://api.moonshot.cn/v1",
    );
    assert.equal(
      getProviderDefinition("alibaba-bailian").defaultBaseURL,
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  });

  it("resolves known endpoints without using model-name guesses", function () {
    assert.equal(
      resolveProviderId("https://openrouter.ai/api/v1"),
      "openrouter",
    );
    assert.equal(resolveProviderId("https://api.deepseek.com"), "deepseek");
    assert.equal(resolveProviderId("https://proxy.example/v1"), "custom");
  });

  it("allows users to override a provider endpoint and display name", function () {
    const profile = createProviderProfile({
      id: "deepseek-proxy",
      providerId: "deepseek",
      displayName: "Research Gateway",
      baseURL: "https://proxy.example/v1",
    });

    assert.equal(profile.providerId, "deepseek");
    assert.equal(profile.displayName, "Research Gateway");
    assert.equal(profile.baseURL, "https://proxy.example/v1");
  });
});
