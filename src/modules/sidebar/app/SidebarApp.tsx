import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { getString } from "../../../utils/locale";
import { MarkdownView } from "./MarkdownView";
import type { SidebarActions, SidebarMessageView, SidebarState } from "./types";

export function SidebarApp({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const logRef = useRef<HTMLElement | null>(null);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserMessage = useMemo(
    () =>
      [...state.messages].reverse().find((message) => message.role === "user"),
    [state.messages],
  );

  useEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [state.messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    const handle = resizeHandleRef.current;
    if (!handle) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      actions.startResize(event);
    };
    handle.addEventListener("pointerdown", onPointerDown);
    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
    };
  }, [actions]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  useEffect(() => {
    if (!state.context.paperKey) {
      setContextOpen(false);
    }
  }, [state.context.paperKey]);

  const submit = (text = draft) => {
    const trimmed = text.trim();
    if (!trimmed || state.busy || !state.composerEnabled) {
      return;
    }
    actions.submitPrompt(trimmed);
    setDraft("");
  };

  const copyMessage = (
    message: SidebarMessageView,
    mode: "text" | "markdown",
  ) => {
    void copyText(message.text).then(() => {
      setCopiedId(`${message.id}-${mode}`);
      globalThis.setTimeout(() => setCopiedId(null), 900);
    });
  };

  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zcp-sidebar"
      onClick={() => {
        if (state.sessionsOpen) {
          actions.hideSessions();
        }
        setContextOpen(false);
      }}
      role="complementary"
    >
      <div
        aria-hidden="true"
        className="zcp-resize-handle"
        id="zotero-copilot-sidebar-splitter"
        ref={resizeHandleRef}
      />
      <header className="zcp-sidebar-header">
        <button
          className="zcp-sidebar-identity"
          onClick={(event) => {
            event.stopPropagation();
            setContextOpen((open) => !open);
          }}
          title={state.title}
          type="button"
        >
          <span className="zcp-sidebar-icon" />
          <span className="zcp-sidebar-title-block">
            <span className="zcp-sidebar-title">
              {getString("sidebar-title")}
            </span>
            <span className="zcp-sidebar-selected-title">{state.title}</span>
          </span>
        </button>
        <div className="zcp-sidebar-actions">
          <button
            aria-expanded={state.sessionsOpen}
            aria-haspopup="true"
            aria-label={getString("sidebar-history")}
            className="zcp-icon-button zcp-history-button"
            disabled={state.busy || !state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleSessions();
            }}
            title={getString("sidebar-history")}
            type="button"
          >
            <span className="zcp-history-icon" />
          </button>
          <button
            aria-label={getString("sidebar-new-chat")}
            className="zcp-icon-button zcp-new-session-button"
            disabled={state.busy || !state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.createNewSession();
            }}
            title={getString("sidebar-new-chat")}
            type="button"
          >
            <span className="zcp-action-icon zcp-plus-icon" />
          </button>
          <button
            aria-label={getString("sidebar-close")}
            className="zcp-icon-button"
            onClick={actions.close}
            title={getString("sidebar-close")}
            type="button"
          >
            <span className="zcp-action-icon zcp-close-icon" />
          </button>
        </div>
      </header>
      {contextOpen ? (
        <ContextPopover
          label={state.context.label}
          onClose={() => setContextOpen(false)}
          paperKey={state.context.paperKey}
          paperTitle={state.context.paperTitle}
          parentItemKey={state.context.parentItemKey}
          attachmentKey={state.context.attachmentKey}
        />
      ) : null}
      {state.sessionsOpen ? (
        <SessionPopover actions={actions} sessions={state.sessions} />
      ) : null}
      <main aria-live="polite" className="zcp-chat-log" ref={logRef} role="log">
        {state.messages.map((message) => (
          <Message
            busy={state.busy}
            copiedId={copiedId}
            key={message.id}
            lastUserText={lastUserMessage?.text}
            message={message}
            onCopy={copyMessage}
            onInsert={(text) => {
              setDraft(text);
              globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            onOpenLink={actions.openExternalLink}
            onSubmit={submit}
          />
        ))}
      </main>
      <form
        aria-busy={state.busy}
        className="zcp-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="zcp-context-row">
          <button
            aria-label={getString("sidebar-add-context")}
            className="zcp-context-add"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              setContextOpen((open) => !open);
            }}
            title={getString("sidebar-add-context")}
            type="button"
          >
            <span className="zcp-action-icon zcp-plus-icon" />
          </button>
          <button
            className="zcp-context-chip"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              setContextOpen((open) => !open);
            }}
            title={state.context.label}
            type="button"
          >
            <span className="zcp-context-chip-icon" />
            <span className="zcp-context-chip-text">{state.context.label}</span>
          </button>
        </div>
        <textarea
          className="zcp-composer-input"
          disabled={state.busy || !state.composerEnabled}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onInput={(event) => resizeTextarea(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={getString("sidebar-input-placeholder")}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <div className="zcp-composer-footer">
          <div className="zcp-composer-meta">
            <span className="zcp-composer-pill">
              {getString("sidebar-model-name")}
            </span>
            <span className="zcp-composer-pill">
              {getString("sidebar-reasoning-depth")}
            </span>
          </div>
          <button
            aria-label={getString("sidebar-send")}
            className="zcp-send-button"
            disabled={state.busy || !state.composerEnabled || !draft.trim()}
            title={getString("sidebar-send")}
            type="submit"
          >
            <span className={state.busy ? "zcp-dots-icon" : "zcp-send-icon"} />
          </button>
        </div>
      </form>
    </aside>
  );
}

