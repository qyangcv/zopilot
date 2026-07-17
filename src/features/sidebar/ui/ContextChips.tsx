import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import type {
  LocalAttachmentRef,
  NoteContextRef,
  SourceMention,
} from "../../../domain/conversation";
import { Icon, type IconName } from "./Icon";

export function ContextChips({
  attachments = [],
  className,
  itemContext,
  mentions = [],
  notes = [],
  onOpenItemContext,
  onRemoveAttachment,
  onRemoveMention,
  onRemoveNote,
}: {
  attachments?: LocalAttachmentRef[];
  className?: string;
  itemContext?: {
    expanded: boolean;
    title: string;
  };
  mentions?: SourceMention[];
  notes?: NoteContextRef[];
  onOpenItemContext?: () => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveMention?: (mentionId: string) => void;
  onRemoveNote?: (noteId: string) => void;
}): ReactElement {
  return (
    <div
      className={["zp-context-chips", "zp-local-attachments", className]
        .filter(Boolean)
        .join(" ")}
    >
      {itemContext ? (
        <CompactContextChip
          ariaLabel={getString("sidebar-item-context-open")}
          expanded={itemContext.expanded}
          icon="workspaceItem"
          label={itemContext.title}
          onActivate={onOpenItemContext}
          title={itemContext.title}
        />
      ) : null}
      {mentions.map((mention) => (
        <CompactContextChip
          icon="paperMention"
          key={mention.id}
          label={mention.title}
          onRemove={
            onRemoveMention ? () => onRemoveMention(mention.id) : undefined
          }
          title={mention.title}
        />
      ))}
      {notes.map((note) => (
        <CompactContextChip
          icon="noteContext"
          key={note.id}
          label={note.title}
          onRemove={onRemoveNote ? () => onRemoveNote(note.id) : undefined}
          title={note.title}
        />
      ))}
      {attachments.map((attachment) => (
        <CompactContextChip
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

function CompactContextChip({
  ariaLabel,
  expanded,
  icon,
  label,
  onActivate,
  onRemove,
  title,
}: {
  ariaLabel?: string;
  expanded?: boolean;
  icon: IconName;
  label: string;
  onActivate?: () => void;
  onRemove?: () => void;
  title: string;
}): ReactElement {
  const content = (
    <>
      {onRemove ? (
        <button
          aria-label={getString("sidebar-context-remove")}
          className="zp-context-chip-remove"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          title={getString("sidebar-context-remove")}
          type="button"
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
      <Icon className="zp-context-chip-icon" name={icon} size={12} />
      <span className="zp-context-chip-text">{label}</span>
    </>
  );
  const className = [
    "zp-context-chip",
    "zp-compact-context-chip",
    onActivate ? "zp-context-chip-trigger" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  if (onActivate) {
    return (
      <button
        aria-expanded={expanded}
        aria-haspopup="tree"
        aria-label={ariaLabel}
        className={className}
        onClick={onActivate}
        title={title}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <div
      className={className}
      data-removable={onRemove ? true : undefined}
      title={title}
    >
      {content}
    </div>
  );
}
