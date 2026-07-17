import { memo, useMemo, type ReactElement } from "react";
import {
  splitStreamingMarkdown,
  type StreamingMarkdownSegment,
} from "./markdownRenderer";
import { MarkdownView } from "./MarkdownView";

type StreamingMarkdownViewProps = {
  className?: string;
  markdown: string;
  onOpenLink: (url: string) => void;
};

function StreamingMarkdownView({
  className,
  markdown,
  onOpenLink,
}: StreamingMarkdownViewProps): ReactElement {
  const segments = useMemo(() => splitStreamingMarkdown(markdown), [markdown]);
  return (
    <div
      className={["zp-markdown-rendered", className].filter(Boolean).join(" ")}
      data-zp-streaming-markdown=""
    >
      {segments.map((segment) => (
        <MemoStreamingMarkdownSegment
          key={segment.id}
          onOpenLink={onOpenLink}
          segment={segment}
        />
      ))}
    </div>
  );
}

const MemoStreamingMarkdownSegment = memo(
  function StreamingMarkdownSegmentView({
    onOpenLink,
    segment,
  }: {
    onOpenLink: (url: string) => void;
    segment: StreamingMarkdownSegment;
  }): ReactElement {
    return (
      <MarkdownView
        className="zp-markdown-segment"
        markdown={segment.text}
        onOpenLink={onOpenLink}
        segmentId={segment.id}
      />
    );
  },
  (previous, next) =>
    previous.onOpenLink === next.onOpenLink &&
    previous.segment.id === next.segment.id &&
    previous.segment.text === next.segment.text,
);

export { StreamingMarkdownView };
export type { StreamingMarkdownViewProps };
