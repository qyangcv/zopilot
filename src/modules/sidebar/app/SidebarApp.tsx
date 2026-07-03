import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { getString } from "../../../utils/locale";
import { getCodexDiagnosticMessageKey } from "../../../codex/diagnostics";
import { copyText } from "./clipboard";
import { CommandMenu } from "./CommandMenu";
import { ContextChips } from "./ContextChips";
import { Icon } from "./Icon";
import { MentionPopover } from "./MentionPopover";
import { Message } from "./Message";
import { PromptPicker } from "./PromptPicker";
import { SessionPopover } from "./SessionPopover";
import { FloatingPortal, Select } from "./ui/index";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { buildSidebarCommands, filterSidebarCommands } from "./commandRegistry";
import type {
  SidebarActions,
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
    if (command.id === "reader.evidencePrompt") {
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
          <div className="zp-empty-welcome">
            <p className="zp-empty-welcome-title">
              How should we approach this paper?
            </p>
            <div className="zp-empty-welcome-hints">
              <p className="zp-empty-welcome-hint">
                <span>使用</span>
                <Icon name="command" size={14} />
                <span>来查看所有可用命令</span>
              </p>
              <p className="zp-empty-welcome-hint">
                <span>使用</span>
                <Icon name="prompt" size={14} />
                <span>插入自定义 prompt</span>
              </p>
              <p className="zp-empty-welcome-hint">
                <span>使用</span>
                <Icon name="add" size={14} />
                <span>添加 PDF 或图片附件</span>
              </p>
              <p className="zp-empty-welcome-hint">
                使用 @ 在文库/合集中选择论文
              </p>
            </div>
          </div>
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
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
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
            spellCheck={false}
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
