import { assert } from "chai";
import {
  ProviderProfileStore,
  mergeDiscoveredModels,
} from "../../../src/application/providers/ProviderProfileService.ts";

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
    assert.deepEqual(snapshot.profiles[0].models, []);
    assert.isUndefined(snapshot.profiles[0].defaultModel);
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

  it("derives the Codex default from the live catalog, not the removed legacy preference", function () {
    const store = new ProviderProfileStore();

    Zotero.Prefs.set("extensions.zotero.zopilot.codex.model", "gpt-5.5", true);
    store.updateCodexProvider({
      status: "connected",
      models: [
        { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
        { id: "gpt-5.5", displayName: "GPT-5.5" },
      ],
    });

    assert.equal(store.getSnapshot().profiles[0].defaultModel, "gpt-5.6-sol");
  });

  it("creates BYOK profiles while keeping API keys out of snapshots", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      providerId: "deepseek",
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
      providerId: "minimax",
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
      providerId: "deepseek",
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
    assert.equal(store.getProfile(profile.id)?.apiKey, "secret-a");
  });

  it("keeps model visibility while applying provider-specific discovery defaults", function () {
    const current = [
      { id: "stable", displayName: "Stable" },
      { id: "existing", displayName: "Existing", visible: false },
    ];
    const discovered = [
      { id: "stable", displayName: "Stable renamed" },
      { id: "existing", displayName: "Existing renamed" },
      { id: "new", displayName: "New" },
    ];

    assert.deepEqual(
      mergeDiscoveredModels(current, discovered, true).map((model) => ({
        id: model.id,
        visible: model.visible !== false,
      })),
      [
        { id: "stable", visible: true },
        { id: "existing", visible: false },
        { id: "new", visible: true },
      ],
    );
    assert.deepEqual(
      mergeDiscoveredModels(current, discovered, false).map((model) => ({
        id: model.id,
        visible: model.visible !== false,
      })),
      [
        { id: "stable", visible: true },
        { id: "existing", visible: false },
        { id: "new", visible: false },
      ],
    );
    assert.isTrue(
      mergeDiscoveredModels(
        [{ id: "removed", displayName: "Removed" }],
        [{ id: "replacement", displayName: "Replacement" }],
        false,
      )[0]?.visible !== false,
    );
  });

  it("hides models, preserves one visible model, and updates the saved selection", function () {
    const prefs = installZoteroPrefsMock();
    const store = new ProviderProfileStore();
    store.updateCodexProvider({
      status: "connected",
      models: [
        { id: "gpt-a", displayName: "GPT A" },
        { id: "gpt-b", displayName: "GPT B" },
      ],
    });
    Zotero.Prefs.set(
      "extensions.zotero.zopilot.agent.selectedModels",
      JSON.stringify({ "codex-cli.default": "gpt-a" }),
      true,
    );

    assert.isTrue(
      store.setModelVisibility("codex-cli.default", "gpt-a", false),
    );
    const profile = store.getSnapshot().profiles[0];
    assert.isFalse(profile.models[0]?.visible);
    assert.equal(profile.defaultModel, "gpt-b");
    assert.deepEqual(
      JSON.parse(
        String(
          prefs.values.get("extensions.zotero.zopilot.agent.selectedModels"),
        ),
      ),
      { "codex-cli.default": "gpt-b" },
    );
    assert.isFalse(
      store.setModelVisibility("codex-cli.default", "gpt-b", false),
    );
    assert.equal(
      store
        .getSnapshot()
        .profiles[0].models.filter((model) => model.visible !== false).length,
      1,
    );
  });

  it("synchronizes model visibility through Zotero prefs when queueMicrotask is unavailable", async function () {
    const prefs = installZoteroPrefsMock();
    const source = new ProviderProfileStore();
    const consumer = new ProviderProfileStore();
    const originalQueueMicrotask = globalThis.queueMicrotask;
    Object.defineProperty(globalThis, "queueMicrotask", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      source.updateCodexProvider({
        status: "connected",
        models: [
          { id: "gpt-a", displayName: "GPT A" },
          { id: "gpt-b", displayName: "GPT B" },
        ],
      });

      const snapshots: boolean[][] = [];
      const unsubscribe = consumer.subscribe((snapshot) => {
        snapshots.push(
          snapshot.profiles[0].models.map((model) => model.visible !== false),
        );
      });

      assert.isTrue(
        source.setModelVisibility("codex-cli.default", "gpt-a", false),
      );
      await Promise.resolve();
      assert.deepEqual(snapshots.at(-1), [false, true]);

      assert.isTrue(
        source.setModelVisibility("codex-cli.default", "gpt-a", true),
      );
      await Promise.resolve();
      assert.deepEqual(snapshots.at(-1), [true, true]);

      unsubscribe();
    } finally {
      source.dispose();
      consumer.dispose();
      Object.defineProperty(globalThis, "queueMicrotask", {
        configurable: true,
        value: originalQueueMicrotask,
        writable: true,
      });
    }

    assert.lengthOf(prefs.registrations, 4);
  });

  it("keeps newly discovered BYOK models hidden", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      providerId: "deepseek",
      apiKey: "secret-a",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-chat", displayName: "DeepSeek Chat" }],
    });

    store.updateProviderFromDiscovery(profile.id, {
      status: "connected",
      models: [
        { id: "deepseek-chat", displayName: "DeepSeek Chat" },
        { id: "deepseek-reasoner", displayName: "DeepSeek Reasoner" },
      ],
    });

    const models = store.getProfile(profile.id)?.models || [];
    assert.isTrue(models[0]?.visible !== false);
    assert.isFalse(models[1]?.visible);
  });

  it("uses global pref branches, coalesces writes, and unregisters the final subscription", async function () {
    const prefs = installZoteroPrefsMock();
    const store = new ProviderProfileStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.updateCodexProvider({
      status: "connected",
      models: [{ id: "gpt-test", displayName: "GPT Test" }],
    });
    await Promise.resolve();

    assert.equal(notifications, 2);
    assert.lengthOf(prefs.registrations, 4);
    assert.isTrue(prefs.registrations.every((item) => item.global === true));
    assert.isTrue(
      prefs.registrations.every((item) =>
        item.key.startsWith("extensions.zotero.zopilot."),
      ),
    );

    unsubscribe();
    assert.lengthOf(prefs.unregistered, 4);
  });
});

