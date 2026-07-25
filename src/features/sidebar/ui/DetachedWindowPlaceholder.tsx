import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon } from "./Icon";
import type { SidebarActions } from "./types";

function DetachedWindowPlaceholder({
  actions,
}: {
  actions: Pick<SidebarActions, "openInWindow">;
}): ReactElement {
  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zp-sidebar"
      data-presentation="placeholder"
      role="complementary"
    >
      <header className="zp-sidebar-header">
        <div className="zp-sidebar-identity">
          <Icon name="brand" size={16} />
          <span className="zp-sidebar-title">{getString("sidebar-title")}</span>
        </div>
      </header>
      <main className="zp-detached-placeholder">
        <Icon name="openInWindow" size={24} />
        <p className="zp-detached-placeholder-title">
          {getString("sidebar-window-placeholder")}
        </p>
        <button
          className="zp-detached-placeholder-action"
          onClick={actions.openInWindow}
          type="button"
        >
          {getString("sidebar-window-focus")}
        </button>
      </main>
    </aside>
  );
}

export { DetachedWindowPlaceholder };
