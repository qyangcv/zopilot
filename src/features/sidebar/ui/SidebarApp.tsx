import { useRef, useState, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { copyText } from "./clipboard";
import { Composer, ComposerPromptPicker } from "./Composer";
import { ConversationLog } from "./ConversationLog";
import { SidebarHeader } from "./SidebarHeader";
import { useAutoScroll } from "./hooks/useAutoScroll";
import { useComposerDraft } from "./hooks/useComposerDraft";
import { useSidebarLayoutBounds } from "./hooks/useSidebarLayoutBounds";
import type { SidebarActions, SidebarMessageView, SidebarState } from "./types";

export { Message } from "./Message";

export function SidebarApp({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const composer = useComposerDraft(actions, state);
  const autoScroll = useAutoScroll(state.messages);
  useSidebarLayoutBounds(headerRef, composer.bindings.bottomDockRef);

  const copyMessage = (message: SidebarMessageView) => {
    void copyText(message.text).then(() => {
      setCopiedId(`${message.id}-text`);
      globalThis.setTimeout(() => setCopiedId(null), 900);
    });
  };

  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zp-sidebar"
      role="complementary"
    >
      <SidebarHeader
        actions={actions}
        archiveButtonRef={archiveButtonRef}
        headerRef={headerRef}
        historyButtonRef={historyButtonRef}
        state={state}
      />
      <ComposerPromptPicker bindings={composer.bindings} state={state} />
      <ConversationLog
        actions={actions}
        copiedId={copiedId}
        logRef={autoScroll.logRef}
        onCopy={copyMessage}
        onEdit={composer.insertPrompt}
        onScroll={(event) => autoScroll.onScroll(event.currentTarget)}
        onSubmit={composer.submit}
        state={state}
      />
      <Composer
        actions={actions}
        bindings={composer.bindings}
        headerBoundaryRef={headerRef}
        state={state}
      />
    </aside>
  );
}
