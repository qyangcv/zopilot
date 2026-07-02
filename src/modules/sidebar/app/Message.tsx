import type { ReactElement } from "react";
import { getString } from "../../../utils/locale";
import { Icon, type IconName } from "./Icon";
import { MarkdownView } from "./MarkdownView";
import type { SidebarMessageView } from "./types";

export function Message({
  busy,
  copiedId,
  lastUserText,
  message,
  onCopy,
  onInsert,
  onOpenLink,
  onOpenLocator,
  onSubmit,
}: {
  busy: boolean;
  copiedId: string | null;
  lastUserText?: string;
  message: SidebarMessageView;
  onCopy: (message: SidebarMessageView) => void;
  onInsert: (text: string) => void;
  onOpenLink: (url: string) => void;
  onOpenLocator: (
    locator: NonNullable<SidebarMessageView["locators"]>[number],
  ) => void;
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
      {isAssistant ? (
        <Icon className="zp-message-avatar" name="brand" size={17} />
      ) : null}
      <div
        className={isAssistant ? "zp-message-stack" : "zp-message-user-stack"}
      >
        {isAssistant ? (
          <div className="zp-message-body">
            <MarkdownView
              className="zp-message-markdown"
              markdown={message.text}
              onOpenLink={onOpenLink}
            />
          </div>
        ) : message.localAttachments?.length ? (
          <div className="zp-message-bubble zp-message-user-content">
            <MessageAttachments attachments={message.localAttachments} />
            <MarkdownView
              className="zp-message-markdown"
              markdown={message.text}
              onOpenLink={onOpenLink}
              unwrapSingleParagraph
            />
          </div>
        ) : (
          <MarkdownView
            className="zp-message-bubble zp-message-markdown"
            markdown={message.text}
            onOpenLink={onOpenLink}
            unwrapSingleParagraph
          />
        )}
        {isAssistant ? (
          <AssistantFooter
            canRetry={Boolean(canRetry)}
            completedAt={completedAt}
            copied={copiedId === `${message.id}-text`}
            locators={message.locators || []}
            message={message}
            onCopy={() => onCopy(message)}
            onInsert={() => onInsert(message.text)}
            onOpenLocator={onOpenLocator}
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

function MessageAttachments({
  attachments,
}: {
  attachments: NonNullable<SidebarMessageView["localAttachments"]>;
}): ReactElement {
  return (
    <div className="zp-local-attachments zp-message-attachments">
      {attachments.map((attachment) => (
        <div
          className="zp-local-attachment zp-message-attachment"
          key={attachment.id}
          title={attachment.path}
        >
          <Icon
            className="zp-local-attachment-icon"
            name={
              attachment.kind === "pdf" ? "attachmentPdf" : "attachmentImage"
            }
            size={13}
          />
          <span className="zp-local-attachment-name">
            {attachment.filename}
          </span>
        </div>
      ))}
    </div>
  );
}

function AssistantFooter({
  canRetry,
  completedAt,
  copied,
  locators,
  message,
  onCopy,
  onInsert,
  onOpenLocator,
  onRetry,
}: {
  canRetry: boolean;
  completedAt?: string;
  copied: boolean;
  locators: NonNullable<SidebarMessageView["locators"]>;
  message: SidebarMessageView;
  onCopy: () => void;
  onInsert: () => void;
  onOpenLocator: (
    locator: NonNullable<SidebarMessageView["locators"]>[number],
  ) => void;
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
        {locators.map((locator) => (
          <button
            className="zp-locator-chip"
            key={`${locator.kind}-${locator.label}`}
            onClick={() => onOpenLocator(locator)}
            title={getString("sidebar-open-reader-location")}
            type="button"
          >
            {locator.label}
          </button>
        ))}
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
  icon: IconName;
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
      <Icon name={active ? "copied" : icon} size={14} />
    </button>
  );
}
