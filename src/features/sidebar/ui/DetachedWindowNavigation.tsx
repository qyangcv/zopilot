import { useEffect, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { formatSessionRelativeTime } from "./SessionPopover";
import { Icon } from "./Icon";
import type { SidebarActions, SidebarSessionView, SidebarState } from "./types";

export const DETACHED_WINDOW_NAVIGATION_ID = "zp-detached-navigation";

export function DetachedWindowNavigation({
  actions,
  expanded,
  state,
}: {
  actions: SidebarActions;
  expanded: boolean;
  state: SidebarState;
}): ReactElement {
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const hasSessions = state.sessions.length + state.archivedSessions.length > 0;
  const now = useRelativeTimeClock(expanded && hasSessions);
  return (
    <nav
      aria-label={getString("sidebar-window-navigation")}
      className="zp-detached-navigation"
      hidden={!expanded}
      id={DETACHED_WINDOW_NAVIGATION_ID}
    >
      <button
        aria-label={getString("sidebar-new-chat")}
        className="zp-detached-new-session"
        disabled={!state.context.workspaceKey}
        onClick={actions.createNewSession}
        title={getString("sidebar-new-chat")}
        type="button"
      >
        <span className="zp-detached-new-session-content">
          <span
            aria-hidden="true"
            className="zp-detached-navigation-disclosure-spacer"
          />
          <Icon name="newChat" size={14} strokeWidth={1.5} />
          <span>{getString("sidebar-new-chat")}</span>
        </span>
      </button>
      <SessionSection
        actions={actions}
        expanded={historyExpanded}
        icon="history"
        listId="zp-detached-history-list"
        onToggle={() => setHistoryExpanded((expanded) => !expanded)}
        sessions={state.sessions}
        title={getString("sidebar-history")}
        toggleLabel={getString(
          historyExpanded
            ? "sidebar-collapse-history"
            : "sidebar-expand-history",
        )}
        now={now}
      />
      <SessionSection
        actions={actions}
        archived
        expanded={archiveExpanded}
        icon="archive"
        listId="zp-detached-archive-list"
        onToggle={() => setArchiveExpanded((expanded) => !expanded)}
        sessions={state.archivedSessions}
        title={getString("sidebar-archived-sessions")}
        toggleLabel={getString(
          archiveExpanded
            ? "sidebar-collapse-archived-sessions"
            : "sidebar-expand-archived-sessions",
        )}
        now={now}
      />
    </nav>
  );
}

function SessionSection({
  actions,
  archived = false,
  expanded,
  icon,
  listId,
  now,
  onToggle,
  sessions,
  title,
  toggleLabel,
}: {
  actions: SidebarActions;
  archived?: boolean;
  expanded: boolean;
  icon: "archive" | "history";
  listId: string;
  now: number;
  onToggle: () => void;
  sessions: SidebarSessionView[];
  title: string;
  toggleLabel: string;
}): ReactElement {
  return (
    <section
      aria-label={title}
      className="zp-detached-session-section"
      data-expanded={expanded || undefined}
    >
      <h2 className="zp-detached-session-heading">
        <button
          aria-controls={listId}
          aria-expanded={expanded}
          className="zp-detached-session-toggle"
          data-zp-tooltip={toggleLabel}
          onClick={onToggle}
          title={toggleLabel}
          type="button"
        >
          <span className="zp-detached-session-toggle-content">
            <Icon name={expanded ? "collapse" : "expand"} size={12} />
            <Icon name={icon} size={14} strokeWidth={1.5} />
            <span className="zp-detached-session-heading-label">{title}</span>
            <span
              aria-label={`${sessions.length}`}
              className="zp-detached-session-count"
            >
              {sessions.length}
            </span>
          </span>
        </button>
      </h2>
      {expanded ? (
        <div className="zp-detached-session-list" id={listId}>
          {sessions.map((session) => {
            const actionLabel = getString(
              archived ? "sidebar-restore-session" : "sidebar-delete-session",
            );
            return (
              <div
                className="zp-detached-session-row"
                data-active={!archived && session.active ? true : undefined}
                key={session.id}
              >
                <button
                  aria-current={
                    !archived && session.active ? "true" : undefined
                  }
                  className="zp-detached-session-main"
                  onClick={() => actions.switchSession(session.conversation)}
                  title={session.title}
                  type="button"
                >
                  <span className="zp-detached-session-title">
                    {session.title}
                  </span>
                  {session.status ? (
                    <SessionStatus status={session.status} />
                  ) : null}
                  <time
                    className="zp-detached-session-time"
                    dateTime={session.meta}
                  >
                    {formatSessionRelativeTime(session.meta, now)}
                  </time>
                </button>
                <button
                  aria-label={actionLabel}
                  className="zp-detached-session-action"
                  onClick={() => {
                    if (archived) actions.restoreSession(session.conversation);
                    else actions.archiveSession(session.conversation);
                  }}
                  title={actionLabel}
                  type="button"
                >
                  <Icon
                    name={archived ? "archiveRestore" : "archive"}
                    size={14}
                  />
                </button>
              </div>
            );
          })}
          {sessions.length === 0 ? (
            <div className="zp-detached-session-empty">
              {getString(
                archived
                  ? "sidebar-no-archived-sessions"
                  : "sidebar-no-sessions",
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SessionStatus({
  status,
}: {
  status: NonNullable<SidebarSessionView["status"]>;
}): ReactElement {
  const label = getString(
    status === "running" ? "sidebar-session-running" : "sidebar-session-unread",
  );
  return (
    <span
      aria-label={label}
      className="zp-detached-session-status"
      data-status={status}
      title={label}
    >
      {status === "running" ? (
        <Icon
          className="zp-detached-session-running-icon"
          name="checking"
          size={12}
          strokeWidth={1.7}
        />
      ) : (
        <span aria-hidden="true" className="zp-detached-session-unread-dot" />
      )}
    </span>
  );
}

function useRelativeTimeClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const interval = globalThis.setInterval(() => setNow(Date.now()), 30_000);
    return () => globalThis.clearInterval(interval);
  }, [enabled]);
  return now;
}
