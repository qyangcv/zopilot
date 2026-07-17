import type { ReactElement, RefObject, UIEventHandler } from "react";
import type {
  LocalAttachmentRef,
  SourceMention,
} from "../../../domain/conversation";
import { getString } from "../../../app/localization";
import { Icon } from "./Icon";
import { MemoMessage } from "./Message";
import { ActiveStreamingMessage } from "./ActiveStreamingMessage";
import type { SidebarStreamSnapshotStore } from "./SidebarStreamSnapshotStore";
import type { SidebarActions, SidebarMessageView, SidebarState } from "./types";

type ConversationLogProps = {
  actions: Pick<SidebarActions, "openExternalLink">;
  copiedId: string | null;
  logRef: RefObject<HTMLElement | null>;
  onCopy: (message: SidebarMessageView) => void;
  onEdit: (
    text: string,
    mentions: SourceMention[],
    attachments: LocalAttachmentRef[],
  ) => void;
  onScroll: UIEventHandler<HTMLElement>;
  onSubmit: (
    text: string,
    mentions: SourceMention[],
    attachments: LocalAttachmentRef[],
  ) => void;
  state: SidebarState;
  streamStore: SidebarStreamSnapshotStore;
  syncStreamingScroll: () => void;
};

function ConversationLog({
  actions,
  copiedId,
  logRef,
  onCopy,
  onEdit,
  onScroll,
  onSubmit,
  state,
  streamStore,
  syncStreamingScroll,
}: ConversationLogProps): ReactElement {
  const showWelcome = state.composerEnabled && state.messages.length === 0;
  return (
    <main
      aria-live="polite"
      className="zp-chat-log"
      data-empty={showWelcome || undefined}
      onScroll={onScroll}
      ref={logRef}
      role="log"
    >
      {showWelcome ? (
        <div className="zp-empty-welcome">
          <p className="zp-empty-welcome-title">
            {getString("sidebar-welcome-message")}
          </p>
          <div className="zp-empty-welcome-hints">
            <p className="zp-empty-welcome-hint">
              <span>{getString("sidebar-welcome-use")}</span>
              <Icon name="prompt" size={14} />
              <span>{getString("sidebar-welcome-prompt-hint")}</span>
            </p>
            <p className="zp-empty-welcome-hint">
              <span>{getString("sidebar-welcome-use")}</span>
              <Icon name="paperclip" size={14} />
              <span>{getString("sidebar-welcome-attachment-hint")}</span>
            </p>
            <p className="zp-empty-welcome-hint">
              <span>{getString("sidebar-welcome-input")}</span>
              <Icon name="atSign" size={14} />
              <span>{getString("sidebar-welcome-mention-hint")}</span>
            </p>
          </div>
        </div>
      ) : null}
      {state.messages.map((message) => (
        <MemoMessage
          busy={state.busy}
          copiedId={copiedId}
          key={message.id}
          message={message}
          onCopy={onCopy}
          onEdit={(messageToEdit) => {
            onEdit(
              messageToEdit.text,
              messageToEdit.mentions || [],
              messageToEdit.localAttachments || [],
            );
          }}
          onOpenLink={actions.openExternalLink}
          onSubmit={(messageToSubmit) =>
            onSubmit(
              messageToSubmit.text,
              messageToSubmit.mentions || [],
              messageToSubmit.localAttachments || [],
            )
          }
        />
      ))}
      <ActiveStreamingMessage
        conversationId={state.conversationId}
        models={state.models}
        onOpenLink={actions.openExternalLink}
        streamStore={streamStore}
        syncScroll={syncStreamingScroll}
      />
    </main>
  );
}

export { ConversationLog };
export type { ConversationLogProps };
