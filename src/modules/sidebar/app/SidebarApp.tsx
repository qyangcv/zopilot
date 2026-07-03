import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { getString } from "../../../utils/locale";
import { getCodexDiagnosticMessageKey } from "../../../codex/diagnostics";
import { copyText } from "./clipboard";
import { ContextChips } from "./ContextChips";
import { Icon, type IconName } from "./Icon";
import { Message } from "./Message";
import { FloatingPortal, Select } from "./ui/index";
import { buildSidebarCommands, filterSidebarCommands } from "./commandRegistry";
import type {
  SidebarActions,
  SidebarCollectionOption,
  SidebarCommandView,
  SidebarMessageView,
  SidebarState,
} from "./types";
import {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchMentionCandidates,
  sourceToMention,
} from "./mentions";
import type {
  LocalAttachmentRef,
  PaperSourceRef,
  SourceMention,
  WorkspaceType,
} from "../../../shared/conversation";

export { Message } from "./Message";

const SELECTED_CONTEXT_PROMPT = "Use the selected context.";

export function SidebarApp({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SourceMention[]>([]);
  const [localAttachments, setLocalAttachments] = useState<
    LocalAttachmentRef[]
  >([]);
  const [mentionQuery, setMentionQuery] = useState<ReturnType<
    typeof findMentionQuery
  > | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const logRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef(true);
  const headerRef = useRef<HTMLElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const commandButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const [commandAnchor, setCommandAnchor] = useState<"button" | "input">(
    "input",
  );
  const sourceCandidates = state.sourceCandidates || [];
  const currentSourceId = sourceCandidates.find(
    (source) => source.paperKey === state.context.paperKey,
  )?.sourceId;
  const mentionCandidates = mentionQuery
    ? matchMentionCandidates(
        mentionQuery.query,
        sourceCandidates,
        currentSourceId,
      )
    : [];
  const commands = useMemo(() => buildSidebarCommands(state), [state]);
  const visibleCommands = useMemo(
    () => filterSidebarCommands(commands, commandQuery),
    [commandQuery, commands],
  );
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && autoScrollRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [state.messages]);

  useLayoutEffect(() => {
    const bottomDock = bottomDockRef.current;
    const header = headerRef.current;
    const root = bottomDock?.closest(".zp-sidebar") as HTMLElement | null;
    if (!root || !bottomDock || !header) {
      return;
    }
    const updateLayoutBounds = () => {
      root.style.setProperty(
        "--zp-header-height",
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
      root.style.setProperty(
        "--zp-composer-height",
        `${Math.ceil(bottomDock.getBoundingClientRect().height)}px`,
      );
    };
    updateLayoutBounds();
    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (!ResizeObserverCtor) {
      return;
    }
    const resizeObserver = new ResizeObserverCtor(updateLayoutBounds);
    resizeObserver.observe(header);
    resizeObserver.observe(bottomDock);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  const updateDraft = (text: string, cursor?: number) => {
    setDraft(text);
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
    if (text.startsWith("/")) {
      setCommandAnchor("input");
      setCommandOpen(true);
      setCommandQuery(text.slice(1));
    } else {
      setCommandOpen(false);
      setCommandQuery("");
    }
  };

  const submit = (
    text = draft,
    nextMentions = mentions,
    nextLocalAttachments = localAttachments,
  ) => {
    const trimmed = text.trim();
    const selectedMentions = nextMentions;
    const selectedLocalAttachments = nextLocalAttachments;
    if (
      (!trimmed &&
        !selectedMentions.length &&
        !selectedLocalAttachments.length) ||
      state.busy ||
      !state.composerEnabled
    ) {
      return;
    }
    actions.submitPrompt({
      text: trimmed || SELECTED_CONTEXT_PROMPT,
      mentions: selectedMentions,
      localAttachments: selectedLocalAttachments,
    });
    setDraft("");
    setMentions([]);
    setLocalAttachments([]);
    setMentionQuery(null);
  };

  const selectMention = (source: PaperSourceRef) => {
    if (!mentionQuery || mentions.length >= MAX_SOURCE_MENTIONS) {
      return;
    }
    const nextDraft =
      draft.slice(0, mentionQuery.start) + draft.slice(mentionQuery.end);
    const nextMentions = mentions.some(
      (mention) => mention.sourceId === source.sourceId,
    )
      ? mentions
      : [...mentions, sourceToMention(source)];
    updateDraft(nextDraft, mentionQuery.start);
    setMentions(nextMentions);
    setMentionQuery(null);
    globalThis.setTimeout(() => {
      const nextCursor = mentionQuery.start;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  const copyMessage = (message: SidebarMessageView) => {
    void copyText(message.text).then(() => {
      setCopiedId(`${message.id}-text`);
      globalThis.setTimeout(() => setCopiedId(null), 900);
    });
  };

  const insertPrompt = (
    text: string,
    nextMentions: SourceMention[] = [],
    nextLocalAttachments: LocalAttachmentRef[] = [],
  ) => {
    setMentions([...nextMentions]);
    setLocalAttachments([...nextLocalAttachments]);
    updateDraft(text);
    globalThis.setTimeout(() => {
      textareaRef.current?.focus();
      resizeTextarea(textareaRef.current);
    }, 0);
  };

  const addLocalAttachment = () => {
    void actions
      .uploadAttachment()
      .then((attachment) => {
        if (!attachment) {
          return;
        }
        setLocalAttachments((items) =>
          items.some((item) => item.path === attachment.path)
            ? items
            : [...items, attachment],
        );
        globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch(() => undefined);
  };

  const removeLocalAttachment = (attachmentId: string) => {
    setLocalAttachments((items) =>
      items.filter((attachment) => attachment.id !== attachmentId),
    );
  };

  const removeMention = (mentionId: string) => {
    setMentions((items) => items.filter((mention) => mention.id !== mentionId));
  };

  const executeCommand = (command: SidebarCommandView) => {
    if (!command.available) {
      return;
    }
    setCommandOpen(false);
    setCommandQuery("");
    if (command.id === "source.add") {
      addLocalAttachment();
      return;
    }
    if (command.id === "session.new") {
      actions.createNewSession();
      return;
    }
    if (command.id === "session.history") {
      actions.toggleSessions();
      return;
    }
    if (command.id === "reader.navigate") {
      insertPrompt(
        "Find the strongest evidence in this paper and include page or section locators.",
      );
      return;
    }
    if (command.id === "attachment.upload") {
      addLocalAttachment();
      return;
    }
    if (command.id.startsWith("prompt.")) {
      const prompt = state.prompts.find(
        (item) => command.id === `prompt.${item.id}`,
      );
      if (prompt) {
        insertPrompt(prompt.body);
      }
      return;
    }
  };
  const commandAnchorRef =
    commandAnchor === "button" ? commandButtonRef : textareaRef;
  const sessionAnchorRef =
    state.sessionsMode === "archive" ? archiveButtonRef : historyButtonRef;
  const showWelcome = state.messages.length === 0;

  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zp-sidebar"
      role="complementary"
    >
      <header className="zp-sidebar-header" ref={headerRef}>
        <div className="zp-sidebar-identity" title={state.title}>
          <span className="zp-sidebar-title-block">
            <span className="zp-sidebar-title">
              {getString("sidebar-title")}
            </span>
          </span>
        </div>
        <div className="zp-sidebar-actions">
          <button
            aria-expanded={
              state.sessionsOpen && state.sessionsMode === "history"
            }
            aria-haspopup="true"
            aria-label={getString("sidebar-history")}
            className="zp-icon-button zp-history-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleSessions();
            }}
            ref={historyButtonRef}
            title={getString("sidebar-history")}
            type="button"
          >
            <Icon name="history" />
          </button>
          <button
            aria-expanded={
              state.sessionsOpen && state.sessionsMode === "archive"
            }
            aria-haspopup="true"
            aria-label={getString("sidebar-archived-sessions")}
            className="zp-icon-button zp-archive-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.toggleArchivedSessions();
            }}
            ref={archiveButtonRef}
            title={getString("sidebar-archived-sessions")}
            type="button"
          >
            <Icon name="archive" />
          </button>
          <button
            aria-label={getString("sidebar-new-chat")}
            className="zp-icon-button zp-new-session-button"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              actions.createNewSession();
            }}
            title={getString("sidebar-new-chat")}
            type="button"
          >
            <Icon name="newChat" />
          </button>
          <button
            aria-label={getString("sidebar-close")}
            className="zp-icon-button"
            onClick={actions.close}
            title={getString("sidebar-close")}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      {state.sessionsOpen ? (
        <FloatingPortal
          align="end"
          anchorRef={sessionAnchorRef}
          maxWidth={420}
          minWidth={240}
          onDismiss={actions.hideSessions}
          preferredSide="below"
          width={300}
          zIndex={8}
        >
          <SessionPopover
            actions={actions}
            mode={state.sessionsMode}
            sessions={state.sessions}
          />
        </FloatingPortal>
      ) : null}
      {promptPickerOpen ? (
        <FloatingPortal
          align="start"
          anchorRef={promptButtonRef}
          maxWidth={420}
          minWidth={300}
          onDismiss={() => setPromptPickerOpen(false)}
          preferredSide="above"
          width={380}
          zIndex={9}
        >
          <PromptPicker
            onClose={() => setPromptPickerOpen(false)}
            onInsert={(body) => {
              setPromptPickerOpen(false);
              insertPrompt(body);
            }}
            prompts={state.prompts}
          />
        </FloatingPortal>
      ) : null}
      <main
        aria-live="polite"
        className="zp-chat-log"
        data-empty={showWelcome || undefined}
        onScroll={(event) => {
          autoScrollRef.current = isNearScrollBottom(event.currentTarget);
        }}
        ref={logRef}
        role="log"
      >
        {showWelcome ? (
          <p className="zp-empty-welcome">
            <span>How should we</span>
            <span>make sense of this paper?</span>
          </p>
        ) : null}
        {state.messages.map((message) => (
          <Message
            busy={state.busy}
            copiedId={copiedId}
            key={message.id}
            message={message}
            onCopy={copyMessage}
            onEdit={(messageToEdit) => {
              insertPrompt(
                messageToEdit.text,
                messageToEdit.mentions || [],
                messageToEdit.localAttachments || [],
              );
            }}
            onOpenLink={actions.openExternalLink}
            onOpenLocator={actions.openReaderLocator}
            onSubmit={(messageToSubmit) =>
              submit(
                messageToSubmit.text,
                messageToSubmit.mentions || [],
                messageToSubmit.localAttachments || [],
              )
            }
          />
        ))}
      </main>
      <div className="zp-bottom-dock" ref={bottomDockRef}>
        <form
          aria-busy={state.busy}
          className="zp-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          ref={composerRef}
        >
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
            className="zp-composer-input"
            disabled={!state.composerEnabled}
            onChange={(event) => {
              updateDraft(
                event.currentTarget.value,
                event.currentTarget.selectionStart ?? undefined,
              );
            }}
            onClick={(event) =>
              setMentionQuery(
                findMentionQuery(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? 0,
                ),
              )
            }
            onInput={(event) => {
              resizeTextarea(event.currentTarget);
            }}
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
            value={draft}
          />
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
              {state.codexStatus !== "connected" ? (
                <span
                  className="zp-codex-status"
                  data-status={state.codexStatus}
                >
                  <Icon
                    className="zp-status-icon"
                    name={
                      state.codexStatus === "checking"
                        ? "checking"
                        : "disconnected"
                    }
                    size={13}
                  />
                  {state.codexStatus === "checking"
                    ? getString("sidebar-codex-status-checking")
                    : getString(
                        state.codexDiagnostic
                          ? getCodexDiagnosticMessageKey(state.codexDiagnostic)
                          : "sidebar-codex-status-disconnected",
                      )}
                </span>
              ) : null}
              {state.codexStatus === "connected" ? (
                <>
                  <Select
                    aria-label={getString("sidebar-model-name")}
                    disabled={!state.models.length}
                    onChange={actions.selectModel}
                    options={state.models.map((model) => ({
                      label: model.displayName,
                      value: model.slug,
                    }))}
                    showIndicator={false}
                    title={getString("sidebar-model-name")}
                    value={state.selectedModel}
                  />
                  {state.availableReasoningEfforts.length ? (
                    <Select
                      aria-label={getString("sidebar-reasoning-depth")}
                      onChange={actions.selectReasoningEffort}
                      options={state.availableReasoningEfforts.map(
                        (effort) => ({
                          label: formatEffortLabel(effort),
                          value: effort,
                        }),
                      )}
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
                state.busy
                  ? getString("sidebar-stop")
                  : getString("sidebar-send")
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
                state.busy
                  ? getString("sidebar-stop")
                  : getString("sidebar-send")
              }
              type={state.busy ? "button" : "submit"}
            >
              <Icon name={state.busy ? "stop" : "send"} size={15} />
            </button>
          </div>
        </form>
        <div className="zp-workspace-status-row">
          <WorkspaceSelector actions={actions} state={state} />
        </div>
      </div>
    </aside>
  );
}

function CommandMenu({
  commands,
  onClose,
  onSelect,
}: {
  commands: SidebarCommandView[];
  onClose: () => void;
  onSelect: (command: SidebarCommandView) => void;
}): ReactElement {
  return (
    <div
      aria-label={getString("sidebar-command-menu")}
      className="zp-command-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="zp-command-menu-header">
        <span>{getString("sidebar-command-menu")}</span>
        <button
          aria-label={getString("sidebar-close")}
          className="zp-inline-copy"
          onClick={onClose}
          title={getString("sidebar-close")}
          type="button"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="zp-command-list" role="listbox">
        {commands.length ? (
          commands.slice(0, 8).map((command, index) => (
            <button
              aria-disabled={!command.available}
              className="zp-command-row"
              data-active={index === 0 || undefined}
              disabled={!command.available}
              key={command.id}
              onClick={() => onSelect(command)}
              role="option"
              title={command.disabledReason || command.description}
              type="button"
            >
              <Icon name={command.icon as IconName} size={14} />
              <span className="zp-command-main">
                <span className="zp-command-title">{command.title}</span>
                <span className="zp-command-description">
                  {command.disabledReason || command.description}
                </span>
              </span>
              <span className="zp-command-category">{command.category}</span>
            </button>
          ))
        ) : (
          <div className="zp-command-empty">
            {getString("sidebar-command-empty")}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptPicker({
  onClose,
  onInsert,
  prompts,
}: {
  onClose: () => void;
  onInsert: (body: string) => void;
  prompts: SidebarState["prompts"];
}): ReactElement {
  return (
    <section
      aria-label={getString("sidebar-prompts")}
      className="zp-floating-panel zp-prompt-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <FloatingPanelHeader
        onClose={onClose}
        title={getString("sidebar-prompts")}
      />
      <div className="zp-panel-list">
        {prompts.map((prompt) => (
          <div
            className="zp-panel-row zp-prompt-insert-row"
            key={prompt.id}
            onClick={() => onInsert(prompt.body)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onInsert(prompt.body);
              }
            }}
            role="button"
            tabIndex={0}
            title={prompt.body}
          >
            <div className="zp-panel-row-main">
              <span className="zp-panel-row-title">{prompt.title}</span>
              <span className="zp-panel-row-description">{prompt.body}</span>
            </div>
            <span className="zp-panel-row-meta">
              {getString("sidebar-prompt-insert")}
            </span>
          </div>
        ))}
        {prompts.length === 0 ? (
          <div className="zp-command-empty">
            {getString("sidebar-prompt-empty")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FloatingPanelHeader({
  onClose,
  title,
}: {
  onClose: () => void;
  title: string;
}): ReactElement {
  return (
    <div className="zp-floating-panel-header">
      <span>{title}</span>
      <button
        aria-label={getString("sidebar-close")}
        className="zp-inline-copy"
        onClick={onClose}
        title={getString("sidebar-close")}
        type="button"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

function WorkspaceSelector({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(),
  );
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const workspaceType = state.context.workspaceType || "item";
  const collectionOptions = state.collectionOptions || [];
  const currentCollection = collectionOptions.find(
    (collection) => collection.key === state.context.collectionKey,
  );
  const itemLabel =
    state.context.paperTitle ||
    state.context.label ||
    state.context.paperKey ||
    getString("sidebar-unavailable-context");
  const libraryLabel = getString("sidebar-workspace-my-library");
  const workspaceLabel = !hasWorkspace
    ? getString("sidebar-workspace-unavailable")
    : workspaceType === "library"
      ? libraryLabel
      : workspaceType === "collection"
        ? currentCollection?.label || state.context.label
        : itemLabel;
  const workspaceTypeLabel = getWorkspaceTypeLabel(workspaceType);
  const workspaceTooltip = hasWorkspace
    ? `${getString("sidebar-workspace-current")}: ${workspaceTypeLabel} - ${
        workspaceLabel
      }`
    : getString("sidebar-workspace-unavailable");

  useEffect(() => {
    if (!open) {
      return;
    }
    setLibraryExpanded(false);
    setExpandedCollections(new Set());
  }, [collectionOptions, open]);

  const selectWorkspaceType = (type: WorkspaceType) => {
    setOpen(false);
    actions.selectWorkspaceMode(type);
  };

  const selectCollection = (collectionKey: string) => {
    setOpen(false);
    actions.selectCollectionWorkspace(collectionKey);
  };
  const selectLibrary = () => {
    setOpen(false);
    actions.selectWorkspaceMode("library");
  };
  const toggleCollection = (collectionKey: string) => {
    setExpandedCollections((current) => {
      const next = new Set(current);
      if (current.has(collectionKey)) {
        next.delete(collectionKey);
      } else {
        next.add(collectionKey);
      }
      return next;
    });
  };
  const expandAllCollections = () => {
    setLibraryExpanded(true);
    setExpandedCollections(
      new Set(
        collectionOptions
          .filter((collection) => collection.hasChildren)
          .map((collection) => collection.key),
      ),
    );
  };
  const collapseAllCollections = () => {
    setLibraryExpanded(false);
    setExpandedCollections(new Set());
  };
  const expandableCollectionKeys = collectionOptions
    .filter((collection) => collection.hasChildren)
    .map((collection) => collection.key);
  const allCollectionsExpanded =
    Boolean(collectionOptions.length) &&
    libraryExpanded &&
    expandableCollectionKeys.every((key) => expandedCollections.has(key));
  const toggleAllCollections = () => {
    if (allCollectionsExpanded) {
      collapseAllCollections();
    } else {
      expandAllCollections();
    }
  };
  const toggleAllLabel = getString(
    allCollectionsExpanded
      ? "sidebar-workspace-collapse-all"
      : "sidebar-workspace-expand-all",
  );
  const onMenuRowKeyDown =
    (action: () => void) => (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      action();
    };
  const onMenuRowMouseDown =
    (action: () => void) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
  const collectionChildren = buildCollectionChildren(collectionOptions);
  const renderCollectionRows = (
    collections: SidebarCollectionOption[],
  ): ReactNode[] =>
    collections.flatMap((collection) => {
      const children = collectionChildren.get(collection.key) || [];
      const expanded = expandedCollections.has(collection.key);
      const selectCollectionRow = () => {
        selectCollection(collection.key);
      };
      return [
        <WorkspaceMenuRow
          active={
            workspaceType === "collection" &&
            state.context.collectionKey === collection.key
          }
          className="zp-workspace-menu-collection"
          expanded={expanded}
          hasChildren={collection.hasChildren}
          iconName="workspaceCollection"
          indent={(collection.level + 1) * 18}
          key={collection.key}
          label={collection.label}
          meta={getString("sidebar-workspace-collection")}
          onKeyDown={onMenuRowKeyDown(selectCollectionRow)}
          onMouseDown={onMenuRowMouseDown(selectCollectionRow)}
          onToggleDisclosure={() => toggleCollection(collection.key)}
          title={collection.path.join(" / ")}
        />,
        ...(expanded ? renderCollectionRows(children) : []),
      ];
    });

  return (
    <div
      className="zp-workspace-selector"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={getString("sidebar-workspace-current")}
        aria-expanded={open}
        aria-haspopup="menu"
        className="zp-workspace-trigger"
        data-popup-open={open || undefined}
        data-workspace-type={workspaceType}
        disabled={!hasWorkspace}
        onClick={() => {
          if (!open) {
            collapseAllCollections();
          }
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        ref={triggerRef}
        title={workspaceTooltip}
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
          <span className="zp-workspace-trigger-text">{workspaceLabel}</span>
        </span>
        <span className="zp-workspace-type-badge">{workspaceTypeLabel}</span>
        <Icon
          className="zp-workspace-trigger-chevron"
          name={open ? "collapse" : "expand"}
          size={12}
        />
      </button>
      {open ? (
        <FloatingPortal
          align="start"
          anchorRef={triggerRef}
          maxWidth={420}
          minWidth={280}
          onDismiss={() => setOpen(false)}
          preferredSide="above"
          width={320}
          zIndex={8}
        >
          <div
            className="zp-workspace-menu"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            role="menu"
          >
            <div className="zp-workspace-menu-header">
              <span>{getString("sidebar-workspace-choose")}</span>
              <span className="zp-workspace-menu-header-actions">
                <button
                  aria-label={toggleAllLabel}
                  className="zp-workspace-menu-header-action"
                  disabled={!collectionOptions.length}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleAllCollections();
                  }}
                  title={toggleAllLabel}
                  type="button"
                >
                  <Icon
                    name={
                      allCollectionsExpanded
                        ? "chevrons-down-up"
                        : "chevrons-up-down"
                    }
                    size={15}
                  />
                </button>
              </span>
            </div>
            <WorkspaceMenuRow
              active={workspaceType === "item"}
              iconName="workspaceItem"
              label={itemLabel}
              meta={getString("sidebar-workspace-item")}
              onKeyDown={onMenuRowKeyDown(() => selectWorkspaceType("item"))}
              onMouseDown={onMenuRowMouseDown(() =>
                selectWorkspaceType("item"),
              )}
              title={itemLabel}
            />
            <WorkspaceMenuRow
              active={workspaceType === "library"}
              expanded={libraryExpanded}
              hasChildren={Boolean(collectionOptions.length)}
              iconName="workspaceLibrary"
              label={libraryLabel}
              meta={getString("sidebar-workspace-library")}
              onKeyDown={onMenuRowKeyDown(selectLibrary)}
              onMouseDown={onMenuRowMouseDown(selectLibrary)}
              onToggleDisclosure={() =>
                setLibraryExpanded((expanded) => !expanded)
              }
              title={libraryLabel}
            />
            {libraryExpanded
              ? renderCollectionRows(
                  collectionChildren.get(ROOT_COLLECTION_KEY) || [],
                )
              : null}
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
}

function WorkspaceMenuRow({
  active,
  className,
  expanded = false,
  hasChildren = false,
  iconName,
  indent = 0,
  label,
  meta,
  onKeyDown,
  onMouseDown,
  onToggleDisclosure,
  title,
}: {
  active: boolean;
  className?: string;
  expanded?: boolean;
  hasChildren?: boolean;
  iconName: IconName;
  indent?: number;
  label: string;
  meta: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleDisclosure?: () => void;
  title: string;
}): ReactElement {
  return (
    <div
      aria-expanded={hasChildren ? expanded : undefined}
      className={[
        "zp-workspace-menu-row",
        "zp-workspace-menu-action",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-active={active || undefined}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      role="menuitem"
      tabIndex={0}
      title={title}
    >
      <span
        className="zp-workspace-menu-main"
        style={{ paddingInlineStart: `${10 + indent}px` }}
      >
        <Icon className="zp-workspace-menu-icon" name={iconName} size={14} />
        <span className="zp-workspace-menu-text">
          <span className="zp-workspace-menu-label">
            {formatWorkspaceMenuLabel(label)}
          </span>
          <span className="zp-workspace-menu-meta">{meta}</span>
        </span>
      </span>
      <span className="zp-workspace-menu-check">
        {active ? <Icon name="check" size={13} /> : null}
      </span>
      <WorkspaceDisclosure
        expanded={expanded}
        onToggle={onToggleDisclosure}
        visible={hasChildren}
      />
    </div>
  );
}

function WorkspaceDisclosure({
  expanded,
  onToggle,
  visible,
}: {
  expanded: boolean;
  onToggle?: () => void;
  visible: boolean;
}): ReactElement {
  const title = visible
    ? getString("sidebar-workspace-toggle-collections")
    : undefined;
  if (!visible) {
    return <span className="zp-workspace-menu-expander" />;
  }
  return (
    <button
      aria-expanded={expanded}
      aria-label={title}
      className="zp-workspace-menu-expander"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      title={title}
      type="button"
    >
      <Icon name={expanded ? "collapse" : "expand"} size={13} />
    </button>
  );
}

function getWorkspaceTypeLabel(type: WorkspaceType): string {
  if (type === "library") {
    return getString("sidebar-workspace-library");
  }
  if (type === "collection") {
    return getString("sidebar-workspace-collection");
  }
  return getString("sidebar-workspace-item");
}

const ROOT_COLLECTION_KEY = "";

function formatWorkspaceMenuLabel(label: string): string {
  const maxLength = 42;
  return label.length > maxLength
    ? `${label.slice(0, maxLength - 3)}...`
    : label;
}

function buildCollectionChildren(
  collections: SidebarCollectionOption[],
): Map<string, SidebarCollectionOption[]> {
  const byParent = new Map<string, SidebarCollectionOption[]>();
  for (const collection of collections) {
    const parentKey = collection.parentKey || ROOT_COLLECTION_KEY;
    const children = byParent.get(parentKey) || [];
    children.push(collection);
    byParent.set(parentKey, children);
  }
  return byParent;
}

function MentionPopover({
  candidates,
  disabled,
  onClose,
  onSelect,
}: {
  candidates: PaperSourceRef[];
  disabled: boolean;
  onClose: () => void;
  onSelect: (source: PaperSourceRef) => void;
}): ReactElement {
  return (
    <div
      className="zp-mention-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="listbox"
    >
      {disabled ? (
        <div className="zp-mention-limit">
          {getString("sidebar-mention-limit")}
        </div>
      ) : null}
      {candidates.map((source, index) => (
        <div
          aria-disabled={disabled || undefined}
          className="zp-mention-option"
          data-active={index === 0 || undefined}
          key={source.sourceId}
          onMouseDown={(event) => {
            event.preventDefault();
            if (disabled) {
              return;
            }
            onSelect(source);
          }}
          role="option"
          tabIndex={-1}
          title={source.title}
        >
          <span className="zp-mention-title">{source.title}</span>
          <span className="zp-mention-meta">
            {[source.year, source.creators?.[0]].filter(Boolean).join(" · ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function SessionPopover({
  actions,
  mode,
  sessions,
}: {
  actions: SidebarActions;
  mode: SidebarState["sessionsMode"];
  sessions: SidebarState["sessions"];
}): ReactElement {
  const archived = mode === "archive";
  return (
    <div
      className="zp-session-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zp-session-popover-header">
        {getString(archived ? "sidebar-archived-sessions" : "sidebar-history")}
      </div>
      {sessions.length ? (
        <div className="zp-session-list">
          {sessions.map((session) => (
            <div
              className="zp-session-row"
              data-active={session.active || undefined}
              key={session.id}
            >
              <button
                className="zp-session-select"
                onClick={() => actions.switchSession(session.conversation)}
                title={session.title}
                type="button"
              >
                <span className="zp-session-label">{session.title}</span>
                <span className="zp-session-meta">{session.meta}</span>
              </button>
              {archived ? null : (
                <button
                  aria-label={getString("sidebar-delete-session")}
                  className="zp-session-action zp-session-archive"
                  onClick={() => actions.archiveSession(session.conversation)}
                  title={getString("sidebar-delete-session")}
                  type="button"
                >
                  <Icon name="archive" size={14} />
                </button>
              )}
              {archived ? (
                <button
                  aria-label={getString("sidebar-restore-session")}
                  className="zp-session-action zp-session-restore"
                  onClick={() => actions.restoreSession(session.conversation)}
                  title={getString("sidebar-restore-session")}
                  type="button"
                >
                  <Icon name="archiveRestore" size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="zp-session-empty">
          {getString(
            archived ? "sidebar-no-archived-sessions" : "sidebar-no-sessions",
          )}
        </div>
      )}
    </div>
  );
}

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return;
  }
  const hostHeight =
    textarea.closest("#zopilot-context-pane-deck")?.clientHeight || 680;
  const maxHeight = Math.max(140, Math.floor(hostHeight * 0.42));
  textarea.style.height = "auto";
  textarea.style.maxHeight = `${maxHeight}px`;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

function isNearScrollBottom(element: HTMLElement): boolean {
  const distanceFromBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= 32;
}

function formatEffortLabel(effort: string): string {
  return effort.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase());
}
