import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import { CommandMenu } from "./CommandMenu";
import type { ComposerBindings } from "./composerBindings";
import { resizeTextarea } from "./composerLayout";
import { ContextChips } from "./ContextChips";
import { MentionPopover } from "./MentionPopover";
import { MAX_SOURCE_MENTIONS, findMentionQuery } from "./mentions";
import type { SidebarState } from "./types";
import { FloatingPortal } from "./primitives/index";

const ZOTERO_NO_NATIVE_INPUT_PROPS = { "no-native": "true" } as const;

function ComposerEditor({
  bindings,
  state,
}: {
  bindings: ComposerBindings;
  state: SidebarState;
}): ReactElement {
  const {
    commandAnchor,
    commandAnchorRef,
    commandOpen,
    draft,
    executeCommand,
    localAttachments,
    mentionCandidates,
    mentions,
    removeLocalAttachment,
    removeMention,
    selectMention,
    setCommandOpen,
    setMentionQuery,
    submit,
    textareaRef,
    updateDraft,
    visibleCommands,
  } = bindings;
  return (
    <>
      {mentions.length || localAttachments.length ? (
        <div className="zp-context-row">
          <div aria-label={getString("sidebar-attachment-context")}>
            <ContextChips
              attachments={localAttachments}
              mentions={mentions}
              onRemoveAttachment={removeLocalAttachment}
              onRemoveMention={removeMention}
            />
          </div>
        </div>
      ) : null}
      {mentionCandidates.length ? (
        <FloatingPortal
          align="stretch"
          anchorRef={textareaRef}
          maxHeight={320}
          maxWidth={720}
          minWidth={0}
          onDismiss={() => setMentionQuery(null)}
          preferredSide="above"
          zIndex={7}
        >
          <MentionPopover
            candidates={mentionCandidates}
            disabled={mentions.length >= MAX_SOURCE_MENTIONS}
            onClose={() => setMentionQuery(null)}
            onSelect={selectMention}
          />
        </FloatingPortal>
      ) : null}
      {commandOpen ? (
        <FloatingPortal
          align={commandAnchor === "input" ? "stretch" : "start"}
          anchorRef={commandAnchorRef}
          maxWidth={520}
          minWidth={commandAnchor === "input" ? 0 : 280}
          onDismiss={() => setCommandOpen(false)}
          preferredSide="above"
          width={commandAnchor === "input" ? undefined : 360}
          zIndex={8}
        >
          <CommandMenu
            commands={visibleCommands}
            onClose={() => setCommandOpen(false)}
            onSelect={executeCommand}
          />
        </FloatingPortal>
      ) : null}
      <textarea
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="zp-composer-input"
        disabled={!state.composerEnabled}
        {...ZOTERO_NO_NATIVE_INPUT_PROPS}
        onChange={(event) =>
          updateDraft(
            event.currentTarget.value,
            event.currentTarget.selectionStart ?? undefined,
          )
        }
        onClick={(event) =>
          setMentionQuery(
            findMentionQuery(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? 0,
            ),
          )
        }
        onInput={(event) => resizeTextarea(event.currentTarget)}
        onKeyDown={(event) => {
          if (mentionCandidates.length) {
            if (event.key === "Escape") {
              event.preventDefault();
              setMentionQuery(null);
              return;
            }
            if (event.key === "Tab" || event.key === "Enter") {
              event.preventDefault();
              selectMention(mentionCandidates[0]!);
              return;
            }
          }
          if (commandOpen) {
            if (event.key === "Escape") {
              event.preventDefault();
              setCommandOpen(false);
              return;
            }
            if (
              (event.key === "Tab" || event.key === "Enter") &&
              visibleCommands[0]?.available
            ) {
              event.preventDefault();
              executeCommand(visibleCommands[0]!);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={getString("sidebar-input-placeholder")}
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        value={draft}
      />
    </>
  );
}

export { ComposerEditor };
