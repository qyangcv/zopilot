import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { ComposerBindings } from "./composerBindings";
import { Icon } from "./Icon";
import { ModelSelector } from "./ModelSelector";
import type { SidebarActions, SidebarState } from "./types";

function ComposerFooter({
  actions,
  bindings,
  state,
}: {
  actions: SidebarActions;
  bindings: ComposerBindings;
  state: SidebarState;
}): ReactElement {
  const {
    addLocalAttachment,
    draft,
    localAttachments,
    mentions,
    promptButtonRef,
    setPromptPickerOpen,
  } = bindings;
  return (
    <div className="zp-composer-footer">
      <div className="zp-composer-meta">
        <button
          aria-label={getString("sidebar-prompts")}
          className="zp-context-add"
          disabled={!state.composerEnabled}
          onClick={(event) => {
            event.stopPropagation();
            setPromptPickerOpen((open) => !open);
          }}
          ref={promptButtonRef}
          title={getString("sidebar-prompts")}
          type="button"
        >
          <Icon name="prompt" size={15} />
        </button>
        <button
          aria-label={getString("sidebar-add-context")}
          className="zp-context-add"
          disabled={!state.context.workspaceKey || state.busy}
          onClick={(event) => {
            event.stopPropagation();
            addLocalAttachment();
          }}
          title={getString("sidebar-add-context")}
          type="button"
        >
          <Icon name="paperclip" size={15} />
        </button>
        {state.backendStatus === "disconnected" ? (
          <span className="zp-backend-status" data-status={state.backendStatus}>
            <Icon className="zp-status-icon" name="disconnected" size={13} />
            {state.backendDiagnosticMessage ||
              getString("sidebar-backend-status-disconnected")}
          </span>
        ) : null}
        {state.backendStatus !== "disconnected" ? (
          <ModelSelector actions={actions} state={state} />
        ) : null}
      </div>
      <button
        aria-label={
          state.busy ? getString("sidebar-stop") : getString("sidebar-send")
        }
        className="zp-send-button"
        disabled={
          !state.composerEnabled ||
          (!state.busy &&
            !draft.trim() &&
            !mentions.length &&
            !localAttachments.length)
        }
        onClick={(event) => {
          if (!state.busy) {
            return;
          }
          event.preventDefault();
          actions.interruptActiveTurn();
        }}
        title={
          state.busy ? getString("sidebar-stop") : getString("sidebar-send")
        }
        type={state.busy ? "button" : "submit"}
      >
        <Icon name={state.busy ? "stop" : "send"} size={15} />
      </button>
    </div>
  );
}

export { ComposerFooter };
