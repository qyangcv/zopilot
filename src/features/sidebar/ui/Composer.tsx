import type { ReactElement } from "react";
import { ComposerEditor } from "./ComposerEditor";
import { ComposerFooter } from "./ComposerFooter";
import type { ComposerBindings } from "./composerBindings";
import { PromptPicker } from "./PromptPicker";
import type { SidebarActions, SidebarState } from "./types";
import { FloatingPortal } from "../../../ui/primitives/index";
import { WorkspaceSelector } from "./WorkspaceSelector";

function Composer({
  actions,
  bindings,
  state,
}: {
  actions: SidebarActions;
  bindings: ComposerBindings;
  state: SidebarState;
}): ReactElement {
  return (
    <div className="zp-bottom-dock" ref={bindings.bottomDockRef}>
      <form
        aria-busy={state.busy}
        className="zp-composer zp-composer-surface"
        onSubmit={(event) => {
          event.preventDefault();
          bindings.submit();
        }}
        ref={bindings.composerRef}
      >
        <ComposerEditor bindings={bindings} state={state} />
        <ComposerFooter actions={actions} bindings={bindings} state={state} />
      </form>
      <div className="zp-workspace-status-row">
        <WorkspaceSelector
          actions={actions}
          horizontalBoundaryRef={bindings.bottomDockRef}
          state={state}
        />
      </div>
    </div>
  );
}

function ComposerPromptPicker({
  bindings,
  state,
}: {
  bindings: ComposerBindings;
  state: SidebarState;
}): ReactElement | null {
  if (!bindings.promptPickerOpen) {
    return null;
  }
  return (
    <FloatingPortal
      align="start"
      anchorRef={bindings.promptButtonRef}
      maxWidth={420}
      minWidth={300}
      onDismiss={() => bindings.setPromptPickerOpen(false)}
      preferredSide="above"
      width={380}
      zIndex={9}
    >
      <PromptPicker
        onClose={() => bindings.setPromptPickerOpen(false)}
        onInsert={(body) => {
          bindings.setPromptPickerOpen(false);
          bindings.insertPrompt(body);
        }}
        prompts={state.prompts}
      />
    </FloatingPortal>
  );
}

export { Composer, ComposerPromptPicker };
export type { ComposerBindings } from "./composerBindings";
