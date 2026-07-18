import {
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { ComposerEditor } from "./ComposerEditor";
import { ComposerFooter } from "./ComposerFooter";
import type { ComposerBindings } from "./composerBindings";
import { PromptPicker } from "./PromptPicker";
import type { SidebarActions, SidebarState } from "./types";
import { FloatingPortal } from "../../../ui/primitives/index";
import { WorkspaceSelector } from "./WorkspaceSelector";
import {
  canReadSidebarDrop,
  readSidebarDropPayload,
} from "../../../integrations/zotero/compat/dragData";

function Composer({
  actions,
  bindings,
  headerBoundaryRef,
  state,
}: {
  actions: SidebarActions;
  bindings: ComposerBindings;
  headerBoundaryRef: RefObject<HTMLElement | null>;
  state: SidebarState;
}): ReactElement {
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const dropEnabled =
    state.composerEnabled && state.context.hostContextKind === "library";
  const acceptDragEvent = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!dropEnabled || !canReadSidebarDrop(event.dataTransfer)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const resetDropState = () => {
    dragDepthRef.current = 0;
    setDropActive(false);
  };

  return (
    <div className="zp-bottom-dock" ref={bindings.bottomDockRef}>
      <form
        aria-busy={state.busy}
        className={[
          "zp-composer",
          "zp-composer-surface",
          dropActive ? "zp-composer-drop-active" : undefined,
        ]
          .filter(Boolean)
          .join(" ")}
        {...(dropEnabled
          ? {
              onDragEnter: (event: ReactDragEvent<HTMLFormElement>) => {
                if (!acceptDragEvent(event)) return;
                dragDepthRef.current += 1;
                setDropActive(true);
              },
              onDragLeave: (event: ReactDragEvent<HTMLFormElement>) => {
                if (!dropEnabled || !dragDepthRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                if (!dragDepthRef.current) setDropActive(false);
              },
              onDragOver: (event: ReactDragEvent<HTMLFormElement>) => {
                if (!acceptDragEvent(event)) return;
                event.dataTransfer.dropEffect = "copy";
              },
              onDrop: (event: ReactDragEvent<HTMLFormElement>) => {
                if (!acceptDragEvent(event)) return;
                const payload = readSidebarDropPayload(event.dataTransfer);
                resetDropState();
                if (payload) bindings.addDroppedContext(payload);
              },
            }
          : {})}
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
          headerBoundaryRef={headerBoundaryRef}
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
      align="stretch"
      anchorRef={bindings.composerRef}
      horizontalBoundaryRef={bindings.bottomDockRef}
      horizontalMargin={0}
      maxWidth={720}
      minWidth={0}
      onDismiss={() => bindings.setPromptPickerOpen(false)}
      preferredSide="above"
      zIndex={9}
    >
      <PromptPicker
        onClose={() => bindings.setPromptPickerOpen(false)}
        onInsert={(body) => {
          bindings.setPromptPickerOpen(false);
          bindings.insertPrompt(body);
        }}
        prompts={state.prompts}
        triggerRef={bindings.promptButtonRef}
      />
    </FloatingPortal>
  );
}

export { Composer, ComposerPromptPicker };
