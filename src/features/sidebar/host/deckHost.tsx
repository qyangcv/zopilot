import type { SidebarActions, SidebarState } from "../ui/types";
import { installChromeWindowGlobals } from "./chromeGlobals";
import { HTML_NS, PORTAL_ROOT_ID } from "./constants";

export { createZopilotDeckHost };
export type { ZopilotDeckHost };

type ZopilotDeckHost = {
  attach: (panel: HTMLElement) => void;
  isAttachedTo: (panel: HTMLElement) => boolean;
  render: (state: SidebarState, actions: SidebarActions) => void;
  focus: () => void;
  refreshContext: () => void;
  destroy: () => void;
};

async function createZopilotDeckHost(
  panel: HTMLElement,
): Promise<ZopilotDeckHost> {
  const doc = panel.ownerDocument;
  if (!doc) {
    throw new Error("Zopilot deck panel has no owner document");
  }
  const overlayHost = doc.documentElement;
  if (!overlayHost) {
    throw new Error("Zopilot deck document has no root element");
  }
  const mountNode = doc.createElementNS(HTML_NS, "div") as HTMLElement;
  const portalRoot = doc.createElementNS(HTML_NS, "div") as HTMLElement;
  mountNode.className = "zp-react-root zp-root";
  portalRoot.id = PORTAL_ROOT_ID;
  portalRoot.className = "zp-portal-root";
  panel.replaceChildren(mountNode);
  overlayHost.append(portalRoot);
  syncPortalTheme(panel, portalRoot);

  const installGlobals = () => installChromeWindowGlobals(mountNode);
  installGlobals();
  const [{ createRoot }, { SidebarApp }] = await Promise.all([
    import("react-dom/client"),
    import("../ui/SidebarApp"),
  ]);
  const { ZopilotUIProvider } = await import("../../../ui/primitives/index");
  installGlobals();
  const root = createRoot(mountNode);
  let currentPanel = panel;

  return {
    attach(nextPanel) {
      if (mountNode.parentElement === nextPanel) return;
      nextPanel.replaceChildren(mountNode);
      currentPanel = nextPanel;
      if (!portalRoot.isConnected) overlayHost.append(portalRoot);
      syncPortalTheme(currentPanel, portalRoot);
      installGlobals();
    },
    isAttachedTo(panel) {
      return mountNode.parentElement === panel && mountNode.isConnected;
    },
    render(state, actions) {
      installGlobals();
      syncPortalTheme(currentPanel, portalRoot);
      root.render(
        <ZopilotUIProvider portalRoot={portalRoot}>
          <SidebarApp actions={actions} state={state} />
        </ZopilotUIProvider>,
      );
    },
    focus() {
      currentPanel.focus();
    },
    refreshContext() {
      currentPanel.toggleAttribute("data-zopilot-mounted", true);
    },
    destroy() {
      installGlobals();
      root.unmount();
      mountNode.remove();
      portalRoot.remove();
    },
  };
}

function syncPortalTheme(panel: HTMLElement, portalRoot: HTMLElement): void {
  const style = panel.ownerDocument?.defaultView?.getComputedStyle(panel);
  if (!style) return;
  for (const property of Array.from(style)) {
    if (property.startsWith("--zp-")) {
      portalRoot.style.setProperty(property, style.getPropertyValue(property));
    }
  }
}
