import type { ReactElement, ReactNode } from "react";
import {
  l10nAttributes,
  type FluentArgs,
  type LocalizedMessage,
} from "../localization";

export { LocalizedMessageText, NavButton, PageHeader, T };

function PageHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}): ReactElement {
  return (
    <header className="zp-pref-page-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="zp-pref-page-action">{action}</div> : null}
    </header>
  );
}

function NavButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="zp-pref-nav-item"
      data-active={active || undefined}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
      {count ? <span className="zp-pref-nav-count">{count}</span> : null}
    </button>
  );
}

function T({
  args,
  children,
  id,
}: {
  args?: FluentArgs;
  children?: ReactNode;
  id: LocalizedMessage["id"];
}): ReactElement {
  return <span {...l10nAttributes(id, args)}>{children}</span>;
}

function LocalizedMessageText({
  children,
  message,
}: {
  children?: ReactNode;
  message: LocalizedMessage;
}): ReactElement {
  return (
    <T args={message.args} id={message.id}>
      {children}
    </T>
  );
}
