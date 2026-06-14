import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { getString } from "../../../utils/locale";
import { copyText } from "./clipboard";
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
  const autoScrollRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserMessage = useMemo(
    () =>
      [...state.messages].reverse().find((message) => message.role === "user"),
    [state.messages],
  );
  const selectedModelLabel =
    state.models.find((model) => model.slug === state.selectedModel)
      ?.displayName || state.selectedModel;
  const selectedEffortLabel = state.selectedReasoningEffort
    ? formatEffortLabel(state.selectedReasoningEffort)
    : "";

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && autoScrollRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [state.messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

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
        className="zp-resize-handle"
        id="zopilot-sidebar-splitter"
        onPointerDown={(event) => actions.startResize(event.nativeEvent)}
      />
      <header className="zp-sidebar-header">
        <button
          className="zp-sidebar-identity"
          onClick={(event) => {
            event.stopPropagation();
            setContextOpen((open) => !open);
          }}
          title={state.title}
          type="button"
        >
          <span className="zp-sidebar-icon" />
          <span className="zp-sidebar-title-block">
            <span className="zp-sidebar-title">
              {getString("sidebar-title")}
            </span>
            <span className="zp-sidebar-selected-title">{state.title}</span>
          </span>
        </button>
        <div className="zp-sidebar-actions">
          <button
            aria-expanded={state.sessionsOpen}
            aria-haspopup="true"
            aria-label={getString("sidebar-history")}
            className="zp-icon-button zp-history-button"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleSessions();
            }}
            title={getString("sidebar-history")}
            type="button"
          >
            <span className="zp-history-icon" />
          </button>
          <button
            aria-label={getString("sidebar-new-chat")}
            className="zp-icon-button zp-new-session-button"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.createNewSession();
            }}
            title={getString("sidebar-new-chat")}
            type="button"
          >
            <span className="zp-action-icon zp-plus-icon" />
          </button>
          <button
            aria-label={getString("sidebar-close")}
            className="zp-icon-button"
            onClick={actions.close}
            title={getString("sidebar-close")}
            type="button"
          >
            <span className="zp-action-icon zp-close-icon" />
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
      <main
        aria-live="polite"
        className="zp-chat-log"
        onScroll={(event) => {
          autoScrollRef.current = isNearScrollBottom(event.currentTarget);
        }}
        ref={logRef}
        role="log"
      >
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
        className="zp-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="zp-context-row">
          <button
            aria-label={getString("sidebar-add-context")}
            className="zp-context-add"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              setContextOpen((open) => !open);
            }}
            title={getString("sidebar-add-context")}
            type="button"
          >
            <span className="zp-action-icon zp-plus-icon" />
          </button>
          <button
            className="zp-context-chip"
            disabled={!state.context.paperKey}
            onClick={(event) => {
              event.stopPropagation();
              setContextOpen((open) => !open);
            }}
            title={state.context.label}
            type="button"
          >
            <span className="zp-context-chip-icon" />
            <span className="zp-context-chip-text">{state.context.label}</span>
          </button>
        </div>
        <textarea
          className="zp-composer-input"
          disabled={!state.composerEnabled}
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
        <div className="zp-composer-footer">
          <div className="zp-composer-meta">
            {state.codexStatus !== "connected" ? (
              <span className="zp-codex-status" data-status={state.codexStatus}>
                {state.codexStatus === "checking"
                  ? getString("sidebar-codex-status-checking")
                  : getString("sidebar-codex-status-disconnected")}
              </span>
            ) : null}
            <select
              aria-label={getString("sidebar-model-name")}
              className="zp-composer-select"
              disabled={!state.models.length}
              onChange={(event) =>
                actions.selectModel(event.currentTarget.value)
              }
              style={{
                inlineSize: getComposerSelectInlineSize(selectedModelLabel),
              }}
              title={getString("sidebar-model-name")}
              value={state.selectedModel}
            >
              {state.models.map((model) => (
                <option key={model.slug} value={model.slug}>
                  {model.displayName}
                </option>
              ))}
            </select>
            {state.availableReasoningEfforts.length ? (
              <select
                aria-label={getString("sidebar-reasoning-depth")}
                className="zp-composer-select"
                onChange={(event) =>
                  actions.selectReasoningEffort(event.currentTarget.value)
                }
                style={{
                  inlineSize: getComposerSelectInlineSize(selectedEffortLabel),
                }}
                title={getString("sidebar-reasoning-depth")}
                value={state.selectedReasoningEffort || ""}
              >
                {state.availableReasoningEfforts.map((effort) => (
                  <option key={effort} value={effort}>
                    {formatEffortLabel(effort)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <button
            aria-label={
              state.busy ? getString("sidebar-stop") : getString("sidebar-send")
            }
            className="zp-send-button"
            disabled={!state.composerEnabled || (!state.busy && !draft.trim())}
            onClick={(event) => {
              if (!state.busy) {
                return;
              }
              event.preventDefault();
              actions.interruptActiveTurn();
            }}
            title={
              state.busy ? getString("sidebar-stop") : getString("sidebar-send")
            }
            type={state.busy ? "button" : "submit"}
          >
            <span className={state.busy ? "zp-stop-icon" : "zp-send-icon"} />
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
  onCopy: (message: SidebarMessageView) => void;
  onInsert: (text: string) => void;
  onOpenLink: (url: string) => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const isAssistant = message.role === "assistant";
  const isCompleteAssistant =
    isAssistant &&
    message.status === "complete" &&
    !message.transient &&
    !message.running &&
    Boolean(message.completedAt);
  const canRetry = isCompleteAssistant && lastUserText;
  const completedAt = message.completedAt;

  return (
    <article
      className={`zp-message zp-message-${message.role}`}
      data-status={message.status}
    >
      {isAssistant ? <div className="zp-message-avatar" /> : null}
      <div
        className={isAssistant ? "zp-message-stack" : "zp-message-user-stack"}
      >
        {isAssistant ? (
          <div className="zp-message-body">
            <MarkdownView markdown={message.text} onOpenLink={onOpenLink} />
          </div>
        ) : (
          <div className="zp-message-bubble">{message.text}</div>
        )}
        {isAssistant ? (
          <AssistantFooter
            canRetry={Boolean(canRetry)}
            completedAt={completedAt}
            copied={copiedId === `${message.id}-text`}
            message={message}
            onCopy={() => onCopy(message)}
            onInsert={() => onInsert(message.text)}
            onRetry={() => {
              if (lastUserText) {
                onSubmit(lastUserText);
              }
            }}
          />
        ) : (
          <div className="zp-message-actions">
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
          </div>
        )}
      </div>
    </article>
  );
}

function AssistantFooter({
  canRetry,
  completedAt,
  copied,
  message,
  onCopy,
  onInsert,
  onRetry,
}: {
  canRetry: boolean;
  completedAt?: string;
  copied: boolean;
  message: SidebarMessageView;
  onCopy: () => void;
  onInsert: () => void;
  onRetry: () => void;
}): ReactElement | null {
  if (message.running || message.transient) {
    return null;
  }
  if (message.status !== "complete") {
    return (
      <div className="zp-message-footer">
        <span className="zp-message-status">
          {message.status === "interrupted"
            ? getString("sidebar-status-interrupted")
            : getString("sidebar-status-error")}
        </span>
        {completedAt ? (
          <time className="zp-message-time">{completedAt}</time>
        ) : null}
      </div>
    );
  }
  if (!completedAt) {
    return null;
  }
  return (
    <div className="zp-message-footer">
      <div className="zp-message-actions">
        <IconAction
          active={copied}
          icon="copy"
          label={getString("sidebar-copy-text")}
          onClick={onCopy}
        />
        <IconAction
          icon="insert"
          label={getString("sidebar-insert-composer")}
          onClick={onInsert}
        />
        <IconAction
          disabled={!canRetry}
          icon="retry"
          label={getString("sidebar-retry-turn")}
          onClick={onRetry}
        />
      </div>
      <time className="zp-message-time">{completedAt}</time>
    </div>
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
      className="zp-message-action"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className={`zp-${active ? "check" : icon}-icon`} />
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
      className="zp-session-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zp-session-popover-header">
        {getString("sidebar-history")}
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
              <button
                aria-label={getString("sidebar-delete-session")}
                className="zp-session-archive"
                onClick={() => actions.archiveSession(session.conversation)}
                title={getString("sidebar-delete-session")}
                type="button"
              >
                <span className="zp-action-icon zp-close-icon" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="zp-session-empty">
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
      className="zp-context-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zp-context-popover-header">
        <span>{getString("sidebar-context-details")}</span>
        <button
          aria-label={getString("sidebar-close")}
          className="zp-message-action"
          onClick={onClose}
          title={getString("sidebar-close")}
          type="button"
        >
          <span className="zp-close-icon" />
        </button>
      </div>
      <dl className="zp-context-details">
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
    textarea.closest("#zopilot-sidebar-shell")?.clientHeight || 680;
  const maxHeight = Math.max(140, Math.floor(hostHeight * 0.42));
  textarea.style.height = "auto";
  textarea.style.maxHeight = `${maxHeight}px`;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function isNearScrollBottom(element: HTMLElement): boolean {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= 32;
}

function formatEffortLabel(effort: string): string {
  return effort.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase());
}

function getComposerSelectInlineSize(label: string): string {
  const characterCount = Array.from(label || "").length;
  return `${clampNumber(characterCount + 2, 5, 24)}ch`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
