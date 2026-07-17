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
import { StreamingMarkdownView } from "./StreamingMarkdownView";
import type { SidebarModelView } from "./types";
import type { SidebarStreamSnapshotStore } from "./SidebarStreamSnapshotStore";
import { TracePanel } from "./TracePanel";

type ActiveStreamingMessageProps = {
  conversationId?: string;
  models: SidebarModelView[];
  onOpenLink: (url: string) => void;
  streamStore: SidebarStreamSnapshotStore;
  syncScroll: () => void;
};

const ActiveStreamingMessage = memo(function ActiveStreamingMessage({
  conversationId,
  models,
  onOpenLink,
  streamStore,
  syncScroll,
}: ActiveStreamingMessageProps): ReactElement | null {
  const snapshot = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getSnapshot,
  );
  const activeSnapshot =
    snapshot?.conversationId === conversationId ? snapshot : undefined;
  const activeConversationId = activeSnapshot?.conversationId;
  const traceCollapsed = activeSnapshot
    ? activeSnapshot.finalStarted ||
      (activeSnapshot.lifecycle !== "running" &&
        activeSnapshot.lifecycle !== "interrupting")
    : undefined;

  useLayoutEffect(() => {
    if (activeConversationId) syncScroll();
  }, [
    activeSnapshot?.answerBlocks,
    activeSnapshot?.traceBlocks,
    activeConversationId,
    syncScroll,
    traceCollapsed,
  ]);

  if (!activeSnapshot) return null;

  const model = resolveModelDisplayName(
    models,
    activeSnapshot.model,
    activeSnapshot.providerProfileId,
  );
  const running =
    activeSnapshot.lifecycle === "running" ||
    activeSnapshot.lifecycle === "interrupting";

  return (
    <article
      className="zp-message zp-message-assistant"
      data-status={
        activeSnapshot.lifecycle === "interrupted"
          ? "interrupted"
          : activeSnapshot.lifecycle === "failed"
            ? "error"
            : "complete"
      }
    >
      {model ? (
        <ProviderBrandIcon
          brand={activeSnapshot.providerBrand || "generic"}
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
          {running || activeSnapshot.traceBlocks.length ? (
            <TracePanel
              collapsed={Boolean(traceCollapsed)}
              items={activeSnapshot.traceBlocks}
              onOpenLink={onOpenLink}
              running={running}
            />
          ) : null}
          {activeSnapshot.answerBlocks.map((block) => (
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
      <StreamingMarkdownView
        className="zp-message-markdown"
        markdown={block.text}
        onOpenLink={onOpenLink}
      />
    );
  },
  (previous, next) =>
    previous.block === next.block && previous.onOpenLink === next.onOpenLink,
);

export { ActiveStreamingMessage };
export type { ActiveStreamingMessageProps };
