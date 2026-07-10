import { useEffect, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import { Icon } from "./Icon";
import { MarkdownView } from "./MarkdownView";

type ToolTraceItem = Extract<AgentTraceItem, { type: "tool" }>;

type TracePanelProps = {
  collapsed: boolean;
  items: AgentTraceItem[];
  onOpenLink: (url: string) => void;
  running: boolean;
};

export function TracePanel({
  collapsed,
  items,
  onOpenLink,
  running,
}: TracePanelProps): ReactElement {
  const [expanded, setExpanded] = useState(!collapsed);

  useEffect(() => {
    setExpanded(!collapsed);
  }, [collapsed]);

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
      {items.length ? (
        <div className="zp-trace-items">
          {items.map((item) => (
            <TraceItem item={item} key={item.id} onOpenLink={onOpenLink} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function TraceItem({
  item,
  onOpenLink,
}: {
  item: AgentTraceItem;
  onOpenLink: (url: string) => void;
}): ReactElement {
  if (item.type === "tool") {
    return <ToolTrace item={item} />;
  }
  const label =
    item.type === "reasoning" && item.kind === "summary"
      ? getString("sidebar-trace-reasoning-summary")
      : item.type === "notice"
        ? getString("sidebar-trace-notice")
        : undefined;
  return (
    <section className={`zp-trace-item zp-trace-item-${item.type}`}>
      {label ? <div className="zp-trace-item-label">{label}</div> : null}
      <MarkdownView
        className="zp-trace-markdown"
        markdown={item.text}
        onOpenLink={onOpenLink}
      />
    </section>
  );
}

function ToolTrace({ item }: { item: ToolTraceItem }): ReactElement {
  const durationMs = useToolDuration(item);
  const status =
    item.status === "running"
      ? getString("sidebar-trace-tool-running")
      : item.status === "failed"
        ? getString("sidebar-trace-tool-failed")
        : getString("sidebar-trace-tool-completed");
  return (
    <details className="zp-trace-item zp-trace-tool" data-status={item.status}>
      <summary className="zp-trace-tool-header">
        <Icon name="tool" size={13} />
        <code className="zp-trace-tool-name">{item.name}</code>
        <span className="zp-trace-tool-meta">
          {durationMs === undefined ? status : formatDuration(durationMs)}
        </span>
        {item.status !== "running" ? (
          <Icon
            className="zp-trace-tool-status-icon"
            name={item.status === "failed" ? "close" : "check"}
            size={12}
          />
        ) : null}
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
      {item.result ? (
        <TracePayloadValue
          label={getString("sidebar-trace-tool-result")}
          value={item.result}
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

function useToolDuration(item: ToolTraceItem): number | undefined {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (item.status !== "running" || item.startedAt === undefined) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [item.startedAt, item.status]);

  if (item.status === "running" && item.startedAt !== undefined) {
    return Math.max(0, now - item.startedAt);
  }
  return item.durationMs;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1_000;
  if (seconds >= 10) return `${Math.round(seconds)}s`;
  return `${Number(seconds.toFixed(1))}s`;
}
