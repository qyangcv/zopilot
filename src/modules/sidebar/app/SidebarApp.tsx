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
import { Icon, type IconName } from "./Icon";
import { MarkdownView } from "./MarkdownView";
import { DismissLayer, Portal, Select } from "./ui/index";
import { buildSidebarCommands, filterSidebarCommands } from "./commandRegistry";
import type {
  SidebarActions,
  SidebarCollectionOption,
  SidebarCommandView,
  SidebarMessageView,
  SidebarMode,
  SidebarState,
} from "./types";
import {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchMentionCandidates,
  sourceToMention,
} from "./mentions";
import type {
  PaperSourceRef,
  SourceMention,
  WorkspaceType,
} from "../../../shared/conversation";
import { extractPromptVariables } from "../promptSchema";

export function SidebarApp({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SourceMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<ReturnType<
    typeof findMentionQuery
  > | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [skillListOpen, setSkillListOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const logRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef(true);
  const headerRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserMessage = useMemo(
    () =>
      [...state.messages].reverse().find((message) => message.role === "user"),
    [state.messages],
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
    const composer = composerRef.current;
    const header = headerRef.current;
    const root = composer?.closest(".zp-sidebar") as HTMLElement | null;
    if (!root || !composer || !header) {
      return;
    }
    const updateLayoutBounds = () => {
      root.style.setProperty(
        "--zp-header-height",
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
      root.style.setProperty(
        "--zp-composer-height",
        `${Math.ceil(composer.getBoundingClientRect().height)}px`,
      );
    };
    updateLayoutBounds();
    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (!ResizeObserverCtor) {
      return;
    }
    const resizeObserver = new ResizeObserverCtor(updateLayoutBounds);
    resizeObserver.observe(header);
    resizeObserver.observe(composer);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  useEffect(() => {
    if (!state.context.workspaceKey) {
      setContextOpen(false);
    }
  }, [state.context.workspaceKey]);

  const updateDraft = (text: string, cursor?: number) => {
    setDraft(text);
    setMentions((items) =>
      items.filter((mention) => text.includes(`@${mention.title}`)),
    );
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
    if (text.startsWith("/")) {
      setCommandOpen(true);
      setCommandQuery(text.slice(1));
    } else {
      setCommandOpen(false);
      setCommandQuery("");
    }
  };

  const submit = (text = draft, nextMentions = mentions) => {
    const trimmed = text.trim();
    if (!trimmed || state.busy || !state.composerEnabled) {
      return;
    }
    actions.submitPrompt({
      text: trimmed,
      mentions: nextMentions.filter((mention) =>
        trimmed.includes(`@${mention.title}`),
      ),
    });
    setDraft("");
    setMentions([]);
    setMentionQuery(null);
  };

  const selectMention = (source: PaperSourceRef) => {
    if (!mentionQuery || mentions.length >= MAX_SOURCE_MENTIONS) {
      return;
    }
    const inserted = `@${source.title}`;
    const nextDraft =
      draft.slice(0, mentionQuery.start) +
      inserted +
      draft.slice(mentionQuery.end);
    const nextMentions = mentions.some(
      (mention) => mention.sourceId === source.sourceId,
    )
      ? mentions
      : [...mentions, sourceToMention(source)];
    setDraft(nextDraft);
    setMentions(nextMentions);
    setMentionQuery(null);
    globalThis.setTimeout(() => {
      const nextCursor = mentionQuery.start + inserted.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      resizeTextarea(textareaRef.current);
    }, 0);
  };

  const copyMessage = (message: SidebarMessageView) => {
    void copyText(message.text).then(() => {
      setCopiedId(`${message.id}-text`);
      globalThis.setTimeout(() => setCopiedId(null), 900);
    });
  };

  const insertPrompt = (text: string) => {
    updateDraft(text);
    globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const executeCommand = (command: SidebarCommandView) => {
    if (!command.available) {
      return;
    }
    setCommandOpen(false);
    setCommandQuery("");
    if (command.id === "mode.ask") {
      actions.selectMode("ask");
      return;
    }
    if (command.id === "mode.agent") {
      actions.selectMode("agent");
      return;
    }
    if (command.id === "source.add") {
      setContextOpen(true);
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
      actions.uploadAttachment();
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
    if (command.id.startsWith("skill.")) {
      setSkillListOpen(true);
    }
  };

  return (
    <aside
      aria-label={getString("sidebar-title")}
      className="zp-sidebar"
      role="complementary"
    >
      <header className="zp-sidebar-header" ref={headerRef}>
        <button
          className="zp-sidebar-identity"
          onClick={(event) => {
            event.stopPropagation();
            setContextOpen((open) => !open);
          }}
          title={state.title}
          type="button"
        >
          <span className="zp-sidebar-title-block">
            <span className="zp-sidebar-title">
              {getString("sidebar-title")}
            </span>
            <span className="zp-sidebar-selected-title">{state.title}</span>
          </span>
        </button>
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
      {contextOpen ? (
        <Portal>
          <DismissLayer onDismiss={() => setContextOpen(false)}>
            <ContextPopover
              label={state.context.label}
              onClose={() => setContextOpen(false)}
              paperKey={state.context.paperKey}
              paperTitle={state.context.paperTitle}
              parentItemKey={state.context.parentItemKey}
              attachmentKey={state.context.attachmentKey}
              workspaceKey={state.context.workspaceKey}
              workspaceType={state.context.workspaceType}
            />
          </DismissLayer>
        </Portal>
      ) : null}
      {state.sessionsOpen ? (
        <Portal>
          <DismissLayer onDismiss={actions.hideSessions}>
            <SessionPopover
              actions={actions}
              mode={state.sessionsMode}
              sessions={state.sessions}
            />
          </DismissLayer>
        </Portal>
      ) : null}
      {promptPickerOpen ? (
        <Portal>
          <DismissLayer onDismiss={() => setPromptPickerOpen(false)}>
            <PromptPicker
              onCreate={actions.createPrompt}
              mode={state.selectedMode}
              onClose={() => setPromptPickerOpen(false)}
              onDelete={actions.deletePrompt}
              onInsert={(body) => {
                setPromptPickerOpen(false);
                insertPrompt(body);
              }}
              prompts={state.prompts}
            />
          </DismissLayer>
        </Portal>
      ) : null}
      {skillListOpen ? (
        <Portal>
          <DismissLayer onDismiss={() => setSkillListOpen(false)}>
            <SkillList
              mode={state.selectedMode}
              onClose={() => setSkillListOpen(false)}
              onToggle={actions.setSkillEnabled}
              skills={state.skills}
            />
          </DismissLayer>
        </Portal>
      ) : null}
      <main
        aria-live="polite"
        className="zp-chat-log"
        onScroll={(event) => {
          autoScrollRef.current = isNearScrollBottom(event.currentTarget);
        }}
        ref={logRef}
        role="log"
      >
        {state.messages.map((message) => (
          <Message
            busy={state.busy}
            copiedId={copiedId}
            key={message.id}
            lastUserText={lastUserMessage?.text}
            message={message}
            onCopy={copyMessage}
            onInsert={(text) => {
              updateDraft(text);
              globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            onOpenLink={actions.openExternalLink}
            onOpenLocator={actions.openReaderLocator}
            onSubmit={(text) => submit(text, [])}
          />
        ))}
      </main>
      <form
        aria-busy={state.busy}
        className="zp-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        ref={composerRef}
      >
        <div className="zp-context-row">
          <WorkspaceSelector actions={actions} state={state} />
          <button
            className="zp-context-chip"
            disabled={!state.context.workspaceKey}
            onClick={(event) => {
              event.stopPropagation();
              setContextOpen((open) => !open);
            }}
            title={state.context.paperTitle || state.context.label}
            type="button"
          >
            <Icon className="zp-context-chip-icon" name="context" size={13} />
            <span className="zp-context-chip-text">{state.context.label}</span>
          </button>
        </div>
        {mentionCandidates.length ? (
          <Portal>
            <DismissLayer onDismiss={() => setMentionQuery(null)}>
              <MentionPopover
                candidates={mentionCandidates}
                disabled={mentions.length >= MAX_SOURCE_MENTIONS}
                onClose={() => setMentionQuery(null)}
                onSelect={selectMention}
              />
            </DismissLayer>
          </Portal>
        ) : null}
        {commandOpen ? (
          <Portal>
            <DismissLayer onDismiss={() => setCommandOpen(false)}>
              <CommandMenu
                commands={visibleCommands}
                onClose={() => setCommandOpen(false)}
                onSelect={executeCommand}
              />
            </DismissLayer>
          </Portal>
        ) : null}
        <textarea
          className="zp-composer-input"
          disabled={!state.composerEnabled}
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
                setCommandOpen((open) => !open);
                setCommandQuery("");
              }}
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
                setSkillListOpen(false);
              }}
              title={getString("sidebar-prompts")}
              type="button"
            >
              <Icon name="prompt" size={15} />
            </button>
            <button
              aria-label={getString("sidebar-skills")}
              className="zp-context-add"
              disabled={!state.context.workspaceKey}
              onClick={(event) => {
                event.stopPropagation();
                setSkillListOpen((open) => !open);
                setPromptPickerOpen(false);
              }}
              title={getString("sidebar-skills")}
              type="button"
            >
              <Icon name="skill" size={15} />
            </button>
            <button
              aria-label={getString("sidebar-attachment-upload")}
              className="zp-context-add"
              disabled={!state.context.workspaceKey || state.busy}
              onClick={(event) => {
                event.stopPropagation();
                actions.uploadAttachment();
              }}
              title={getString("sidebar-attachment-upload")}
              type="button"
            >
              <Icon name="attachment" size={15} />
            </button>
            <button
              aria-label={getString("sidebar-add-context")}
              className="zp-context-add"
              disabled={!state.context.workspaceKey}
              onClick={(event) => {
                event.stopPropagation();
                setContextOpen((open) => !open);
              }}
              title={getString("sidebar-add-context")}
              type="button"
            >
              <Icon name="add" size={15} />
            </button>
            {state.codexStatus !== "connected" ? (
              <span className="zp-codex-status" data-status={state.codexStatus}>
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
                <ModeSwitch
                  mode={state.selectedMode}
                  onChange={actions.selectMode}
                />
                <Select
                  aria-label={getString("sidebar-model-name")}
                  disabled={!state.models.length}
                  onChange={actions.selectModel}
                  options={state.models.map((model) => ({
                    label: model.displayName,
                    value: model.slug,
                  }))}
                  title={getString("sidebar-model-name")}
                  value={state.selectedModel}
                />
                {state.availableReasoningEfforts.length ? (
                  <Select
                    aria-label={getString("sidebar-reasoning-depth")}
                    onChange={actions.selectReasoningEffort}
                    options={state.availableReasoningEfforts.map((effort) => ({
                      label: formatEffortLabel(effort),
                      value: effort,
                    }))}
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
            disabled={!state.composerEnabled || (!state.busy && !draft.trim())}
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
      </form>
    </aside>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
}): ReactElement {
  return (
    <span
      aria-label={getString("sidebar-mode")}
      className="zp-mode-switch"
      role="group"
    >
      {(["ask", "agent"] as const).map((item) => (
        <button
          aria-pressed={mode === item}
          className="zp-mode-option"
          data-active={mode === item || undefined}
          key={item}
          onClick={() => onChange(item)}
          title={getString(
            item === "ask" ? "sidebar-mode-ask" : "sidebar-mode-agent",
          )}
          type="button"
        >
          <Icon name={item === "ask" ? "askMode" : "agentMode"} size={12} />
          <span>
            {getString(
              item === "ask" ? "sidebar-mode-ask" : "sidebar-mode-agent",
            )}
          </span>
        </button>
      ))}
    </span>
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
  mode,
  onCreate,
  onClose,
  onDelete,
  onInsert,
  prompts,
}: {
  mode: SidebarMode;
  onCreate: (input: { title: string; body: string }) => void;
  onClose: () => void;
  onDelete: (promptId: string) => void;
  onInsert: (body: string) => void;
  prompts: SidebarState["prompts"];
}): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const variables = useMemo(() => extractPromptVariables(body), [body]);
  const canCreate = Boolean(title.trim() && body.trim());
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
      <form
        className="zp-prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCreate) {
            return;
          }
          onCreate({ title, body });
          setTitle("");
          setBody("");
        }}
      >
        <input
          aria-label={getString("sidebar-prompt-title")}
          className="zp-prompt-title-input"
          onChange={(event) => setTitle(event.currentTarget.value)}
          placeholder={getString("sidebar-prompt-title")}
          value={title}
        />
        <textarea
          aria-label={getString("sidebar-prompt-body")}
          className="zp-prompt-body-input"
          onChange={(event) => setBody(event.currentTarget.value)}
          placeholder={getString("sidebar-prompt-body")}
          rows={3}
          value={body}
        />
        <div className="zp-prompt-form-footer">
          <span className="zp-prompt-variable-preview">
            {variables.length
              ? variables.map((variable) => `{{${variable}}}`).join(" ")
              : getString("sidebar-prompt-no-variables")}
          </span>
          <button
            className="zp-prompt-save"
            disabled={!canCreate}
            type="submit"
          >
            {getString("sidebar-prompt-save")}
          </button>
        </div>
      </form>
      <div className="zp-panel-list">
        {prompts.map((prompt) => {
          const compatible = prompt.compatibleModes.includes(mode);
          return (
            <div className="zp-panel-row" key={prompt.id} title={prompt.body}>
              <button
                className="zp-panel-row-main zp-prompt-insert-row"
                disabled={!compatible}
                onClick={() => onInsert(prompt.body)}
                type="button"
              >
                <span className="zp-panel-row-title">{prompt.title}</span>
                <span className="zp-panel-row-description">{prompt.body}</span>
              </button>
              <span className="zp-panel-row-meta">
                {compatible
                  ? getString("sidebar-prompt-insert")
                  : getString("sidebar-mode-incompatible")}
              </span>
              {prompt.custom ? (
                <button
                  aria-label={getString("sidebar-prompt-delete")}
                  className="zp-inline-copy"
                  onClick={() => onDelete(prompt.id)}
                  title={getString("sidebar-prompt-delete")}
                  type="button"
                >
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SkillList({
  mode,
  onClose,
  onToggle,
  skills,
}: {
  mode: SidebarMode;
  onClose: () => void;
  onToggle: (skillId: string, enabled: boolean) => void;
  skills: SidebarState["skills"];
}): ReactElement {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = useMemo(
    () =>
      normalizedQuery
        ? skills.filter((skill) =>
            [
              skill.title,
              skill.description,
              skill.category,
              skill.status,
              ...skill.requiredContext,
            ]
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : skills,
    [normalizedQuery, skills],
  );
  return (
    <section
      aria-label={getString("sidebar-skills")}
      className="zp-floating-panel zp-skill-list"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <FloatingPanelHeader
        onClose={onClose}
        title={getString("sidebar-skills")}
      />
      <input
        aria-label={getString("sidebar-skill-search")}
        className="zp-skill-filter"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder={getString("sidebar-skill-search")}
        value={query}
      />
      <div className="zp-panel-list">
        {visibleSkills.map((skill) => {
          const compatible = skill.compatibleModes.includes(mode);
          const active =
            skill.enabled && compatible && skill.status === "available";
          const contextLabel = skill.requiredContext
            .map((context) =>
              context === "reader"
                ? getString("sidebar-skill-reader-context")
                : getString("sidebar-skill-workspace-context"),
            )
            .join(", ");
          return (
            <div className="zp-panel-row" key={skill.id}>
              <span className="zp-panel-row-main">
                <span className="zp-panel-row-title">{skill.title}</span>
                <span className="zp-panel-row-description">
                  {skill.description}
                </span>
                <span className="zp-panel-row-description">
                  {skill.category}
                  {contextLabel ? ` · ${contextLabel}` : ""}
                </span>
              </span>
              <span
                className="zp-skill-status"
                data-active={active || undefined}
              >
                {active
                  ? getString("sidebar-skill-enabled")
                  : skill.status === "requires-context"
                    ? getString("sidebar-skill-requires-context")
                    : !compatible
                      ? getString("sidebar-mode-incompatible")
                      : getString("sidebar-skill-disabled")}
              </span>
              <label className="zp-skill-toggle">
                <input
                  checked={skill.enabled}
                  onChange={(event) =>
                    onToggle(skill.id, event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>
                  {skill.enabled
                    ? getString("sidebar-skill-enabled")
                    : getString("sidebar-skill-disabled")}
                </span>
              </label>
            </div>
          );
        })}
        {visibleSkills.length === 0 ? (
          <div className="zp-command-empty">
            {getString("sidebar-skill-empty")}
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
  const libraryExpanded = true;
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(),
  );
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
  const workspaceLabel =
    workspaceType === "library"
      ? libraryLabel
      : workspaceType === "collection"
        ? currentCollection?.label || state.context.label
        : itemLabel;

  useEffect(() => {
    if (!open) {
      return;
    }
    setExpandedCollections(
      getSelectedCollectionExpansion(
        collectionOptions,
        state.context.collectionKey,
      ),
    );
  }, [collectionOptions, open, state.context.collectionKey]);

  const selectMode = (type: WorkspaceType) => {
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
  const expandCollection = (collectionKey: string) => {
    setExpandedCollections((current) => {
      if (current.has(collectionKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(collectionKey);
      return next;
    });
  };
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
        <div
          aria-expanded={collection.hasChildren ? expanded : undefined}
          className="zp-workspace-menu-row zp-workspace-menu-action zp-workspace-menu-collection"
          data-active={
            workspaceType === "collection" &&
            state.context.collectionKey === collection.key
              ? true
              : undefined
          }
          key={collection.key}
          onFocus={() => {
            if (collection.hasChildren) {
              expandCollection(collection.key);
            }
          }}
          onKeyDown={onMenuRowKeyDown(selectCollectionRow)}
          onMouseDown={onMenuRowMouseDown(selectCollectionRow)}
          onMouseEnter={() => {
            if (collection.hasChildren) {
              expandCollection(collection.key);
            }
          }}
          role="menuitem"
          tabIndex={0}
          title={collection.path.join(" / ")}
        >
          <span
            className="zp-workspace-menu-label"
            style={{
              paddingInlineStart: `${10 + collection.level * 18}px`,
            }}
          >
            {formatWorkspaceMenuLabel(collection.label)}
          </span>
          <WorkspaceDisclosure
            expanded={expanded}
            visible={collection.hasChildren}
          />
        </div>,
        ...(expanded ? renderCollectionRows(children) : []),
      ];
    });

  return (
    <div
      className="zp-workspace-selector"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          nextTarget instanceof Node &&
          event.currentTarget.contains(nextTarget)
        ) {
          return;
        }
        setOpen(false);
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={getString("sidebar-workspace-level")}
        aria-expanded={open}
        aria-haspopup="menu"
        className="zp-composer-select zp-workspace-trigger"
        disabled={!state.context.workspaceKey}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        title={getString("sidebar-workspace-level")}
        type="button"
      >
        <span className="zp-workspace-trigger-text">{workspaceLabel}</span>
        <Icon name={open ? "collapse" : "expand"} size={12} />
      </button>
      {open ? (
        <div className="zp-workspace-menu" role="menu">
          <div
            className="zp-workspace-menu-row zp-workspace-menu-action"
            data-active={workspaceType === "item" || undefined}
            onKeyDown={onMenuRowKeyDown(() => selectMode("item"))}
            onMouseDown={onMenuRowMouseDown(() => selectMode("item"))}
            role="menuitem"
            tabIndex={0}
            title={itemLabel}
          >
            <span className="zp-workspace-menu-label">
              {formatWorkspaceMenuLabel(itemLabel)}
            </span>
            <WorkspaceDisclosure expanded={false} visible={false} />
          </div>
          <div
            aria-expanded={
              collectionOptions.length ? libraryExpanded : undefined
            }
            className="zp-workspace-menu-row zp-workspace-menu-action"
            data-active={workspaceType === "library" || undefined}
            onKeyDown={onMenuRowKeyDown(selectLibrary)}
            onMouseDown={onMenuRowMouseDown(selectLibrary)}
            role="menuitem"
            tabIndex={0}
            title={libraryLabel}
          >
            <span className="zp-workspace-menu-label">
              {formatWorkspaceMenuLabel(libraryLabel)}
            </span>
            <WorkspaceDisclosure
              expanded={libraryExpanded}
              visible={Boolean(collectionOptions.length)}
            />
          </div>
          {libraryExpanded
            ? renderCollectionRows(
                collectionChildren.get(ROOT_COLLECTION_KEY) || [],
              )
            : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkspaceDisclosure({
  expanded,
  visible,
}: {
  expanded: boolean;
  visible: boolean;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="zp-workspace-menu-expander"
      title={
        visible ? getString("sidebar-workspace-toggle-collections") : undefined
      }
    >
      {visible ? (
        <Icon name={expanded ? "collapse" : "expand"} size={13} />
      ) : null}
    </span>
  );
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

function getSelectedCollectionExpansion(
  collections: SidebarCollectionOption[],
  selectedKey?: string,
): Set<string> {
  const expanded = new Set<string>();
  if (!selectedKey) {
    return expanded;
  }
  const byKey = new Map(
    collections.map((collection) => [collection.key, collection]),
  );
  let current = byKey.get(selectedKey);
  while (current) {
    if (current.hasChildren) {
      expanded.add(current.key);
    }
    if (current.parentKey) {
      expanded.add(current.parentKey);
    }
    current = current.parentKey ? byKey.get(current.parentKey) : undefined;
  }
  return expanded;
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

export function Message({
  busy,
  copiedId,
  lastUserText,
  message,
  onCopy,
  onInsert,
  onOpenLink,
  onOpenLocator,
  onSubmit,
}: {
  busy: boolean;
  copiedId: string | null;
  lastUserText?: string;
  message: SidebarMessageView;
  onCopy: (message: SidebarMessageView) => void;
  onInsert: (text: string) => void;
  onOpenLink: (url: string) => void;
  onOpenLocator: (
    locator: NonNullable<SidebarMessageView["locators"]>[number],
  ) => void;
  onSubmit: (text: string) => void;
}): ReactElement {
  const isAssistant = message.role === "assistant";
  const isCompleteAssistant =
    isAssistant &&
    message.status === "complete" &&
    !message.transient &&
    !message.running &&
    Boolean(message.completedAt);
  const canRetry = isCompleteAssistant && lastUserText;
  const completedAt = message.completedAt;

  return (
    <article
      className={`zp-message zp-message-${message.role}`}
      data-status={message.status}
    >
      {isAssistant ? (
        <Icon className="zp-message-avatar" name="brand" size={17} />
      ) : null}
      <div
        className={isAssistant ? "zp-message-stack" : "zp-message-user-stack"}
      >
        {isAssistant ? (
          <div className="zp-message-body">
            <MarkdownView
              className="zp-message-markdown"
              markdown={message.text}
              onOpenLink={onOpenLink}
            />
          </div>
        ) : (
          <MarkdownView
            className="zp-message-bubble zp-message-markdown"
            markdown={message.text}
            onOpenLink={onOpenLink}
            unwrapSingleParagraph
          />
        )}
        {isAssistant ? (
          <AssistantFooter
            canRetry={Boolean(canRetry)}
            completedAt={completedAt}
            copied={copiedId === `${message.id}-text`}
            locators={message.locators || []}
            message={message}
            onCopy={() => onCopy(message)}
            onInsert={() => onInsert(message.text)}
            onOpenLocator={onOpenLocator}
            onRetry={() => {
              if (lastUserText) {
                onSubmit(lastUserText);
              }
            }}
          />
        ) : (
          <div className="zp-message-actions">
            <IconAction
              icon="edit"
              label={getString("sidebar-edit-composer")}
              onClick={() => onInsert(message.text)}
            />
            <IconAction
              disabled={busy}
              icon="resend"
              label={getString("sidebar-resend")}
              onClick={() => onSubmit(message.text)}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function AssistantFooter({
  canRetry,
  completedAt,
  copied,
  locators,
  message,
  onCopy,
  onInsert,
  onOpenLocator,
  onRetry,
}: {
  canRetry: boolean;
  completedAt?: string;
  copied: boolean;
  locators: NonNullable<SidebarMessageView["locators"]>;
  message: SidebarMessageView;
  onCopy: () => void;
  onInsert: () => void;
  onOpenLocator: (
    locator: NonNullable<SidebarMessageView["locators"]>[number],
  ) => void;
  onRetry: () => void;
}): ReactElement | null {
  if (message.running || message.transient) {
    return null;
  }
  if (message.status !== "complete") {
    return (
      <div className="zp-message-footer">
        <span className="zp-message-status">
          {message.status === "interrupted"
            ? getString("sidebar-status-interrupted")
            : getString("sidebar-status-error")}
        </span>
        {completedAt ? (
          <time className="zp-message-time">{completedAt}</time>
        ) : null}
      </div>
    );
  }
  if (!completedAt) {
    return null;
  }
  return (
    <div className="zp-message-footer">
      <div className="zp-message-actions">
        {locators.map((locator) => (
          <button
            className="zp-locator-chip"
            key={`${locator.kind}-${locator.label}`}
            onClick={() => onOpenLocator(locator)}
            title={getString("sidebar-open-reader-location")}
            type="button"
          >
            {locator.label}
          </button>
        ))}
        <IconAction
          active={copied}
          icon="copy"
          label={getString("sidebar-copy-text")}
          onClick={onCopy}
        />
        <IconAction
          icon="insert"
          label={getString("sidebar-insert-composer")}
          onClick={onInsert}
        />
        <IconAction
          disabled={!canRetry}
          icon="retry"
          label={getString("sidebar-retry-turn")}
          onClick={onRetry}
        />
      </div>
      <time className="zp-message-time">{completedAt}</time>
    </div>
  );
}

function IconAction({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-label={label}
      className="zp-message-action"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon name={active ? "copied" : icon} size={14} />
    </button>
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

function ContextPopover({
  attachmentKey,
  label,
  onClose,
  paperKey,
  paperTitle,
  parentItemKey,
  workspaceKey,
  workspaceType,
}: {
  attachmentKey?: string;
  label: string;
  onClose: () => void;
  paperKey?: string;
  paperTitle?: string;
  parentItemKey?: string;
  workspaceKey?: string;
  workspaceType?: string;
}): ReactElement {
  return (
    <div
      className="zp-context-popover"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="zp-context-popover-header">
        <span>{getString("sidebar-context-details")}</span>
        <button
          aria-label={getString("sidebar-close")}
          className="zp-message-action"
          onClick={onClose}
          title={getString("sidebar-close")}
          type="button"
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <dl className="zp-context-details">
        <div>
          <dt>{getString("sidebar-current-context")}</dt>
          <dd>{paperTitle || label}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>
            {workspaceType ? `${workspaceType}: ` : ""}
            {workspaceKey || getString("sidebar-unavailable-context")}
          </dd>
        </div>
        <div>
          <dt>{getString("sidebar-paper-key")}</dt>
          <dd>{paperKey || getString("sidebar-unavailable-context")}</dd>
        </div>
        {parentItemKey ? (
          <div>
            <dt>{getString("sidebar-parent-key")}</dt>
            <dd>{parentItemKey}</dd>
          </div>
        ) : null}
        {attachmentKey ? (
          <div>
            <dt>{getString("sidebar-attachment-key")}</dt>
            <dd>{attachmentKey}</dd>
          </div>
        ) : null}
      </dl>
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
