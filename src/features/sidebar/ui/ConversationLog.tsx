import type { ReactElement, RefObject, UIEventHandler } from "react";
import type {
  LocalAttachmentRef,
  SourceMention,
} from "../../../domain/conversation";
import { Icon } from "./Icon";
import { Message } from "./Message";
import type { SidebarActions, SidebarMessageView, SidebarState } from "./types";

type ConversationLogProps = {
  actions: Pick<SidebarActions, "openExternalLink" | "openReaderLocator">;
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
}: ConversationLogProps): ReactElement {
  const showWelcome = state.messages.length === 0;
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
            How should we approach this paper?
          </p>
          <div className="zp-empty-welcome-hints">
            <p className="zp-empty-welcome-hint">
              <span>使用</span>
              <Icon name="command" size={14} />
              <span>来查看所有可用命令</span>
            </p>
            <p className="zp-empty-welcome-hint">
              <span>使用</span>
              <Icon name="prompt" size={14} />
              <span>插入自定义 prompt</span>
            </p>
            <p className="zp-empty-welcome-hint">
              <span>使用</span>
              <Icon name="add" size={14} />
              <span>添加 PDF 或图片附件</span>
            </p>
            <p className="zp-empty-welcome-hint">
              使用 @ 在文库/合集中选择论文
            </p>
          </div>
        </div>
      ) : null}
      {state.messages.map((message) => (
        <Message
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
          onOpenLocator={actions.openReaderLocator}
          onSubmit={(messageToSubmit) =>
            onSubmit(
              messageToSubmit.text,
              messageToSubmit.mentions || [],
              messageToSubmit.localAttachments || [],
            )
          }
        />
      ))}
    </main>
  );
}

export { ConversationLog };
export type { ConversationLogProps };
