import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
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
    draft,
    localAttachments,
    mentionCandidates,
    mentions,
    removeLocalAttachment,
    removeMention,
    selectMention,
    setMentionQuery,
    submit,
    textareaRef,
    updateDraft,
  } = bindings;
  const activeMention =
    mentionCandidates[bindings.activeMentionIndex] || mentionCandidates[0];
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
            activeIndex={bindings.activeMentionIndex}
            candidates={mentionCandidates}
            disabled={mentions.length >= MAX_SOURCE_MENTIONS}
            onClose={() => setMentionQuery(null)}
            onSelect={selectMention}
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
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              bindings.moveMentionSelection(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMentionQuery(null);
              return;
            }
            if (event.key === "Tab" || event.key === "Enter") {
              event.preventDefault();
              if (activeMention) selectMention(activeMention);
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
