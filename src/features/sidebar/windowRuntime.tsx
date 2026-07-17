import { createRoot } from "react-dom/client";
import { configureLocaleFormatter } from "../../app/localization";
import { ZopilotUIProvider } from "../../ui/primitives/index";
import { SidebarApp } from "./ui/SidebarApp";
import { SidebarStreamSnapshotStore } from "./ui/SidebarStreamSnapshotStore";
import type { SidebarActions } from "./ui/types";
import { HTML_NS, PORTAL_ROOT_ID } from "./host/constants";
import { resolveSidebarPortalHost } from "./host/portalHost";
import {
  SIDEBAR_WINDOW_RUNTIME_KEY,
  type SidebarCommandDispatch,
  type SidebarWindowRuntime,
} from "./host/windowRuntimeTypes";

const runtime: SidebarWindowRuntime = {
  createHost(panel, dispatch) {
    const doc = panel.ownerDocument;
    if (!doc) throw new Error("Zopilot deck panel has no owner document");
    let overlayHost = resolveSidebarPortalHost(panel);

    removeDuplicateRoots(doc);
    const mountNode = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    const portalRoot = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    mountNode.className = "zp-react-root zp-root";
    mountNode.dataset.zopilotRoot = "sidebar";
    portalRoot.id = PORTAL_ROOT_ID;
    portalRoot.className = "zp-portal-root";
    panel.replaceChildren(mountNode);
    overlayHost.append(portalRoot);

    configureLocaleFormatter((id, options) =>
      String(dispatch({ type: "localize", args: [id, options] })),
    );
    const actions = createCommandActions(dispatch);
    const root = createRoot(mountNode);
    const streamStore = new SidebarStreamSnapshotStore();
    let currentPanel = panel;
    let destroyed = false;

    return {
      attach(nextPanel) {
        if (destroyed) return false;
        const nextOverlayHost = resolveSidebarPortalHost(nextPanel);
        const mountChanged =
          mountNode.parentElement !== nextPanel || !mountNode.isConnected;
        const portalChanged =
          portalRoot.parentElement !== nextOverlayHost ||
          !portalRoot.isConnected;
        if (mountChanged) nextPanel.replaceChildren(mountNode);
        if (portalChanged) nextOverlayHost.append(portalRoot);
        currentPanel = nextPanel;
        overlayHost = nextOverlayHost;
        return mountChanged || portalChanged;
      },
      render(state) {
        if (destroyed) return;
        root.render(
          <ZopilotUIProvider portalRoot={portalRoot}>
            <SidebarApp
              actions={actions}
              state={state}
              streamStore={streamStore}
            />
          </ZopilotUIProvider>,
        );
      },
      publishStreaming(snapshot) {
        if (destroyed) return;
        streamStore.publish(snapshot);
      },
      isAttachedTo(nextPanel) {
        return (
          !destroyed &&
          currentPanel === nextPanel &&
          mountNode.parentElement === nextPanel &&
          mountNode.isConnected &&
          overlayHost.isConnected &&
          overlayHost.contains(nextPanel) &&
          portalRoot.parentElement === overlayHost &&
          portalRoot.isConnected
        );
      },
      focus() {
        (currentPanel as Element & { focus?: () => void }).focus?.();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        streamStore.clear();
        root.unmount();
        mountNode.remove();
        portalRoot.remove();
        configureLocaleFormatter(undefined);
      },
    };
  },
};

function createCommandActions(
  dispatch: SidebarCommandDispatch,
): SidebarActions {
  const invoke = (type: keyof SidebarActions, args: unknown[] = []) =>
    dispatch({ type, args } as Parameters<SidebarCommandDispatch>[0]);
  return {
    archiveSession: (conversation) =>
      void invoke("archiveSession", [conversation]),
    close: () => void invoke("close"),
    createNewSession: () => void invoke("createNewSession"),
    getItemContextTree: (source) =>
      invoke("getItemContextTree", [source]) as ReturnType<
        SidebarActions["getItemContextTree"]
      >,
    hideSessions: () => void invoke("hideSessions"),
    interruptActiveTurn: () => void invoke("interruptActiveTurn"),
    openExternalLink: (url) => void invoke("openExternalLink", [url]),
    restoreSession: (conversation) =>
      void invoke("restoreSession", [conversation]),
    selectCollectionWorkspace: (key) =>
      void invoke("selectCollectionWorkspace", [key]),
    selectItemWorkspace: (sourceId) =>
      void invoke("selectItemWorkspace", [sourceId]),
    selectModel: (model) => void invoke("selectModel", [model]),
    selectModelEffort: (model, effort) =>
      void invoke("selectModelEffort", [model, effort]),
    selectWorkspaceMode: (type) => void invoke("selectWorkspaceMode", [type]),
    updateActiveNoteContexts: (noteContexts) =>
      void invoke("updateActiveNoteContexts", [noteContexts]),
    submitPrompt: (submission) => void invoke("submitPrompt", [submission]),
    switchSession: (conversation) =>
      void invoke("switchSession", [conversation]),
    toggleArchivedSessions: () => void invoke("toggleArchivedSessions"),
    toggleSessions: () => void invoke("toggleSessions"),
    uploadAttachment: () =>
      invoke("uploadAttachment") as Promise<
        ReturnType<SidebarActions["uploadAttachment"]> extends Promise<
          infer Value
        >
          ? Value
          : never
      >,
  };
}

function removeDuplicateRoots(doc: Document): void {
  const roots = Array.prototype.slice.call(
    doc.querySelectorAll('[data-zopilot-root="sidebar"], #zopilot-portal-root'),
  ) as Element[];
  roots.forEach((root) => root.remove());
}

(globalThis as typeof globalThis & Record<string, unknown>)[
  SIDEBAR_WINDOW_RUNTIME_KEY
] = runtime;
