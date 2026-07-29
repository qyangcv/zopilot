import { assert } from "chai";
import { ProviderProfileStore } from "../../../src/application/providers/ProviderProfileService.ts";

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

  it("updates and deletes BYOK profiles", function () {
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

  it("clears a stale BYOK diagnostic after the provider recovers", function () {
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      providerId: "deepseek",
      apiKey: "secret-a",
      baseURL: "https://api.deepseek.com",
      models: [{ id: "deepseek-chat", displayName: "DeepSeek Chat" }],
    });

    store.updateProvider(profile.id, {
      status: "disconnected",
      lastDiagnostic: {
        code: "provider_timeout",
        message: "Provider request timed out.",
      },
    });
    assert.equal(
      store.getProfile(profile.id)?.lastDiagnostic?.code,
      "provider_timeout",
    );

    store.updateProvider(profile.id, {
      status: "connected",
      lastDiagnostic: undefined,
    });
    assert.isUndefined(store.getProfile(profile.id)?.lastDiagnostic);
  });

  it("keeps configured Codex models when the live catalog adds models", function () {
    const store = new ProviderProfileStore();
    store.updateCodexProvider({
      status: "connected",
      models: [
        { id: "gpt-a", displayName: "GPT A" },
        { id: "gpt-b", displayName: "GPT B" },
      ],
    });

    store.updateCodexProvider({
      status: "connected",
      models: [
        { id: "gpt-a", displayName: "GPT A renamed" },
        { id: "gpt-b", displayName: "GPT B" },
        { id: "gpt-new", displayName: "GPT New" },
      ],
    });

    const models = store.getSnapshot().profiles[0].models;
    assert.deepEqual(
      models.map((model) => model.id),
      ["gpt-a", "gpt-b"],
    );
    assert.equal(models[0]?.displayName, "GPT A renamed");
  });

  it("replaces configured Codex models and updates the saved selection", function () {
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
      store.replaceProviderModels("codex-cli.default", [
        { id: "gpt-b", displayName: "GPT B" },
      ]),
    );
    const profile = store.getSnapshot().profiles[0];
    assert.deepEqual(
      profile.models.map((model) => model.id),
      ["gpt-b"],
    );
    assert.equal(profile.defaultModel, "gpt-b");
    assert.deepEqual(
      JSON.parse(
        String(
          prefs.values.get("extensions.zotero.zopilot.agent.selectedModels"),
        ),
      ),
      { "codex-cli.default": "gpt-b" },
    );
    assert.isFalse(store.replaceProviderModels("codex-cli.default", []));
  });

  it("synchronizes Codex model replacements through Zotero prefs when queueMicrotask is unavailable", async function () {
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

      const snapshots: string[][] = [];
      const unsubscribe = consumer.subscribe((snapshot) => {
        snapshots.push(snapshot.profiles[0].models.map((model) => model.id));
      });

      assert.isTrue(
        source.replaceProviderModels("codex-cli.default", [
          { id: "gpt-b", displayName: "GPT B" },
        ]),
      );
      await Promise.resolve();
      assert.deepEqual(snapshots.at(-1), ["gpt-b"]);

      assert.isTrue(
        source.replaceProviderModels("codex-cli.default", [
          { id: "gpt-a", displayName: "GPT A" },
          { id: "gpt-b", displayName: "GPT B" },
        ]),
      );
      await Promise.resolve();
      assert.deepEqual(snapshots.at(-1), ["gpt-a", "gpt-b"]);

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

  it("refreshes configured BYOK models without persisting the full catalog", function () {
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
    assert.lengthOf(models, 1);
    assert.equal(models[0]?.id, "deepseek-chat");
    assert.isTrue(models[0]?.visible !== false);
  });

  it("replaces models on an existing BYOK profile and repairs its selection", function () {
    const prefs = installZoteroPrefsMock();
    const store = new ProviderProfileStore();
    const profile = store.createProvider({
      providerId: "openrouter",
      apiKey: "secret-a",
      models: [
        { id: "model-a", displayName: "Model A" },
        { id: "model-b", displayName: "Model B" },
      ],
    });
    Zotero.Prefs.set(
      "extensions.zotero.zopilot.agent.selectedModels",
      JSON.stringify({ [profile.id]: "model-a" }),
      true,
    );

    assert.isTrue(
      store.replaceProviderModels(profile.id, [
        { id: "model-b", displayName: "Model B" },
        { id: "model-c", displayName: "Model C" },
      ]),
    );

    assert.deepEqual(
      store.getProfile(profile.id)?.models.map((model) => model.id),
      ["model-b", "model-c"],
    );
    assert.deepEqual(
      JSON.parse(
        String(
          prefs.values.get("extensions.zotero.zopilot.agent.selectedModels"),
        ),
      ),
      { [profile.id]: "model-b" },
    );
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
