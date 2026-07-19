import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import {
  l10nAttributes,
  type FluentArgs,
  type LocalizedMessage,
} from "../localization";

export { LocalizedMessageText, PageHeader, PreferenceIconButton, T };

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

function T({
  args,
  id,
}: {
  args?: FluentArgs;
  id: LocalizedMessage["id"];
}): ReactElement {
  return <span {...l10nAttributes(id, args)} />;
}

function LocalizedMessageText({
  message,
}: {
  message: LocalizedMessage;
}): ReactElement {
  return <T args={message.args} id={message.id} />;
}

function PreferenceIconButton({
  children,
  tooltip,
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip: ReactNode;
}): ReactElement {
  return (
    <button {...buttonProps}>
      {children}
      <span className="zp-pref-icon-button-tooltip" role="tooltip">
        {tooltip}
      </span>
    </button>
  );
}
