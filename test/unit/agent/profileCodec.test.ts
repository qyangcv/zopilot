import { assert } from "chai";
import {
  parseStoredProfiles,
  toStoredProviderProfile,
} from "../../../src/application/providers/persistence/profileCodec.ts";

describe("provider profile codec", function () {
  it("loads legacy profile JSON while stripping snapshot-only fields", function () {
    const profiles = parseStoredProfiles(
      JSON.stringify([
        {
          id: "deepseek.legacy",
          kind: "openai-compatible",
          preset: "deepseek",
          displayName: "Legacy DeepSeek",
          baseURL: "https://api.deepseek.com",
          models: [{ id: "deepseek-chat", displayName: "DeepSeek Chat" }],
          hasApiKey: true,
          status: "connected",
          capabilities: {},
          timeoutMs: 180000,
          retryCount: 1,
          enabled: true,
        },
      ]),
    );

    assert.lengthOf(profiles, 1);
    assert.equal(profiles[0]?.id, "deepseek.legacy");
    assert.equal(profiles[0]?.providerId, "deepseek");
    assert.equal(profiles[0]?.models[0]?.id, "deepseek-chat");
    assert.notProperty(profiles[0] as object, "hasApiKey");
    assert.notProperty(
      toStoredProviderProfile({ ...profiles[0]!, hasApiKey: true }),
      "hasApiKey",
    );
  });

  it("ignores malformed provider preference payloads", function () {
    assert.deepEqual(parseStoredProfiles("not-json"), []);
    assert.deepEqual(parseStoredProfiles(JSON.stringify({ id: "wrong" })), []);
  });

  it("upgrades legacy automatic hostnames without overwriting custom names", function () {
    const profiles = parseStoredProfiles(
      JSON.stringify([
        {
          id: "deepseek.auto",
          preset: "openai-compatible",
          displayName: "deepseek.com",
          baseURL: "https://api.deepseek.com",
        },
        {
          id: "deepseek.custom",
          preset: "openai-compatible",
          displayName: "Research Gateway",
          baseURL: "https://api.deepseek.com",
        },
      ]),
    );

    assert.equal(profiles[0]?.displayName, "DeepSeek");
    assert.equal(profiles[0]?.providerId, "deepseek");
    assert.equal(profiles[1]?.displayName, "Research Gateway");
    assert.equal(profiles[1]?.providerId, "deepseek");
  });
});
