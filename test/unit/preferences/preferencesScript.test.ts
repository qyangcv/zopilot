import { assert } from "chai";
import { initPreferencesPane } from "../../../src/modules/preferences/preferencesPane.ts";

describe("preferences pane script", function () {
  afterEach(function () {
    delete (globalThis as unknown as { IOUtils?: unknown }).IOUtils;
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("waits for the preference pane markup before initializing", function () {
    const timers: Array<() => void> = [];
    let statusElement: StatusElement | null = null;
    let l10nId = "";
    let subprocessRequested = false;

    initPreferencesPane({
      document: {
        getElementById(id: string) {
          return id === "zopilot-codex-status-value" ? statusElement : null;
        },
        l10n: {
          setAttributes(_element: StatusElement, id: string) {
            l10nId = id;
          },
          translateElements: async () => undefined,
        },
      },
      schedule: createQueuedScheduler(timers),
      getSubprocess() {
        subprocessRequested = true;
        throw new Error("Subprocess unavailable in this test");
      },
    });

    assert.lengthOf(timers, 1);

    timers.shift()?.();
    assert.lengthOf(timers, 1);
    assert.isFalse(subprocessRequested);

    statusElement = { dataset: {}, textContent: "stale" };
    timers.shift()?.();

    assert.isTrue(subprocessRequested);
    assert.equal(statusElement.dataset.status, "missing");
    assert.equal(statusElement.textContent, "");
    assert.equal(l10nId, "zopilot-codex-diagnostic-unknown-error");
  });

  it("runs Codex status checks with a GUI-safe PATH", async function () {
    const calls: SubprocessCall[] = [];
    const statusElement: StatusElement = { dataset: {}, textContent: "stale" };
    installIoMock(
      (path) =>
        path === "/bin/zsh" ||
        path === "/Users/test/.nvm/versions/node/v22.12.0/bin/codex",
    );

    initPreferencesPane({
      document: createDocument(statusElement),
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      getSubprocess: () => createSubprocess(calls, "Logged in"),
    });

    await waitFor(() => calls.length === 3);

    const codexCalls = calls.filter((call) => call.command?.endsWith("/codex"));
    assert.deepEqual(codexCalls[0].arguments, ["app-server", "--help"]);
    assert.deepEqual(codexCalls[1].arguments, ["login", "status"]);
    assert.equal(
      codexCalls[0].command,
      "/Users/test/.nvm/versions/node/v22.12.0/bin/codex",
    );
    assert.equal(
      codexCalls[0].environment?.PATH,
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/test/.local/bin:/Users/test/.npm-global/bin:/Users/test/.bun/bin:/Users/test/.volta/bin:/Users/test/.local/share/mise/shims:/Users/test/.nvm/current/bin:/Users/test/.nvm/versions/node/v22.12.0/bin:/custom/bin",
    );
    assert.equal(statusElement.dataset.status, "connected");
  });

  it("shows missing when app-server is unavailable", async function () {
    const calls: SubprocessCall[] = [];
    const statusElement: StatusElement = { dataset: {}, textContent: "stale" };
    const l10nIds: string[] = [];
    installIoMock((path) => path === "/usr/local/bin/codex");

    initPreferencesPane({
      document: createDocument(statusElement, l10nIds),
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      getSubprocess: () =>
        createSubprocess(calls, "Logged in", { appServerExitCode: 1 }),
    });

    await waitFor(
      () =>
        calls.filter((call) => call.command?.endsWith("/codex")).length === 2,
    );

    assert.equal(statusElement.dataset.status, "missing");
    assert.equal(
      l10nIds.at(-1),
      "zopilot-codex-diagnostic-app-server-unavailable",
    );
  });

  it("shows missing when Codex is not logged in", async function () {
    const calls: SubprocessCall[] = [];
    const statusElement: StatusElement = { dataset: {}, textContent: "stale" };
    const l10nIds: string[] = [];
    installIoMock((path) => path === "/usr/local/bin/codex");

    initPreferencesPane({
      document: createDocument(statusElement, l10nIds),
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      getSubprocess: () => createSubprocess(calls, "Not logged in"),
    });

    await waitFor(() => calls.length === 4);

    assert.equal(statusElement.dataset.status, "missing");
    assert.equal(l10nIds.at(-1), "zopilot-codex-diagnostic-not-logged-in");
  });

  it("shows the CLI not found diagnostic", async function () {
    const calls: SubprocessCall[] = [];
    const statusElement: StatusElement = { dataset: {}, textContent: "stale" };
    const l10nIds: string[] = [];
    installIoMock(() => false);

    initPreferencesPane({
      document: createDocument(statusElement, l10nIds),
      schedule: (callback, delayMs) => setTimeout(callback, delayMs),
      getSubprocess: () => createSubprocess(calls, "Logged in"),
    });

    await waitFor(
      () => l10nIds.at(-1) === "zopilot-codex-diagnostic-cli-not-found",
    );

    assert.equal(statusElement.dataset.status, "missing");
    assert.isEmpty(calls);
  });

  it("creates, edits, and deletes custom prompts in preferences", function () {
    const timers: Array<() => void> = [];
    const statusElement = createElement("span");
    const document = createPromptDocument(statusElement);
    const promptPrefs = installPromptPrefMock();

    initPreferencesPane({
      document,
      schedule: createQueuedScheduler(timers),
      getSubprocess() {
        throw new Error("Subprocess unavailable in this test");
      },
    });
    timers.shift()?.();

    document.elements.title.value = " Evidence table ";
    document.elements.body.value = "Make a table for {{paper}}.";
    document.elements.form.dispatch("submit");

    let prompts = promptPrefs.read();
    assert.lengthOf(prompts, 1);
    assert.equal(prompts[0].title, "Evidence table");
    assert.deepEqual(prompts[0].variables, ["paper"]);

    document.elements.title.value = "Method audit";
    document.elements.body.value = "Check {{method}}.";
    document.elements.form.dispatch("submit");

    prompts = promptPrefs.read();
    assert.lengthOf(prompts, 1);
    assert.equal(prompts[0].title, "Method audit");
    assert.deepEqual(prompts[0].variables, ["method"]);

    document.elements.deleteButton.dispatch("click");
    assert.deepEqual(promptPrefs.read(), []);
  });
});

type StatusElement = {
  addEventListener?: (
    type: string,
    listener: (event: { preventDefault(): void }) => void,
  ) => void;
  append?: (...nodes: StatusElement[]) => void;
  className?: string;
  dataset: Record<string, string>;
  disabled?: boolean;
  dispatch?: (type: string) => void;
  replaceChildren?: (...nodes: StatusElement[]) => void;
  setAttribute?: (name: string, value: string) => void;
  title?: string;
  textContent: string | null;
  value?: string;
};

type SubprocessCall = {
  command?: string;
  arguments?: string[];
  environment?: { PATH: string };
};

function createQueuedScheduler(timers: Array<() => void>) {
  return (callback: () => void) => {
    timers.push(() => callback());
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  };
}

function createDocument(statusElement: StatusElement, l10nIds: string[] = []) {
  return {
    createElement,
    getElementById(id: string) {
      return id === "zopilot-codex-status-value" ? statusElement : null;
    },
    l10n: {
      setAttributes: (_element: StatusElement, id: string) => {
        l10nIds.push(id);
      },
      translateElements: async () => undefined,
    },
  };
}

function createPromptDocument(statusElement: StatusElement) {
  const elements = {
    body: createElement("textarea"),
    deleteButton: createElement("button"),
    error: createElement("div"),
    form: createElement("form"),
    list: createElement("div"),
    newButton: createElement("button"),
    status: statusElement,
    title: createElement("input"),
  };
  return {
    elements,
    createElement,
    getElementById(id: string) {
      return (
        {
          "zopilot-codex-status-value": elements.status,
          "zopilot-prompt-body": elements.body,
          "zopilot-prompt-delete": elements.deleteButton,
          "zopilot-prompt-error": elements.error,
          "zopilot-prompt-form": elements.form,
          "zopilot-prompt-list": elements.list,
          "zopilot-prompt-new": elements.newButton,
          "zopilot-prompt-title": elements.title,
        } satisfies Record<string, StatusElement>
      )[id];
    },
    l10n: {
      setAttributes: () => undefined,
      translateElements: async () => undefined,
    },
  };
}

function createElement(_tagName: string): StatusElement {
  const listeners = new Map<
    string,
    Array<(event: { preventDefault(): void }) => void>
  >();
  const element: StatusElement = {
    dataset: {},
    textContent: "",
    value: "",
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    append: () => undefined,
    dispatch(type) {
      for (const listener of listeners.get(type) || []) {
        listener({ preventDefault: () => undefined });
      }
    },
    replaceChildren: () => undefined,
    setAttribute: () => undefined,
  };
  return element;
}

function installPromptPrefMock() {
  let customPrompts = "[]";
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Prefs: {
          get: (key: string) => unknown;
          set: (key: string, value: unknown) => void;
        };
      };
    }
  ).Zotero = {
    Prefs: {
      get(key) {
        return key.endsWith("prompts.custom") ? customPrompts : undefined;
      },
      set(key, value) {
        if (key.endsWith("prompts.custom")) {
          customPrompts = String(value);
        }
      },
    },
  };
  return {
    read() {
      return JSON.parse(customPrompts) as Array<{
        title: string;
        variables: string[];
      }>;
    },
  };
}

