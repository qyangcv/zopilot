import { type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon } from "./Icon";
import type { SidebarActions, SidebarState } from "./types";

export function SessionPopover({
  actions,
  mode,
  sessions,
}: {
  actions: SidebarActions;
  mode: SidebarState["sessionsMode"];
  sessions: SidebarState["sessions"];
}): ReactElement {
  const archived = mode === "archive";
  return (
    <div
      className="zp-session-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zp-session-popover-header">
        {getString(archived ? "sidebar-archived-sessions" : "sidebar-history")}
      </div>
      {sessions.length ? (
        <div className="zp-session-list">
          {sessions.map((session) => (
            <div
              className="zp-session-row"
              data-active={session.active || undefined}
              key={session.id}
            >
              <button
                className="zp-session-select"
                onClick={() => actions.switchSession(session.conversation)}
                title={session.title}
                type="button"
              >
                <span className="zp-session-label">{session.title}</span>
                <span className="zp-session-meta">{session.meta}</span>
              </button>
              {archived ? null : (
                <button
                  aria-label={getString("sidebar-delete-session")}
                  className="zp-session-action zp-session-archive"
                  onClick={() => actions.archiveSession(session.conversation)}
                  title={getString("sidebar-delete-session")}
                  type="button"
                >
                  <Icon name="archive" size={14} />
                </button>
              )}
              {archived ? (
                <button
                  aria-label={getString("sidebar-restore-session")}
                  className="zp-session-action zp-session-restore"
                  onClick={() => actions.restoreSession(session.conversation)}
                  title={getString("sidebar-restore-session")}
                  type="button"
                >
                  <Icon name="archiveRestore" size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="zp-session-empty">
          {getString(
            archived ? "sidebar-no-archived-sessions" : "sidebar-no-sessions",
          )}
        </div>
      )}
    </div>
  );
}
