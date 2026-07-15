import type { Root } from "react-dom/client";
import { l10nAttributes } from "./localization";
import type { PreferencesAppProps } from "./ui/PreferencesApp";

export { initPreferencesPane };
export { createPreferenceMountTargets };
export type { PreferencePaneDependencies, PreferencePaneRenderApp };

declare const document: PreferencePaneDocument | undefined;

type PreferencePaneDependencies = {
  document: PreferencePaneDocument;
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  cancelSchedule?(handle: ReturnType<typeof setTimeout>): void;
  renderApp?: PreferencePaneRenderApp;
};

type PreferencePaneRenderApp = {
  (root: HTMLElement, props: PreferencesAppProps): void;
  destroy?: () => void;
};

type PreferencePaneDocument = {
  defaultView?: Window | null;
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
  let destroyed = false;
  let pendingInit: ReturnType<typeof setTimeout> | undefined;
  let activeRenderer: PreferencePaneRenderApp | undefined;

  const onPageHide = () => {
    destroyed = true;
    if (pendingInit !== undefined) {
      dependencies.cancelSchedule?.(pendingInit);
      pendingInit = undefined;
    }
    activeRenderer?.destroy?.();
    dependencies.document.defaultView?.removeEventListener(
      "pagehide",
      onPageHide,
    );
  };
  dependencies.document.defaultView?.addEventListener("pagehide", onPageHide, {
    once: true,
  });

  scheduleInit();

  function scheduleInit(): void {
    if (destroyed) return;
    pendingInit = dependencies.schedule(initWhenReady, 0);
  }

  function initWhenReady(): void {
    pendingInit = undefined;
    if (initialized || destroyed) {
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
    const render =
      dependencies.renderApp || mountReactPreferencesApp(dependencies);
    activeRenderer = render;
    render(root, {
      translate,
    });
  }
}

function mountReactPreferencesApp(
  dependencies: PreferencePaneDependencies,
): PreferencePaneRenderApp {
  let reactRoot: Root | undefined;
  let portalRoot: HTMLElement | undefined;
  let destroyed = false;
  const render: PreferencePaneRenderApp = (root, props) => {
    void (async () => {
      try {
        const [
          { createElement },
          { createRoot },
          { PreferencesApp },
          { ZopilotUIProvider },
        ] = await Promise.all([
          import("react"),
          import("react-dom/client"),
          import("./ui/PreferencesApp"),
          import("../../ui/primitives/index"),
        ]);
        if (destroyed) return;
        if (!reactRoot) {
          const targets = createPreferenceMountTargets(root);
          const mountNode = targets.mountNode;
          portalRoot = targets.portalRoot;
          reactRoot = createRoot(mountNode);
        }
        reactRoot.render(
          createElement(ZopilotUIProvider, {
            children: createElement(PreferencesApp, props),
            portalRoot,
          }),
        );
      } catch (error) {
        if (!destroyed) renderMountError(root, error, dependencies);
      }
    })();
  };
  render.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    reactRoot?.unmount();
    reactRoot = undefined;
    portalRoot?.remove();
    portalRoot = undefined;
  };
  return render;
}

function createPreferenceMountTargets(root: HTMLElement): {
  mountNode: HTMLElement;
  portalRoot: HTMLElement;
} {
  const ownerDocument = root.ownerDocument;
  if (!ownerDocument) {
    throw new Error("Preference pane has no owner document.");
  }
  const mountNode = ownerDocument.createElement("div");
  const portalRoot = ownerDocument.createElement("div");
  mountNode.className = "zp-pref-react-root";
  portalRoot.className = "zp-pref-portal-root";
  root.replaceChildren(mountNode, portalRoot);
  return { mountNode, portalRoot };
}

function renderMountError(
  root: HTMLElement,
  error: unknown,
  dependencies: PreferencePaneDependencies,
): void {
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
  const errorMessage = error instanceof Error ? error.message : String(error);
  const attributes = l10nAttributes("pref-mount-error", {
    message: errorMessage,
  });
  for (const [name, value] of Object.entries(attributes)) {
    if (value) {
      message.setAttribute(name, value);
    }
  }
  message.textContent = `Zopilot preferences failed to load: ${errorMessage}`;
  root.append(message);
  void dependencies.document.l10n
    ?.translateElements?.([message])
    ?.catch(() => undefined);
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
    cancelSchedule(handle) {
      clearTimeout(handle);
    },
  };
}

if (typeof document !== "undefined") {
  initPreferencesPane();
}
