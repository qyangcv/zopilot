import type { SidebarActions, SidebarState } from "./types";

export { createSidebarReactHost };
export type { SidebarReactHost };

type SidebarReactHost = {
  render: (state: SidebarState, actions: SidebarActions) => void;
  unmount: () => void;
};

async function createSidebarReactHost(
  mountNode: HTMLElement,
): Promise<SidebarReactHost> {
  const installGlobals = () => installReactDomGlobals(mountNode);
  installGlobals();
  const [{ createRoot }, { SidebarApp }] = await Promise.all([
    import("react-dom/client"),
    import("./SidebarApp"),
  ]);
  installGlobals();
  const root = createRoot(mountNode);
  return {
    render(state, actions) {
      installGlobals();
      root.render(<SidebarApp actions={actions} state={state} />);
    },
    unmount() {
      installGlobals();
      root.unmount();
    },
  };
}

function installReactDomGlobals(mountNode: HTMLElement): void {
  const win = mountNode.ownerDocument?.defaultView;
  if (!win) {
    return;
  }

  // Zotero loads plugin code in a bootstrap sandbox, while React DOM expects
  // browser globals when scheduling updates and handling events.
  const root = globalThis as Record<string, unknown>;
  root.window = win;
  root.self = win;
  root.document = win.document;
  root.navigator = win.navigator;
  root.Node = win.Node;
  root.Element = win.Element;
  root.HTMLElement = win.HTMLElement;
  root.HTMLIFrameElement = win.HTMLIFrameElement;
  root.Event = win.Event;
  root.EventTarget = win.EventTarget;
  root.MouseEvent = win.MouseEvent;
  root.KeyboardEvent = win.KeyboardEvent;
  root.PointerEvent = win.PointerEvent;
}
