import { useEffect, useState, type ReactElement } from "react";
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
  const now = useRelativeTimeClock(sessions.length > 0);
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
                <span className="zp-session-meta">
                  {formatSessionRelativeTime(session.meta, now)}
                </span>
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

type SessionRelativeTime = {
  count: number;
  unit: "now" | "minutes" | "hours" | "days" | "weeks";
};

function resolveSessionRelativeTime(
  value: string,
  now = Date.now(),
): SessionRelativeTime {
  const timestamp = new Date(value).getTime();
  const elapsedMs = Number.isFinite(timestamp)
    ? Math.max(0, now - timestamp)
    : 0;
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 1) return { count: 0, unit: "now" };
  if (elapsedMinutes < 60) {
    return { count: elapsedMinutes, unit: "minutes" };
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return { count: elapsedHours, unit: "hours" };
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return { count: elapsedDays, unit: "days" };
  return { count: Math.floor(elapsedDays / 7), unit: "weeks" };
}

function formatSessionRelativeTime(value: string, now = Date.now()): string {
  const relative = resolveSessionRelativeTime(value, now);
  if (relative.unit === "now") {
    return getString("sidebar-session-time-now");
  }
  return getString(`sidebar-session-time-${relative.unit}`, {
    args: { count: relative.count },
  });
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

export { formatSessionRelativeTime, resolveSessionRelativeTime };