function Message({
  busy,
  copiedId,
  lastUserText,
  message,
  onCopy,
  onInsert,
  onOpenLink,
  onSubmit,
}: {
  busy: boolean;
  copiedId: string | null;
  lastUserText?: string;
  message: SidebarMessageView;
  onCopy: (message: SidebarMessageView, mode: "text" | "markdown") => void;
  onInsert: (text: string) => void;
  onOpenLink: (url: string) => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const isAssistant = message.role === "assistant";
  const canRetry = isAssistant && lastUserText && !message.transient;

  return (
    <article
      className={`zcp-message zcp-message-${message.role}`}
      data-status={message.status}
    >
      {isAssistant ? <div className="zcp-message-avatar" /> : null}
      <div
        className={isAssistant ? "zcp-message-stack" : "zcp-message-user-stack"}
      >
        {isAssistant ? (
          <div className="zcp-message-body">
            <MarkdownView markdown={message.text} onOpenLink={onOpenLink} />
          </div>
        ) : (
          <div className="zcp-message-bubble">{message.text}</div>
        )}
        <div className="zcp-message-actions">
          <IconAction
            active={copiedId === `${message.id}-text`}
            icon="copy"
            label={getString("sidebar-copy-text")}
            onClick={() => onCopy(message, "text")}
          />
          {isAssistant ? (
            <>
              <IconAction
                active={copiedId === `${message.id}-markdown`}
                icon="markdown"
                label={getString("sidebar-copy-markdown")}
                onClick={() => onCopy(message, "markdown")}
              />
              <IconAction
                icon="insert"
                label={getString("sidebar-insert-composer")}
                onClick={() => onInsert(message.text)}
              />
              <IconAction
                disabled={busy || !canRetry}
                icon="retry"
                label={getString("sidebar-retry-turn")}
                onClick={() => {
                  if (lastUserText) {
                    onSubmit(lastUserText);
                  }
                }}
              />
            </>
          ) : (
            <>
              <IconAction
                icon="edit"
                label={getString("sidebar-edit-composer")}
                onClick={() => onInsert(message.text)}
              />
              <IconAction
                disabled={busy}
                icon="resend"
                label={getString("sidebar-resend")}
                onClick={() => onSubmit(message.text)}
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function IconAction({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-label={label}
      className="zcp-message-action"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className={`zcp-${active ? "check" : icon}-icon`} />
    </button>
  );
}

function SessionPopover({
  actions,
  sessions,
}: {
  actions: SidebarActions;
  sessions: SidebarState["sessions"];
}): ReactElement {
  return (
    <div
      className="zcp-session-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zcp-session-popover-header">
        {getString("sidebar-history")}
      </div>
      {sessions.length ? (
        <div className="zcp-session-list">
          {sessions.map((session) => (
            <div
              className="zcp-session-row"
              data-active={session.active || undefined}
              key={session.id}
            >
              <button
                className="zcp-session-select"
                onClick={() => actions.switchSession(session.conversation)}
                title={session.title}
                type="button"
              >
                <span className="zcp-session-label">{session.title}</span>
                <span className="zcp-session-meta">{session.meta}</span>
              </button>
              <button
                aria-label={getString("sidebar-delete-session")}
                className="zcp-session-archive"
                onClick={() => actions.archiveSession(session.conversation)}
                title={getString("sidebar-delete-session")}
                type="button"
              >
                <span className="zcp-action-icon zcp-close-icon" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="zcp-session-empty">
          {getString("sidebar-no-sessions")}
        </div>
      )}
    </div>
  );
}

function ContextPopover({
  attachmentKey,
  label,
  onClose,
  paperKey,
  paperTitle,
  parentItemKey,
}: {
  attachmentKey?: string;
  label: string;
  onClose: () => void;
  paperKey?: string;
  paperTitle?: string;
  parentItemKey?: string;
}): ReactElement {
  return (
    <div
      className="zcp-context-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zcp-context-popover-header">
        <span>{getString("sidebar-context-details")}</span>
        <button
          aria-label={getString("sidebar-close")}
          className="zcp-message-action"
          onClick={onClose}
          title={getString("sidebar-close")}
          type="button"
        >
          <span className="zcp-close-icon" />
        </button>
      </div>
      <dl className="zcp-context-details">
        <div>
          <dt>{getString("sidebar-current-context")}</dt>
          <dd>{paperTitle || label}</dd>
        </div>
        <div>
          <dt>{getString("sidebar-paper-key")}</dt>
          <dd>{paperKey || getString("sidebar-unavailable-context")}</dd>
        </div>
        {parentItemKey ? (
          <div>
            <dt>{getString("sidebar-parent-key")}</dt>
            <dd>{parentItemKey}</dd>
          </div>
        ) : null}
        {attachmentKey ? (
          <div>
            <dt>{getString("sidebar-attachment-key")}</dt>
            <dd>{attachmentKey}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return;
  }
  const hostHeight =
    textarea.closest("#zotero-copilot-sidebar-shell")?.clientHeight || 680;
  const maxHeight = Math.max(140, Math.floor(hostHeight * 0.42));
  textarea.style.height = "auto";
  textarea.style.maxHeight = `${maxHeight}px`;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

async function copyText(text: string): Promise<void> {
  const nav = (globalThis as typeof globalThis & { navigator?: Navigator })
    .navigator;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  const doc = getDocument();
  if (!doc?.body) {
    return;
  }
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  doc.body.append(textarea);
  textarea.select();
  doc.execCommand("copy");
  textarea.remove();
}

function getDocument(): Document | undefined {
  return (globalThis as typeof globalThis & { document?: Document }).document;
}
