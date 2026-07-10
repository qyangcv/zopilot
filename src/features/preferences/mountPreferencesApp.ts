import type { Root } from "react-dom/client";
import { installChromeWindowGlobals } from "../sidebar/host/chromeGlobals";
import type { PreferencesAppProps } from "./ui/PreferencesApp";

export { initPreferencesPane };
export type { PreferencePaneDependencies, PreferencePaneRenderApp };

declare const document: PreferencePaneDocument | undefined;

type PreferencePaneDependencies = {
  document: PreferencePaneDocument;
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  renderApp?: PreferencePaneRenderApp;
};

type PreferencePaneRenderApp = (
  root: HTMLElement,
  props: PreferencesAppProps,
) => void;

type PreferencePaneDocument = {
  getElementById(id: string): HTMLElement | null;
  l10n?: {
    translateElements?(elements: Element[]): Promise<unknown>;
  };
};

const MAX_INIT_ATTEMPTS = 50;
const ROOT_ID = "zopilot-preferences-root";

function initPreferencesPane(dependencies = getGlobalDependencies()): void {
  let initAttempts = 0;
  let initialized = false;

  scheduleInit();

  function scheduleInit(): void {
    dependencies.schedule(initWhenReady, 0);
  }

  function initWhenReady(): void {
    if (initialized) {
      return;
    }

    const root = dependencies.document.getElementById(ROOT_ID);
    if (!root) {
      initAttempts += 1;
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        scheduleInit();
      }
      return;
    }

    initialized = true;
    const translate = () => translatePreferenceElements(root, dependencies);
    const render = dependencies.renderApp || mountReactPreferencesApp();
    render(root, {
      translate,
    });
  }
}

function mountReactPreferencesApp(): PreferencePaneRenderApp {
  let reactRoot: Root | undefined;
  return (root, props) => {
    void (async () => {
      try {
        installChromeWindowGlobals(root);
        const [{ createElement }, { createRoot }, { PreferencesApp }] =
          await Promise.all([
            import("react"),
            import("react-dom/client"),
            import("./ui/PreferencesApp"),
          ]);
        installChromeWindowGlobals(root);
        reactRoot ??= createRoot(root);
        reactRoot.render(createElement(PreferencesApp, props));
      } catch (error) {
        renderMountError(root, error);
      }
    })();
  };
}

function renderMountError(root: HTMLElement, error: unknown): void {
  root.textContent = "";
  const message = root.ownerDocument?.createElement("div");
  if (!message) {
    return;
  }
  message.style.border =
    "1px solid color-mix(in srgb, CanvasText 20%, transparent)";
  message.style.borderRadius = "8px";
  message.style.margin = "24px";
  message.style.padding = "16px";
  message.textContent = `Zopilot 偏好设置加载失败：${
    error instanceof Error ? error.message : String(error)
  }`;
  root.append(message);
}

function translatePreferenceElements(
  root: HTMLElement,
  dependencies: PreferencePaneDependencies,
): void {
  const elements = [
    root,
    ...Array.from(root.querySelectorAll("[data-l10n-id]")),
  ] as Element[];
  void dependencies.document.l10n
    ?.translateElements?.(elements)
    ?.catch(() => undefined);
}

function getGlobalDependencies(): PreferencePaneDependencies {
  if (!document) {
    throw new Error("偏好设置面板文档对象不可用。");
  }
  return {
    document,
    schedule(callback, delayMs) {
      return setTimeout(callback, delayMs);
    },
  };
}

if (typeof document !== "undefined") {
  initPreferencesPane();
}
