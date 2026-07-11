import { assert } from "chai";
import {
  createPresetProviderProfile,
  createProviderDisplayName,
} from "../../../src/domain/agent/modelCatalog.ts";

describe("provider display names", function () {
  it("uses canonical brand names for known compatible endpoints", function () {
    assert.equal(
      createProviderDisplayName("https://api.deepseek.com"),
      "DeepSeek",
    );
    assert.equal(
      createProviderDisplayName("https://open.bigmodel.cn/api/paas/v4"),
      "Zhipu AI / GLM",
    );
    assert.equal(
      createProviderDisplayName("https://api.openrouter.ai/v1"),
      "OpenRouter",
    );
  });

  it("matches only complete domain suffixes", function () {
    assert.equal(
      createProviderDisplayName("https://deepseek.com.example.org/v1"),
      "deepseek.com.example.org",
    );
  });

  it("keeps a useful hostname fallback for unknown and local services", function () {
    assert.equal(
      createProviderDisplayName("https://api.models.example.org/v1"),
      "models.example.org",
    );
    assert.equal(
      createProviderDisplayName("http://localhost:11434/v1"),
      "localhost",
    );
  });

  it("lets an explicit name and a non-generic preset take precedence", function () {
    assert.equal(
      createPresetProviderProfile({
        id: "custom",
        displayName: "Research Gateway",
        baseURL: "https://api.deepseek.com",
      }).displayName,
      "Research Gateway",
    );
    assert.equal(
      createPresetProviderProfile({
        id: "deepseek",
        preset: "deepseek",
        baseURL: "https://gateway.example.org",
      }).displayName,
      "DeepSeek",
    );
  });
});
