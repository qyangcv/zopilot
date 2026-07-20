import type { ReactElement, RefObject } from "react";
import { getString } from "../../../app/localization";
import { FloatingPortal } from "../../../ui/primitives/index";
import { Icon } from "./Icon";
import { SessionPopover } from "./SessionPopover";
import type { SidebarActions, SidebarState } from "./types";

type SidebarHeaderProps = {
  actions: SidebarActions;
  archiveButtonRef: RefObject<HTMLButtonElement | null>;
  headerRef: RefObject<HTMLElement | null>;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
  onReload: () => Promise<void>;
  state: SidebarState;
};

function SidebarHeader({
  actions,
  archiveButtonRef,
  headerRef,
  historyButtonRef,
  onReload,
  state,
}: SidebarHeaderProps): ReactElement {
  const sessionAnchorRef =
    state.sessionsMode === "archive" ? archiveButtonRef : historyButtonRef;
  return (
    <>
      <header className="zp-sidebar-header" ref={headerRef}>
        <div className="zp-sidebar-identity" title={state.title}>
          <span className="zp-sidebar-title-block">
            <span className="zp-sidebar-title">
              {getString("sidebar-title")}
            </span>
          </span>
          <button
            aria-busy={state.reloading || undefined}
            aria-label={getString("sidebar-reload")}
            className="zp-icon-button zp-reload-button"
            disabled={state.reloading}
            onClick={(event) => {
              event.stopPropagation();
              void onReload();
            }}
            title={getString("sidebar-reload")}
            type="button"
          >
            <Icon
              className={state.reloading ? "zp-spin" : undefined}
              name="reload"
            />
          </button>
        </div>
        <div className="zp-sidebar-actions">
          <button
            aria-controls={
              state.sessionsOpen && state.sessionsMode === "history"
                ? "zp-session-list"
                : undefined
            }
            aria-expanded={
              state.sessionsOpen && state.sessionsMode === "history"
            }
            aria-haspopup="listbox"
            aria-label={getString("sidebar-history")}
            className="zp-icon-button zp-history-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleSessions();
            }}
            ref={historyButtonRef}
            title={getString("sidebar-history")}
            type="button"
          >
            <Icon name="history" />
          </button>
          <button
            aria-controls={
              state.sessionsOpen && state.sessionsMode === "archive"
                ? "zp-session-list"
                : undefined
            }
            aria-expanded={
              state.sessionsOpen && state.sessionsMode === "archive"
            }
            aria-haspopup="listbox"
            aria-label={getString("sidebar-archived-sessions")}
            className="zp-icon-button zp-archive-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleArchivedSessions();
            }}
            ref={archiveButtonRef}
            title={getString("sidebar-archived-sessions")}
            type="button"
          >
            <Icon name="archive" />
          </button>
          <button
            aria-label={getString("sidebar-new-chat")}
            className="zp-icon-button zp-new-session-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.createNewSession();
            }}
            title={getString("sidebar-new-chat")}
            type="button"
          >
            <Icon name="newChat" />
          </button>
          <button
            aria-label={getString("sidebar-close")}
            className="zp-icon-button"
            onClick={actions.close}
            title={getString("sidebar-close")}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      {state.sessionsOpen ? (
        <FloatingPortal
          align="end"
          anchorRef={sessionAnchorRef}
          horizontalBoundaryRef={headerRef}
          maxWidth={420}
          minWidth={240}
          onDismiss={actions.hideSessions}
          preferredSide="below"
          width={300}
          zIndex={8}
        >
          <SessionPopover
            actions={actions}
            mode={state.sessionsMode}
            onClose={actions.hideSessions}
            sessions={state.sessions}
            triggerRef={sessionAnchorRef}
          />
        </FloatingPortal>
      ) : null}
    </>
  );
}

export { SidebarHeader };
