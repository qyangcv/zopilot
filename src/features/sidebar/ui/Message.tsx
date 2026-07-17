import { memo, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon, type IconName } from "./Icon";
import { ContextChips } from "./ContextChips";
import { MarkdownView } from "./MarkdownView";
import type { SidebarMessageView } from "./types";
import { TracePanel } from "./TracePanel";
import { ProviderBrandIcon } from "../../../ui/ProviderBrandIcon";
import { rootItemMentions, ungroupedNoteContexts } from "./itemContextGroups";

function Message({
  busy,
  copiedId,
  itemContextTitle,
  message,
  onCopy,
  onEdit,
  onOpenLink,
  onSubmit,
}: {
  busy: boolean;
  copiedId: string | null;
  itemContextTitle?: string;
  message: SidebarMessageView;
  onCopy: (message: SidebarMessageView) => void;
  onEdit: (message: SidebarMessageView) => void;
  onOpenLink: (url: string) => void;
  onSubmit: (message: SidebarMessageView) => void;
}): ReactElement {
  const isAssistant = message.role === "assistant";
  const completedAt = message.completedAt;
  const messageMentions = itemContextTitle
    ? []
    : rootItemMentions(message.mentions || []);
  const messageNoteContexts = itemContextTitle
    ? []
    : ungroupedNoteContexts(message.mentions || [], message.noteContexts || []);

  return (
    <article
      className={`zp-message zp-message-${message.role}`}
      data-status={message.status}
    >
      {isAssistant ? (
        message.model ? (
          <ProviderBrandIcon
            brand={message.providerBrand || "generic"}
            className="zp-message-avatar"
            size={20}
          />
        ) : (
          <Icon className="zp-message-avatar" name="brand" size={20} />
        )
      ) : null}
      <div
        className={isAssistant ? "zp-message-stack" : "zp-message-user-stack"}
      >
        {isAssistant ? (
          <>
            {message.model ? (
              <div className="zp-answer-model">
                <span>{message.model}</span>
              </div>
            ) : null}
            <div className="zp-message-body">
              {message.trace?.length ? (
                <TracePanel
                  collapsed
                  items={message.trace || []}
                  onOpenLink={onOpenLink}
                  running={false}
                />
              ) : null}
              {message.text ? (
                <MarkdownView
                  className="zp-message-markdown"
                  markdown={message.text}
                  onOpenLink={onOpenLink}
                />
              ) : null}
            </div>
          </>
        ) : itemContextTitle ||
          message.localAttachments?.length ||
          message.mentions?.length ||
          message.noteContexts?.length ? (
          <div className="zp-message-bubble zp-composer-surface zp-message-user-content">
            <ContextChips
              attachments={message.localAttachments}
              className="zp-message-attachments"
              itemContext={
                itemContextTitle
                  ? { expanded: false, title: itemContextTitle }
                  : undefined
              }
              mentions={messageMentions}
              notes={messageNoteContexts}
            />
            <MarkdownView
              className="zp-message-markdown"
              markdown={message.text}
              onOpenLink={onOpenLink}
            />
          </div>
        ) : (
          <MarkdownView
            className="zp-message-bubble zp-composer-surface zp-message-markdown"
            markdown={message.text}
            onOpenLink={onOpenLink}
          />
        )}
        {isAssistant ? (
          <AssistantFooter
            completedAt={completedAt}
            copied={copiedId === `${message.id}-text`}
            message={message}
            onCopy={() => onCopy(message)}
            responseDuration={message.responseDuration}
          />
        ) : (
          <div className="zp-message-actions">
            <IconAction
              icon="edit"
              label={getString("sidebar-edit-composer")}
              onClick={() => onEdit(message)}
            />
            <IconAction
              disabled={busy}
              icon="resend"
              label={getString("sidebar-resend")}
              onClick={() => onSubmit(message)}
            />
          </div>
        )}
      </div>
    </article>
  );
}

const MemoMessage = memo(Message);

function AssistantFooter({
  completedAt,
  copied,
  message,
  onCopy,
  responseDuration,
}: {
  completedAt?: string;
  copied: boolean;
  message: SidebarMessageView;
  onCopy: () => void;
  responseDuration?: string;
}): ReactElement | null {
  if (message.transient) {
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
        {responseDuration ? (
          <span className="zp-message-duration">{responseDuration}</span>
        ) : null}
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

export { MemoMessage, Message };