function installZoteroPrefsMock(): {
  registrations: Array<{ key: string; global: boolean; token: symbol }>;
  unregistered: symbol[];
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>([
    ["extensions.zotero.zopilot.codex.model", "gpt-5.5"],
    ["extensions.zotero.zopilot.agent.activeProviderId", "codex-cli.default"],
    ["extensions.zotero.zopilot.agent.codexProviderStatus", "{}"],
    ["extensions.zotero.zopilot.agent.providerProfiles", "[]"],
    ["extensions.zotero.zopilot.agent.providerSecrets", "{}"],
    ["extensions.zotero.zopilot.agent.selectedModels", "{}"],
  ]);
  const registrations: Array<{
    key: string;
    global: boolean;
    token: symbol;
    callback: () => void;
  }> = [];
  const unregistered: symbol[] = [];
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Prefs: {
          get: (key: string) => unknown;
          set: (key: string, value: unknown) => void;
          registerObserver: (
            key: string,
            callback: () => void,
            global?: boolean,
          ) => symbol;
          unregisterObserver: (token: symbol) => void;
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
        registrations
          .filter((registration) => registration.key === key)
          .forEach((registration) => registration.callback());
      },
      registerObserver(key, callback, global = false) {
        const token = Symbol(key);
        registrations.push({ key, callback, global, token });
        return token;
      },
      unregisterObserver(token) {
        unregistered.push(token);
      },
    },
  };
  return { registrations, unregistered, values };
}
