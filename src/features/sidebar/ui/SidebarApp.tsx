import { useRef, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { copyText } from "./clipboard";
import { Composer, ComposerPromptPicker } from "./Composer";
import { ConversationLog } from "./ConversationLog";
import {
  DETACHED_WINDOW_NAVIGATION_ID,
  DetachedWindowNavigation,
} from "./DetachedWindowNavigation";
import { DetachedWindowNavigationResizer } from "./DetachedWindowNavigationResizer";
import { DetachedWindowPlaceholder } from "./DetachedWindowPlaceholder";
import { DetachedWindowTooltipLayer } from "./DetachedWindowTooltipLayer";
import { Icon } from "./Icon";
import { SidebarHeader } from "./SidebarHeader";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useComposerDraft } from "./hooks/useComposerDraft";
import { useSidebarLayoutBounds } from "./hooks/useSidebarLayoutBounds";
import type {
  SidebarActions,
  SidebarMessageView,
  SidebarPresentation,
  SidebarState,
} from "./types";
import { SidebarStreamSnapshotStore } from "./SidebarStreamSnapshotStore";

const emptyStreamStore = new SidebarStreamSnapshotStore();

export function SidebarApp({
  actions,
  presentation = "sidebar",
  state,
  streamStore,
}: {
  actions: SidebarActions;
  presentation?: SidebarPresentation;
  state: SidebarState;
  streamStore?: SidebarStreamSnapshotStore;
}): ReactElement {
  if (presentation === "sidebar" && state.detachedWindowOpen) {
    return <DetachedWindowPlaceholder actions={actions} />;
  }
  return (
    <InteractiveSidebarApp
      actions={actions}
      presentation={presentation}
      state={state}
      streamStore={streamStore}
    />
  );
}

function InteractiveSidebarApp({
  actions,
  presentation,
  state,
  streamStore,
}: {
  actions: SidebarActions;
  presentation: SidebarPresentation;
  state: SidebarState;
  streamStore?: SidebarStreamSnapshotStore;
}): ReactElement {
  streamStore ||= emptyStreamStore;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detachedNavigationExpanded, setDetachedNavigationExpanded] =
    useState(true);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const composer = useComposerDraft(actions, state);
  const lastUserMessageId = state.messages.findLast(
    (message) => message.role === "user",
  )?.id;
  const autoScroll = useAutoScroll(
    `${state.conversationId || ""}:${lastUserMessageId || ""}`,
    state.messages,
  );
  useSidebarLayoutBounds(headerRef, composer.bindings.bottomDockRef);
  const navigationToggleLabel = getString(
    detachedNavigationExpanded
      ? "sidebar-collapse-window-navigation"
      : "sidebar-expand-window-navigation",
  );

  const copyMessage = (message: SidebarMessageView) => {
    void copyText(message.text).then(() => {
      setCopiedId(`${message.id}-text`);
      globalThis.setTimeout(() => setCopiedId(null), 900);
    });
  };

  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zp-sidebar"
      data-navigation-expanded={
        presentation === "window" ? detachedNavigationExpanded : undefined
      }
      data-presentation={presentation}
      ref={sidebarRef}
      role={presentation === "window" ? "main" : "complementary"}
    >
      {presentation === "sidebar" ? (
        <SidebarHeader
          actions={actions}
          archiveButtonRef={archiveButtonRef}
          headerRef={headerRef}
          historyButtonRef={historyButtonRef}
          onReload={() =>
            actions.reloadPlugin({
              workspaceKey: state.context.workspaceKey,
              conversationId: state.conversationId,
              hostContextKind: state.context.hostContextKind,
            })
          }
          state={state}
        />
      ) : null}
      {presentation === "window" ? (
        <div
          aria-label={getString("sidebar-window-controls")}
          className="zp-detached-toolbar"
          role="toolbar"
        >
          <button
            aria-controls={DETACHED_WINDOW_NAVIGATION_ID}
            aria-expanded={detachedNavigationExpanded}
            aria-label={navigationToggleLabel}
            className="zp-icon-button zp-detached-navigation-button"
            data-zp-tooltip={navigationToggleLabel}
            onClick={() =>
              setDetachedNavigationExpanded((expanded) => !expanded)
            }
            title={navigationToggleLabel}
            type="button"
          >
            <Icon
              name={
                detachedNavigationExpanded
                  ? "navigationCollapse"
                  : "navigationExpand"
              }
            />
          </button>
          <button
            aria-label={getString("sidebar-restore-to-sidebar")}
            className="zp-icon-button zp-detached-restore-button"
            data-zp-tooltip={getString("sidebar-restore-to-sidebar")}
            onClick={actions.restoreToSidebar}
            title={getString("sidebar-restore-to-sidebar")}
            type="button"
          >
            <Icon className="zp-restore-sidebar-icon" name="openInWindow" />
          </button>
        </div>
      ) : null}
      {presentation === "window" ? (
        <DetachedWindowNavigation
          actions={actions}
          expanded={detachedNavigationExpanded}
          state={state}
        />
      ) : null}
      {presentation === "window" ? (
        <DetachedWindowNavigationResizer
          expanded={detachedNavigationExpanded}
          rootRef={sidebarRef}
        />
      ) : null}
      <ComposerPromptPicker bindings={composer.bindings} state={state} />
      <ConversationLog
        actions={actions}
        copiedId={copiedId}
        logRef={autoScroll.logRef}
        onCopy={copyMessage}
        onEdit={composer.restoreDraft}
        onScroll={(event) => autoScroll.onScroll(event.currentTarget)}
        onSubmit={composer.submit}
        state={state}
        streamStore={streamStore}
        syncStreamingScroll={autoScroll.sync}
      />
      <Composer
        actions={actions}
        bindings={composer.bindings}
        headerBoundaryRef={headerRef}
        state={state}
      />
      {presentation === "window" ? (
        <DetachedWindowTooltipLayer rootRef={sidebarRef} />
      ) : null}
    </aside>
  );
}
