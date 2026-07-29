import type { ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { ComposerBindings } from "./composerBindings";
import { ContextChips } from "./ContextChips";
import { MentionPopover } from "./MentionPopover";
import { ItemContextMentionPopover } from "./ItemContextMentionPopover";
import { findMentionQuery } from "./mentions";
import { MAX_SELECTED_CONTEXTS } from "../../../domain/contextSelection";
import type { SidebarState } from "./types";
import {
  findPopupEdgeIndex,
  FloatingPortal,
} from "../../../ui/primitives/index";
import { countItemContextSelections } from "./itemContextGroups";

const ZOTERO_NO_NATIVE_INPUT_PROPS = { "no-native": "true" } as const;

function ComposerEditor({
  bindings,
  state,
}: {
  bindings: ComposerBindings;
  state: SidebarState;
}): ReactElement {
  const {
    handleEditorBlur,
    handleEditorCompositionEnd,
    handleEditorCompositionStart,
    handleEditorInput,
    localAttachments,
    mentionCandidates,
    mentions,
    removeLocalAttachment,
    removeMention,
    removeNoteContext,
    selectMention,
    setMentionQuery,
    submit,
  } = bindings;
  const noteContexts = bindings.noteContexts;
  const activeMention =
    mentionCandidates[bindings.activeMentionIndex] || mentionCandidates[0];
  const activeItemContextNode =
    bindings.activeItemContextIndex > 0
      ? bindings.itemContextNodes[bindings.activeItemContextIndex - 1]
      : undefined;
  const selectedContextCount = countItemContextSelections(
    mentions,
    noteContexts,
  );
  const selectedItemContextIds = new Set([
    ...mentions.map((mention) => mention.sourceId),
    ...noteContexts.map((note) => note.id),
  ]);
  const readerItemContextMode =
    state.context?.hostContextKind === "reader" &&
    state.context?.workspaceType === "item";
  const standaloneReaderMode =
    readerItemContextMode && Boolean(state.context.standalonePdf);
  const showItemContextChips = !readerItemContextMode;
  const chipMentions = showItemContextChips ? mentions : [];
  const chipNoteContexts = showItemContextChips ? noteContexts : [];
  const currentItemContext = readerItemContextMode
    ? {
        expanded: standaloneReaderMode
          ? false
          : bindings.itemContextPickerOpen && !bindings.itemContextSourceId,
        kind: standaloneReaderMode ? ("pdf" as const) : ("item" as const),
        title:
          bindings.itemContextTree?.root.title || state.context?.label || "",
      }
    : undefined;
  const isItemContextDisabled = (index: number) => {
    if (index === 0) return false;
    const node = bindings.itemContextNodes[index - 1];
    if (!node?.selectable) return true;
    const selected =
      (node.kind === "pdf" && node.current) ||
      selectedItemContextIds.has(node.id);
    return bindings.itemContextLimitReached && !selected;
  };
  return (
    <>
      {currentItemContext ||
      chipMentions.length ||
      chipNoteContexts.length ||
      localAttachments.length ? (
        <div className="zp-context-row">
          <div aria-label={getString("sidebar-attachment-context")}>
            <ContextChips
              attachments={localAttachments}
              expandedMentionSourceId={
                bindings.itemContextPickerOpen
                  ? bindings.itemContextSourceId
                  : undefined
              }
              itemContext={currentItemContext}
              mentions={chipMentions}
              notes={chipNoteContexts}
              onOpenItemContext={
                standaloneReaderMode
                  ? undefined
                  : () => bindings.openItemContextPicker()
              }
              onOpenMention={bindings.openItemContextPicker}
              onRemoveAttachment={removeLocalAttachment}
              onRemoveMention={removeMention}
              onRemoveNote={removeNoteContext}
            />
          </div>
        </div>
      ) : null}
      {bindings.itemContextPickerOpen && bindings.itemContextTree ? (
        <FloatingPortal
          align="stretch"
          anchorRef={bindings.composerRef}
          maxHeight={320}
          maxWidth={720}
          minWidth={0}
          onDismiss={bindings.closeItemContextPicker}
          preferredSide="above"
          zIndex={7}
        >
          <ItemContextMentionPopover
            activeIndex={bindings.activeItemContextIndex}
            expanded={bindings.itemContextExpanded}
            limitReached={bindings.itemContextLimitReached}
            nodes={bindings.itemContextNodes}
            onActiveIndexChange={bindings.setActiveItemContextIndex}
            onClose={bindings.closeItemContextPicker}
            onSelect={bindings.selectItemContext}
            onToggle={() =>
              bindings.setItemContextExpanded(!bindings.itemContextExpanded)
            }
            selectedNodeIds={selectedItemContextIds}
            tree={bindings.itemContextTree}
          />
        </FloatingPortal>
      ) : mentionCandidates.length ? (
        <FloatingPortal
          align="stretch"
          anchorRef={bindings.composerRef}
          horizontalBoundaryRef={bindings.bottomDockRef}
          horizontalMargin={0}
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
            disabled={selectedContextCount >= MAX_SELECTED_CONTEXTS}
            onActiveIndexChange={bindings.setActiveMentionIndex}
            onClose={() => setMentionQuery(null)}
            onSelect={selectMention}
          />
        </FloatingPortal>
      ) : null}
      <textarea
        aria-activedescendant={
          bindings.itemContextPickerOpen
            ? `zp-item-context-option-${bindings.activeItemContextIndex}`
            : mentionCandidates.length
              ? `zp-mention-option-${bindings.activeMentionIndex}`
              : undefined
        }
        aria-controls={
          bindings.itemContextPickerOpen
            ? "zp-item-context-tree"
            : mentionCandidates.length
              ? "zp-mention-listbox"
              : undefined
        }
        aria-expanded={
          bindings.itemContextPickerOpen || Boolean(mentionCandidates.length)
        }
        aria-haspopup={
          bindings.itemContextPickerOpen
            ? "tree"
            : mentionCandidates.length
              ? "listbox"
              : undefined
        }
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="zp-composer-input"
        disabled={!state.composerEnabled}
        {...ZOTERO_NO_NATIVE_INPUT_PROPS}
        onBlur={handleEditorBlur}
        onChange={(event) => handleEditorInput(event.currentTarget)}
        onClick={(event) =>
          setMentionQuery(
            findMentionQuery(
              event.currentTarget.value,
              event.currentTarget.selectionStart ?? 0,
            ),
          )
        }
        onCompositionEnd={(event) =>
          handleEditorCompositionEnd(event.currentTarget)
        }
        onCompositionStart={handleEditorCompositionStart}
        onKeyDown={(event) => {
          if (
            (event.nativeEvent as KeyboardEvent | undefined)?.isComposing ||
            event.key === "Process" ||
            event.keyCode === 229
          ) {
            return;
          }
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey
          ) {
            return;
          }
          if (bindings.itemContextPickerOpen) {
            const itemCount =
              1 +
              (bindings.itemContextExpanded
                ? bindings.itemContextNodes.length
                : 0);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              bindings.moveItemContextSelection(
                event.key === "ArrowDown" ? 1 : -1,
              );
              return;
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const nextIndex = findPopupEdgeIndex(
                itemCount,
                isItemContextDisabled,
                event.key === "Home" ? "first" : "last",
              );
              if (nextIndex >= 0) {
                bindings.setActiveItemContextIndex(nextIndex);
              }
              return;
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              if (bindings.activeItemContextIndex === 0) {
                bindings.setItemContextExpanded(false);
              } else {
                bindings.setActiveItemContextIndex(0);
              }
              return;
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              if (bindings.activeItemContextIndex === 0) {
                bindings.setItemContextExpanded(true);
              }
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              bindings.closeItemContextPicker();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (bindings.activeItemContextIndex === 0) {
                bindings.setItemContextExpanded(!bindings.itemContextExpanded);
              } else if (
                activeItemContextNode?.selectable &&
                !isItemContextDisabled(bindings.activeItemContextIndex)
              ) {
                bindings.selectItemContext(activeItemContextNode);
              }
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              if (bindings.activeItemContextIndex === 0) {
                bindings.setItemContextExpanded(!bindings.itemContextExpanded);
              } else if (
                activeItemContextNode?.selectable &&
                !isItemContextDisabled(bindings.activeItemContextIndex)
              ) {
                bindings.selectItemContext(activeItemContextNode);
              }
              return;
            }
          }
          if (mentionCandidates.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              bindings.moveMentionSelection(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const nextIndex = findPopupEdgeIndex(
                mentionCandidates.length,
                () => selectedContextCount >= MAX_SELECTED_CONTEXTS,
                event.key === "Home" ? "first" : "last",
              );
              if (nextIndex >= 0) bindings.setActiveMentionIndex(nextIndex);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMentionQuery(null);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (
                activeMention &&
                selectedContextCount < MAX_SELECTED_CONTEXTS
              ) {
                selectMention(activeMention);
              }
              return;
            }
            if (event.key === "Tab") {
              event.preventDefault();
              if (
                activeMention &&
                selectedContextCount < MAX_SELECTED_CONTEXTS
              ) {
                selectMention(activeMention);
              }
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={getString("sidebar-input-placeholder")}
        ref={bindings.textareaCallbackRef}
        rows={1}
        spellCheck={false}
      />
    </>
  );
}

export { ComposerEditor };
