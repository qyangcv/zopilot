import type { ReactElement, RefObject } from "react";
import { getString } from "../../../app/localization";
import type { WorkspaceType } from "../../../domain/conversation";
import { Icon, type IconName } from "./Icon";
import type { SidebarActions, SidebarState } from "./types";
import { useWorkspaceMenuState } from "./workspace/useWorkspaceMenuState";
import { WorkspaceMenu } from "./workspace/WorkspaceMenu";

function WorkspaceSelector({
  actions,
  horizontalBoundaryRef,
  state,
}: {
  actions: SidebarActions;
  horizontalBoundaryRef?: RefObject<HTMLElement | null>;
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
          if (model.open) model.setOpen(false);
          else model.openToCurrentWorkspace();
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
          name={getWorkspaceIconName(model.workspaceType)}
          size={15}
        />
        <span className="zp-workspace-trigger-text">
          {model.workspaceLabel}
        </span>
        {model.workspaceItemCount === undefined ? null : (
          <span className="zp-workspace-trigger-count">
            {model.workspaceItemCount.toLocaleString()}
          </span>
        )}
        <Icon
          className="zp-workspace-trigger-chevron"
          name={model.open ? "collapse" : "expand"}
          size={12}
        />
      </button>
      <WorkspaceMenu
        horizontalBoundaryRef={horizontalBoundaryRef}
        model={model}
        state={state}
      />
    </div>
  );
}

function getWorkspaceIconName(workspaceType: WorkspaceType): IconName {
  if (workspaceType === "library") return "workspaceLibrary";
  if (workspaceType === "collection") return "workspaceCollection";
  return "workspaceItem";
}

export { WorkspaceSelector };
