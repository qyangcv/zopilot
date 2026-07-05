import { assert } from "chai";
import { ProviderProfileStore } from "../../../src/agent/providerProfiles.ts";

describe("ProviderProfileStore", function () {
  beforeEach(function () {
    installZoteroPrefsMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("exposes Codex CLI as the default provider", function () {
    const store = new ProviderProfileStore();
    const snapshot = store.getSnapshot();

    assert.equal(snapshot.activeProviderId, "codex-cli.default");
    assert.equal(snapshot.profiles[0].kind, "codex-cli");
    assert.equal(snapshot.profiles[0].defaultModel, "gpt-5.5");
  });

  it("persists Codex CLI test status in subsequent snapshots", function () {
    const store = new ProviderProfileStore();

    store.updateCodexProvider({
      status: "connected",
      models: [{ id: "gpt-5.6", displayName: "GPT-5.6" }],
      lastCheckedAt: "2026-07-05T05:17:47.000Z",
    });

    const profile = store.getSnapshot().profiles[0];
    assert.equal(profile.status, "connected");
    assert.equal(profile.models[0]?.id, "gpt-5.6");
    assert.equal(profile.defaultModel, "gpt-5.6");
    assert.equal(profile.lastCheckedAt, "2026-07-05T05:17:47.000Z");
  });

  it("creates BYOK profiles while keeping API keys out of snapshots", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      apiKey: "sk-test-secret",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-chat", displayName: "deepseek-chat" }],
    });

    const snapshot = store.getSnapshot();
    const visibleProfile = snapshot.profiles.find(
      (item) => item.id === profile.id,
    );

    assert.equal(snapshot.activeProviderId, "codex-cli.default");
    assert.equal(visibleProfile?.kind, "openai-compatible");
    assert.equal(visibleProfile?.models[0]?.id, "deepseek-chat");
    assert.equal(visibleProfile?.hasApiKey, true);
    assert.notProperty(visibleProfile as object, "apiKey");
    assert.equal(store.getProfile(profile.id)?.apiKey, "sk-test-secret");
  });

  it("updates and deletes BYOK profiles with Codex fallback", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      preset: "minimax",
      apiKey: "secret-a",
      baseURL: "https://api.minimax.io/v1",
      models: [{ id: "MiniMax-M1", displayName: "MiniMax-M1" }],
    });

    store.updateProvider(profile.id, {
      apiKey: "secret-b",
      models: [{ id: "MiniMax-Text-01", displayName: "MiniMax-Text-01" }],
    });
    assert.equal(
      store.getProfile(profile.id)?.models[0]?.id,
      "MiniMax-Text-01",
    );
    assert.equal(store.getProfile(profile.id)?.apiKey, "secret-b");

    store.deleteProvider(profile.id);
    assert.equal(store.getSnapshot().activeProviderId, "codex-cli.default");
    assert.isUndefined(store.getProfile(profile.id));
  });

  it("keeps BYOK models as the provider source of truth", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      preset: "deepseek",
      apiKey: "secret-a",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-chat", displayName: "deepseek-chat" }],
    });

    store.updateProvider(profile.id, {
      models: [{ id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" }],
    });

    assert.equal(
      store.getProfile(profile.id)?.models[0]?.id,
      "deepseek-v4-flash",
    );
  });
});

function installZoteroPrefsMock(): void {
  const values = new Map<string, unknown>([
    ["extensions.zotero.zopilot.codex.model", "gpt-5.5"],
    ["extensions.zotero.zopilot.agent.activeProviderId", "codex-cli.default"],
    ["extensions.zotero.zopilot.agent.codexProviderStatus", "{}"],
    ["extensions.zotero.zopilot.agent.providerProfiles", "[]"],
    ["extensions.zotero.zopilot.agent.providerSecrets", "{}"],
  ]);
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Prefs: {
          get: (key: string) => unknown;
          set: (key: string, value: unknown) => void;
          registerObserver: (key: string, callback: () => void) => void;
        };
      };
    }
  ).Zotero = {
    Prefs: {
      get(key) {
        return values.get(key);
      },
      set(key, value) {
        values.set(key, value);
      },
      registerObserver() {
        return undefined;
      },
    },
  };
}
