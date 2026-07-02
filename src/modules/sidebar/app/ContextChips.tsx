import type { ReactElement } from "react";
import { getString } from "../../../utils/locale";
import type {
  LocalAttachmentRef,
  SourceMention,
} from "../../../shared/conversation";
import { Icon } from "./Icon";

export function ContextChips({
  attachments = [],
  className,
  mentions = [],
  onRemoveAttachment,
  onRemoveMention,
}: {
  attachments?: LocalAttachmentRef[];
  className?: string;
  mentions?: SourceMention[];
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveMention?: (mentionId: string) => void;
}): ReactElement {
  return (
    <div
      className={["zp-context-chips", "zp-local-attachments", className]
        .filter(Boolean)
        .join(" ")}
    >
      {mentions.map((mention) => (
        <ContextChip
          icon="paperMention"
          key={mention.id}
          label={mention.title}
          onRemove={
            onRemoveMention ? () => onRemoveMention(mention.id) : undefined
          }
          title={mention.title}
        />
      ))}
      {attachments.map((attachment) => (
        <ContextChip
          icon={attachment.kind === "pdf" ? "attachmentPdf" : "attachmentImage"}
          key={attachment.id}
          label={attachment.filename}
          onRemove={
            onRemoveAttachment
              ? () => onRemoveAttachment(attachment.id)
              : undefined
          }
          title={attachment.path}
        />
      ))}
    </div>
  );
}

function ContextChip({
  icon,
  label,
  onRemove,
  title,
}: {
  icon: "attachmentImage" | "attachmentPdf" | "paperMention";
  label: string;
  onRemove?: () => void;
  title: string;
}): ReactElement {
  return (
    <div className="zp-context-chip zp-local-attachment" title={title}>
      {onRemove ? (
        <button
          aria-label={getString("sidebar-attachment-remove")}
          className="zp-context-chip-remove zp-local-attachment-remove"
          onClick={(event) => {
            event.preventDefault();
            onRemove();
          }}
          title={getString("sidebar-attachment-remove")}
          type="button"
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
      <Icon
        className="zp-context-chip-icon zp-local-attachment-icon"
        name={icon}
        size={13}
      />
      <span className="zp-context-chip-text zp-local-attachment-name">
        {label}
      </span>
    </div>
  );
}
