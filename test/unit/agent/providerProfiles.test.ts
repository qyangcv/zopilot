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

  it("creates BYOK profiles while keeping API keys out of snapshots", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      preset: "deepseek",
      apiKey: "sk-test-secret",
      defaultModel: "deepseek-chat",
    });

    const snapshot = store.getSnapshot();
    const visibleProfile = snapshot.profiles.find(
      (item) => item.id === profile.id,
    );

    assert.equal(snapshot.activeProviderId, profile.id);
    assert.equal(visibleProfile?.kind, "openai-compatible");
    assert.equal(visibleProfile?.hasApiKey, true);
    assert.notProperty(visibleProfile as object, "apiKey");
    assert.equal(store.getProfile(profile.id)?.apiKey, "sk-test-secret");
  });

  it("updates and deletes BYOK profiles with Codex fallback", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      preset: "minimax",
      apiKey: "secret-a",
    });

    store.updateProvider(profile.id, {
      defaultModel: "MiniMax-Text-01",
      apiKey: "secret-b",
    });
    assert.equal(store.getProfile(profile.id)?.defaultModel, "MiniMax-Text-01");
    assert.equal(store.getProfile(profile.id)?.apiKey, "secret-b");

    store.deleteProvider(profile.id);
    assert.equal(store.getSnapshot().activeProviderId, "codex-cli.default");
    assert.isUndefined(store.getProfile(profile.id));
  });

  it("keeps BYOK default model inside the available model list", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      preset: "deepseek",
      apiKey: "secret-a",
      defaultModel: "deepseek-chat",
    });

    store.updateProvider(profile.id, {
      models: [{ id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" }],
    });

    assert.equal(
      store.getProfile(profile.id)?.defaultModel,
      "deepseek-v4-flash",
    );
  });
});

function installZoteroPrefsMock(): void {
  const values = new Map<string, unknown>([
    ["extensions.zotero.zopilot.codex.model", "gpt-5.5"],
    ["extensions.zotero.zopilot.agent.activeProviderId", "codex-cli.default"],
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
