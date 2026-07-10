import { assert } from "chai";
import { resolveProviderBrand } from "../../../src/domain/agent/providerBrand.ts";

describe("provider brand", function () {
  it("uses the Codex brand for Codex CLI", function () {
    assert.equal(resolveProviderBrand({ kind: "codex-cli" }), "codex");
  });

  it("recognizes BYOK providers from their configured identity", function () {
    assert.equal(
      resolveProviderBrand({
        kind: "openai-compatible",
        baseURL: "https://api.deepseek.com/v1",
        model: "deepseek-v4-flash",
      }),
      "deepseek",
    );
    assert.equal(
      resolveProviderBrand({
        kind: "openai-compatible",
        displayName: "Z.AI",
        model: "glm-5",
      }),
      "z-ai",
    );
    assert.equal(resolveProviderBrand({ model: "MiniMax-M2.5" }), "minimax");
  });

  it("falls back safely for unknown OpenAI-compatible providers", function () {
    assert.equal(
      resolveProviderBrand({ baseURL: "https://provider.example/v1" }),
      "generic",
    );
  });
});
