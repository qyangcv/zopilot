import { useEffect, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import { Icon } from "./Icon";
import { MarkdownView } from "./MarkdownView";

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
            : getString("sidebar-trace-running")}
        </span>
      </summary>
      <div className="zp-trace-items">
        {items.length ? (
          items.map((item) => (
            <TraceItem item={item} key={item.id} onOpenLink={onOpenLink} />
          ))
        ) : (
          <div className="zp-trace-waiting">
            {getString("sidebar-trace-waiting")}
          </div>
        )}
      </div>
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
    item.type === "reasoning"
      ? item.kind === "summary"
        ? getString("sidebar-trace-reasoning-summary")
        : getString("sidebar-trace-reasoning")
      : item.type === "commentary"
        ? getString("sidebar-trace-commentary")
        : getString("sidebar-trace-notice");
  return (
    <section className={`zp-trace-item zp-trace-item-${item.type}`}>
      <div className="zp-trace-item-label">{label}</div>
      <MarkdownView
        className="zp-trace-markdown"
        markdown={item.text}
        onOpenLink={onOpenLink}
      />
    </section>
  );
}

function ToolTrace({
  item,
}: {
  item: Extract<AgentTraceItem, { type: "tool" }>;
}): ReactElement {
  const status =
    item.status === "running"
      ? getString("sidebar-trace-tool-running")
      : item.status === "failed"
        ? getString("sidebar-trace-tool-failed")
        : getString("sidebar-trace-tool-completed");
  return (
    <section className="zp-trace-item zp-trace-tool" data-status={item.status}>
      <div className="zp-trace-tool-header">
        <Icon
          className={item.status === "running" ? "zp-spin" : undefined}
          name={
            item.status === "running"
              ? "checking"
              : item.status === "failed"
                ? "disconnected"
                : "check"
          }
          size={13}
        />
        <code>{[item.server, item.name].filter(Boolean).join(" · ")}</code>
        <span>{status}</span>
      </div>
      {item.progress ? (
        <pre className="zp-trace-progress">{item.progress}</pre>
      ) : null}
      {item.arguments ? (
        <TracePayload
          label={getString("sidebar-trace-tool-arguments")}
          value={item.arguments}
        />
      ) : null}
      {item.result ? (
        <TracePayload
          label={getString("sidebar-trace-tool-result")}
          value={item.result}
        />
      ) : null}
      {item.error ? (
        <TracePayload
          error
          label={getString("sidebar-trace-tool-error")}
          value={item.error}
        />
      ) : null}
    </section>
  );
}

function TracePayload({
  error = false,
  label,
  value,
}: {
  error?: boolean;
  label: string;
  value: string;
}): ReactElement {
  return (
    <details className="zp-trace-payload" data-error={error || undefined}>
      <summary>{label}</summary>
      <pre>{value}</pre>
    </details>
  );
}
