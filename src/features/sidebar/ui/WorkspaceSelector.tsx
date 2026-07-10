import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon } from "./Icon";
import type { SidebarActions, SidebarState } from "./types";
import { useWorkspaceMenuState } from "./workspace/useWorkspaceMenuState";
import { WorkspaceMenu } from "./workspace/WorkspaceMenu";

function WorkspaceSelector({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const model = useWorkspaceMenuState(actions, state);
  return (
    <div
      className="zp-workspace-selector"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={getString("sidebar-workspace-current")}
        aria-expanded={model.open}
        aria-haspopup="menu"
        className="zp-workspace-trigger"
        data-popup-open={model.open || undefined}
        data-workspace-type={model.workspaceType}
        disabled={!model.hasWorkspace}
        onClick={() => {
          if (!model.open) model.collapseAllCollections();
          model.setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") model.setOpen(false);
        }}
        ref={model.triggerRef}
        title={model.workspaceTooltip}
        type="button"
      >
        <Icon
          className="zp-workspace-trigger-icon"
          name="workspace"
          size={15}
        />
        <span className="zp-workspace-trigger-main">
          <span className="zp-workspace-trigger-label">
            {getString("sidebar-chat-workspace")}
          </span>
          <span className="zp-workspace-trigger-text">
            {model.workspaceLabel}
          </span>
        </span>
        <span className="zp-workspace-type-badge">
          {model.workspaceTypeLabel}
        </span>
        <Icon
          className="zp-workspace-trigger-chevron"
          name={model.open ? "collapse" : "expand"}
          size={12}
        />
      </button>
      <WorkspaceMenu model={model} state={state} />
    </div>
  );
}

export { WorkspaceSelector };
