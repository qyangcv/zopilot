import type { SidebarActions, SidebarState } from "../ui/types";
import { getString } from "../../../app/localization";
import {
  SIDEBAR_WINDOW_RUNTIME_KEY,
  type SidebarCommand,
  type SidebarWindowHost,
  type SidebarWindowRuntime,
} from "./windowRuntimeTypes";

export { createZopilotDeckHost };
export type { ZopilotDeckHost };

type ZopilotDeckHost = {
  attach: (panel: Element) => boolean;
  isAttachedTo: (panel: Element) => boolean;
  render: (state: SidebarState, actions: SidebarActions) => void;
  focus: () => void;
  destroy: () => void;
};

async function createZopilotDeckHost(panel: Element): Promise<ZopilotDeckHost> {
  const doc = panel.ownerDocument;
  if (!doc) {
    throw new Error("Zopilot deck panel has no owner document");
  }
  const win = doc.defaultView;
  if (!win) throw new Error("Zopilot deck document has no window");
  const runtime = loadWindowRuntime(win);
  let currentActions: SidebarActions | undefined;
  const dispatch = (command: SidebarCommand): unknown => {
    if (command.type === "localize") {
      return getString(command.args[0], command.args[1]);
    }
    const action = currentActions?.[command.type] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    return action?.(...command.args);
  };
  const host: SidebarWindowHost = runtime.createHost(panel, dispatch);

  return {
    attach: (nextPanel) => host.attach(nextPanel),
    isAttachedTo: (nextPanel) => host.isAttachedTo(nextPanel),
    render(state, actions) {
      currentActions = actions;
      host.render(state);
    },
    focus: () => host.focus(),
    destroy() {
      currentActions = undefined;
      host.destroy();
      if (
        (win as Window & Record<string, unknown>)[
          SIDEBAR_WINDOW_RUNTIME_KEY
        ] === runtime
      ) {
        delete (win as Window & Record<string, unknown>)[
          SIDEBAR_WINDOW_RUNTIME_KEY
        ];
      }
    },
  };
}

function loadWindowRuntime(win: Window): SidebarWindowRuntime {
  const runtimeWindow = win as Window & Record<string, unknown>;
  const existing = runtimeWindow[SIDEBAR_WINDOW_RUNTIME_KEY];
  if (isWindowRuntime(existing)) return existing;
  const uri = `${addon.data.rootURI || rootURI}content/scripts/sidebar-window.js`;
  Services.scriptloader.loadSubScript(uri, win);
  const loaded = runtimeWindow[SIDEBAR_WINDOW_RUNTIME_KEY];
  if (!isWindowRuntime(loaded)) {
    throw new Error("Zopilot sidebar window runtime failed to initialize");
  }
  return loaded;
}

function isWindowRuntime(value: unknown): value is SidebarWindowRuntime {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as SidebarWindowRuntime).createHost === "function",
  );
}