function createSubprocess(
  calls: SubprocessCall[],
  loginStatusOutput: string,
  options: { appServerExitCode?: number } = {},
) {
  return {
    call: async (call: SubprocessCall) => {
      calls.push(call);
      let stdout = "";
      let exitCode = 0;
      if (call.command === "/bin/zsh") {
        stdout =
          "\n__ZOPILOT_PATH_START__/Users/test/.nvm/versions/node/v22.12.0/bin:/usr/bin__ZOPILOT_PATH_END__\n";
      } else if (call.arguments?.join(" ") === "app-server --help") {
        exitCode = options.appServerExitCode ?? 0;
      } else if (call.arguments?.join(" ") === "login status") {
        stdout = loginStatusOutput;
      }
      return createProcess(stdout, exitCode);
    },
    getEnvironment: () => ({
      HOME: "/Users/test",
      SHELL: "/bin/zsh",
      PATH: "/usr/bin:/custom/bin",
    }),
  };
}

function createProcess(stdout: string, exitCode: number) {
  let stdoutRead = false;
  return {
    kill: async () => ({ exitCode: 0 }),
    wait: async () => ({ exitCode }),
    stdout: {
      readString: async () => {
        if (stdoutRead) {
          return "";
        }
        stdoutRead = true;
        return stdout;
      },
    },
    stderr: {
      readString: async () => "",
    },
  };
}

function installIoMock(exists: (path: string) => boolean): void {
  (
    globalThis as unknown as { IOUtils: Pick<typeof IOUtils, "exists"> }
  ).IOUtils = {
    exists: async (path) => exists(path),
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
