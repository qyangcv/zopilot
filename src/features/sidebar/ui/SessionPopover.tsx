import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { getString } from "../../../app/localization";
import {
  PopupHeader,
  PopupList,
  PopupRow,
  PopupSurface,
  usePopupListNavigation,
} from "../../../ui/primitives/index";
import { Icon } from "./Icon";
import type { SidebarActions, SidebarState } from "./types";

export function SessionPopover({
  actions,
  mode,
  onClose,
  sessions,
  triggerRef,
}: {
  actions: SidebarActions;
  mode: SidebarState["sessionsMode"];
  onClose: () => void;
  sessions: SidebarState["sessions"];
  triggerRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const archived = mode === "archive";
  const initialIndex = archived
    ? 0
    : Math.max(
        0,
        sessions.findIndex((session) => session.active),
      );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const previousModeRef = useRef(mode);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const now = useRelativeTimeClock(sessions.length > 0);

  useEffect(() => {
    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    const selectedIndex = archived
      ? 0
      : sessions.findIndex((session) => session.active);
    setActiveIndex(Math.max(0, selectedIndex));
  }, [archived, mode, sessions]);

  const selectSession = (index: number) => {
    const session = sessions[index];
    if (session) actions.switchSession(session.conversation);
  };
  const navigation = usePopupListNavigation({
    activeIndex,
    itemCount: sessions.length,
    itemRefs: rowRefs,
    listRef,
    onActiveIndexChange: setActiveIndex,
    onCommit: selectSession,
    onDismiss: onClose,
    restoreFocusRef: triggerRef,
  });
  const mutateSession = (index: number) => {
    const session = sessions[index];
    if (!session) return;
    if (archived) actions.restoreSession(session.conversation);
    else actions.archiveSession(session.conversation);
    queueMicrotask(() => listRef.current?.focus({ preventScroll: true }));
  };

  return (
    <PopupSurface
      aria-label={getString(
        archived ? "sidebar-archived-sessions" : "sidebar-history",
      )}
      className="zp-session-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <PopupHeader
        className="zp-session-popover-header"
        title={getString(
          archived ? "sidebar-archived-sessions" : "sidebar-history",
        )}
      />
      <PopupList
        aria-activedescendant={
          activeIndex >= 0 ? `zp-session-option-${activeIndex}` : undefined
        }
        aria-label={getString(
          archived ? "sidebar-archived-sessions" : "sidebar-history",
        )}
        className="zp-session-list"
        id="zp-session-list"
        onKeyDown={navigation.onKeyDown}
        ref={listRef}
        role="listbox"
        tabIndex={0}
      >
        {sessions.map((session, index) => {
          const selected = !archived && session.active;
          const actionLabel = getString(
            archived ? "sidebar-restore-session" : "sidebar-delete-session",
          );
          return (
            <PopupRow
              action={
                <button
                  aria-label={actionLabel}
                  className={[
                    "zp-session-action",
                    archived ? "zp-session-restore" : "zp-session-archive",
                  ].join(" ")}
                  data-popup-action
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    mutateSession(index);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowDown" ||
                      event.key === "ArrowUp" ||
                      event.key === "Home" ||
                      event.key === "End"
                    ) {
                      queueMicrotask(() =>
                        listRef.current?.focus({ preventScroll: true }),
                      );
                    }
                  }}
                  title={actionLabel}
                  type="button"
                >
                  <Icon
                    name={archived ? "archiveRestore" : "archive"}
                    size={14}
                  />
                </button>
              }
              active={index === activeIndex}
              aria-selected={selected}
              className="zp-session-row"
              id={`zp-session-option-${index}`}
              key={session.id}
              label={session.title}
              metadata={formatSessionRelativeTime(session.meta, now)}
              onClick={() => selectSession(index)}
              onMouseEnter={() => setActiveIndex(index)}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              role="option"
              selected={selected}
              selection={selected ? <Icon name="check" size={13} /> : null}
              tabIndex={-1}
              title={session.title}
            />
          );
        })}
        {sessions.length === 0 ? (
          <div className="zp-session-empty">
            {getString(
              archived ? "sidebar-no-archived-sessions" : "sidebar-no-sessions",
            )}
          </div>
        ) : null}
      </PopupList>
    </PopupSurface>
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
