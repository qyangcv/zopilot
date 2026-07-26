import { memo, useEffect, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import { Icon } from "./Icon";
import { MarkdownView } from "./MarkdownView";
import { StreamingMarkdownView } from "./StreamingMarkdownView";

type ToolTraceItem = Extract<AgentTraceItem, { type: "tool" }>;

type TracePanelProps = {
  collapsed: boolean;
  items: readonly AgentTraceItem[];
  onOpenLink: (url: string) => void;
  running: boolean;
};

const TracePanel = memo(function TracePanel({
  collapsed,
  items,
  onOpenLink,
  running,
}: TracePanelProps): ReactElement {
  const [expanded, setExpanded] = useState(!collapsed);
  const [now, setNow] = useState(() => Date.now());
  const hasRunningTool = items.some(
    (item) => item.type === "tool" && item.status === "running",
  );

  useEffect(() => {
    setExpanded(!collapsed);
  }, [collapsed]);

  useEffect(() => {
    if (!expanded || !hasRunningTool) return;
    setNow(Date.now());
    const timer = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(timer);
  }, [expanded, hasRunningTool]);

  return (
    <details
      className="zp-trace"
      data-running={running || undefined}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      open={expanded}
    >
      <summary className="zp-trace-summary">
        <Icon
          className={running && !collapsed ? "zp-spin" : undefined}
          name={running && !collapsed ? "checking" : "expand"}
          size={13}
        />
        <span>
          {collapsed
            ? getString("sidebar-trace-collapsed")
            : getString(
                items.length
                  ? "sidebar-trace-running"
                  : "sidebar-trace-waiting",
              )}
        </span>
      </summary>
      {expanded && items.length ? (
        <div className="zp-trace-items">
          {items.map((item) => (
            <MemoTraceItem
              item={item}
              key={item.id}
              now={now}
              onOpenLink={onOpenLink}
              streaming={running}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
});

function TraceItem({
  item,
  now,
  onOpenLink,
  streaming,
}: {
  item: AgentTraceItem;
  now?: number;
  onOpenLink: (url: string) => void;
  streaming: boolean;
}): ReactElement {
  if (item.type === "tool") {
    return <ToolTrace item={item} now={now} />;
  }
  const label =
    item.type === "reasoning" && item.kind === "summary"
      ? getString("sidebar-trace-reasoning-summary")
      : item.type === "notice"
        ? getString("sidebar-trace-notice")
        : undefined;
  const MarkdownComponent = streaming ? StreamingMarkdownView : MarkdownView;
  return (
    <section className={`zp-trace-item zp-trace-item-${item.type}`}>
      {label ? <div className="zp-trace-item-label">{label}</div> : null}
      <MarkdownComponent
        className="zp-trace-markdown"
        markdown={item.text}
        onOpenLink={onOpenLink}
      />
    </section>
  );
}

const MemoTraceItem = memo(
  TraceItem,
  (previous, next) =>
    previous.item === next.item &&
    previous.onOpenLink === next.onOpenLink &&
    previous.streaming === next.streaming &&
    (next.item.type !== "tool" ||
      next.item.status !== "running" ||
      previous.now === next.now),
);

function ToolTrace({
  item,
  now,
}: {
  item: ToolTraceItem;
  now?: number;
}): ReactElement {
  const durationMs =
    item.status === "running" &&
    item.startedAt !== undefined &&
    now !== undefined
      ? Math.max(0, now - item.startedAt)
      : item.durationMs;
  return (
    <details className="zp-trace-item zp-trace-tool" data-status={item.status}>
      <summary className="zp-trace-tool-header">
        <Icon name="tool" size={13} />
        <span className="zp-trace-tool-kind">
          {item.kind === "mcp" || item.server === "zopilot"
            ? "zopilot"
            : "codex"}
        </span>
        <code className="zp-trace-tool-name">{item.name}</code>
        {durationMs === undefined ? null : (
          <span className="zp-trace-tool-meta">
            {formatDuration(durationMs)}
          </span>
        )}
      </summary>
      <div className="zp-trace-tool-body">
        <ToolPayloads item={item} />
      </div>
    </details>
  );
}

function ToolPayloads({ item }: { item: ToolTraceItem }): ReactElement {
  return (
    <>
      <ToolProgress item={item} />
      <ToolPayloadValues item={item} />
    </>
  );
}

function ToolProgress({ item }: { item: ToolTraceItem }): ReactElement | null {
  return item.progress ? (
    <pre className="zp-trace-progress">{item.progress}</pre>
  ) : null;
}

function ToolPayloadValues({ item }: { item: ToolTraceItem }): ReactElement {
  return (
    <>
      {item.arguments ? (
        <TracePayloadValue
          label={getString("sidebar-trace-tool-arguments")}
          value={item.arguments}
        />
      ) : null}
      {item.risk ? (
        <TracePayloadValue
          label={getString("sidebar-trace-tool-risk")}
          value={formatToolRisk(item.risk)}
        />
      ) : null}
      {item.result ? (
        <TracePayloadValue
          label={getString("sidebar-trace-tool-result")}
          value={item.result}
        />
      ) : null}
      {item.structuredContent !== undefined ? (
        <TracePayloadValue
          label={getString("sidebar-trace-tool-structured-result")}
          value={JSON.stringify(item.structuredContent, null, 2)}
        />
      ) : null}
      {item.error ? (
        <TracePayloadValue
          error
          label={getString("sidebar-trace-tool-error")}
          value={item.error}
        />
      ) : null}
    </>
  );
}

function TracePayloadValue({
  error = false,
  label,
  value,
}: {
  error?: boolean;
  label: string;
  value: string;
}): ReactElement {
  return (
    <section className="zp-trace-payload-value" data-error={error || undefined}>
      <div>{label}</div>
      <pre>{value}</pre>
    </section>
  );
}

function formatToolRisk(risk: ToolTraceItem["risk"]): string {
  switch (risk) {
    case "read-only":
      return getString("sidebar-trace-tool-risk-read-only");
    case "network":
      return getString("sidebar-trace-tool-risk-network");
    case "write":
      return getString("sidebar-trace-tool-risk-write");
    default:
      return getString("sidebar-trace-tool-risk-unknown");
  }
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0.1, durationMs / 1_000);
  return `${seconds.toFixed(1)}s`;
}

export { TracePanel };
