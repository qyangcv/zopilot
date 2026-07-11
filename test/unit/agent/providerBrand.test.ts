import { assert } from "chai";
import { resolveProviderBrand } from "../../../src/domain/agent/providerBrand.ts";

describe("provider brand", function () {
  it("uses the Codex brand for Codex CLI", function () {
    assert.equal(resolveProviderBrand({ kind: "codex-cli" }), "codex");
  });

  it("uses an explicit provider ID as the stable brand identity", function () {
    assert.equal(
      resolveProviderBrand({
        kind: "openai-compatible",
        providerId: "openrouter",
        baseURL: "https://proxy.example/v1",
        model: "deepseek-v4-flash",
      }),
      "openrouter",
    );
  });

  it("recognizes legacy profiles from their configured endpoint", function () {
    assert.equal(
      resolveProviderBrand({ baseURL: "https://api.deepseek.com/v1" }),
      "deepseek",
    );
  });

  it("falls back safely for unknown OpenAI-compatible providers", function () {
    assert.equal(
      resolveProviderBrand({ baseURL: "https://provider.example/v1" }),
      "custom",
    );
  });
});
