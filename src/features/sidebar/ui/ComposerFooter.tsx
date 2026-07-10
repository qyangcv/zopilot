import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { ComposerBindings } from "./composerBindings";
import { Icon } from "./Icon";
import type { SidebarActions, SidebarState } from "./types";
import { Select } from "./primitives/index";

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
    commandButtonRef,
    commandOpen,
    draft,
    localAttachments,
    mentions,
    promptButtonRef,
    setCommandAnchor,
    setCommandOpen,
    setCommandQuery,
    setPromptPickerOpen,
  } = bindings;
  return (
    <div className="zp-composer-footer">
      <div className="zp-composer-meta">
        <button
          aria-label={getString("sidebar-command-menu")}
          aria-expanded={commandOpen}
          aria-haspopup="dialog"
          className="zp-context-add"
          disabled={!state.composerEnabled}
          onClick={(event) => {
            event.stopPropagation();
            setCommandAnchor("button");
            setCommandOpen((open) => !open);
            setCommandQuery("");
          }}
          ref={commandButtonRef}
          title={getString("sidebar-command-menu")}
          type="button"
        >
          <Icon name="command" size={15} />
        </button>
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
          <Icon name="add" size={15} />
        </button>
        {state.backendStatus !== "connected" ? (
          <span className="zp-backend-status" data-status={state.backendStatus}>
            <Icon
              className="zp-status-icon"
              name={
                state.backendStatus === "checking" ? "checking" : "disconnected"
              }
              size={13}
            />
            {state.backendStatus === "checking"
              ? getString("sidebar-backend-status-checking")
              : state.backendDiagnosticMessage ||
                getString("sidebar-backend-status-disconnected")}
          </span>
        ) : null}
        {state.backendStatus === "connected" ? (
          <>
            <Select
              aria-label={getString("sidebar-model-name")}
              disabled={!state.models.length}
              onChange={actions.selectModel}
              options={state.models.map((model) => ({
                groupLabel: model.providerLabel,
                label: model.displayName,
                value: createModelSelectValue(
                  model.providerProfileId,
                  model.slug,
                ),
              }))}
              showIndicator={false}
              title={getString("sidebar-model-name")}
              value={createModelSelectValue(
                state.selectedProviderId,
                state.selectedModel,
              )}
            />
            {state.availableReasoningEfforts.length ? (
              <Select
                aria-label={getString("sidebar-reasoning-depth")}
                onChange={actions.selectReasoningEffort}
                options={state.availableReasoningEfforts.map((effort) => ({
                  label: formatEffortLabel(effort),
                  value: effort,
                }))}
                popupMinWidth={96}
                showIndicator={false}
                title={getString("sidebar-reasoning-depth")}
                value={state.selectedReasoningEffort || ""}
              />
            ) : null}
          </>
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

function formatEffortLabel(effort: string): string {
  return effort.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase());
}

function createModelSelectValue(
  providerProfileId: string,
  model: string,
): string {
  return `${providerProfileId}\u0000${model}`;
}

export { ComposerFooter };
