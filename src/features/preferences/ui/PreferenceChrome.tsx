import type { ReactElement, ReactNode } from "react";
import { config } from "../../../../package.json";

export { NavButton, PageHeader, T };

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
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}): ReactElement {
  return <span data-l10n-id={getLocalizedId(id)}>{children}</span>;
}

function getLocalizedId(id: string): string {
  return id.startsWith(`${config.addonRef}-`) ? id : `${config.addonRef}-${id}`;
}
