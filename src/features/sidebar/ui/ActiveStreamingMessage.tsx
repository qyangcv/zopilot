import {
  memo,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { RunningTurnContentBlock } from "../../../domain/agent/streaming";
import { ProviderBrandIcon } from "../../../ui/ProviderBrandIcon";
import { resolveModelDisplayName } from "../state/viewModel";
import { Icon } from "./Icon";
import { MarkdownView } from "./MarkdownView";
import type { SidebarModelView } from "./types";
import type { SidebarStreamSnapshotStore } from "./SidebarStreamSnapshotStore";
import { TracePanel } from "./TracePanel";

type ActiveStreamingMessageProps = {
  conversationId?: string;
  models: SidebarModelView[];
  onOpenLink: (url: string) => void;
  streamStore: SidebarStreamSnapshotStore;
};

const ActiveStreamingMessage = memo(function ActiveStreamingMessage({
  conversationId,
  models,
  onOpenLink,
  streamStore,
}: ActiveStreamingMessageProps): ReactElement | null {
  const snapshot = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getSnapshot,
  );
  if (!snapshot || snapshot.conversationId !== conversationId) return null;

  const model = resolveModelDisplayName(
    models,
    snapshot.model,
    snapshot.providerProfileId,
  );
  const running =
    snapshot.lifecycle === "running" || snapshot.lifecycle === "interrupting";

  return (
    <article
      className="zp-message zp-message-assistant"
      data-status={
        snapshot.lifecycle === "interrupted"
          ? "interrupted"
          : snapshot.lifecycle === "failed"
            ? "error"
            : "complete"
      }
    >
      {model ? (
        <ProviderBrandIcon
          brand={snapshot.providerBrand || "generic"}
          className="zp-message-avatar"
          size={20}
        />
      ) : (
        <Icon className="zp-message-avatar" name="brand" size={20} />
      )}
      <div className="zp-message-stack">
        {model ? (
          <div className="zp-answer-model">
            <span>{model}</span>
          </div>
        ) : null}
        <div className="zp-message-body">
          {running || snapshot.traceBlocks.length ? (
            <TracePanel
              collapsed={snapshot.finalStarted || !running}
              items={snapshot.traceBlocks}
              now={snapshot.publishedAt}
              onOpenLink={onOpenLink}
              running={running}
            />
          ) : null}
          {snapshot.answerBlocks.map((block) => (
            <StreamingMarkdownBlock
              block={block}
              key={block.id}
              onOpenLink={onOpenLink}
            />
          ))}
        </div>
      </div>
    </article>
  );
});

const StreamingMarkdownBlock = memo(
  function StreamingMarkdownBlock({
    block,
    onOpenLink,
  }: {
    block: RunningTurnContentBlock;
    onOpenLink: (url: string) => void;
  }): ReactElement {
    return (
      <MarkdownView
        className="zp-message-markdown"
        markdown={block.text}
        onOpenLink={onOpenLink}
      />
    );
  },
  (previous, next) =>
    previous.block === next.block && previous.onOpenLink === next.onOpenLink,
);

function StreamingScrollSync({
  conversationId,
  streamStore,
  sync,
}: {
  conversationId?: string;
  streamStore: SidebarStreamSnapshotStore;
  sync: () => void;
}): null {
  const snapshot = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getSnapshot,
  );

  useLayoutEffect(() => {
    if (snapshot?.conversationId === conversationId) sync();
  }, [conversationId, snapshot?.publicationVersion, sync]);

  return null;
}

export { ActiveStreamingMessage, StreamingScrollSync };
export type { ActiveStreamingMessageProps };
