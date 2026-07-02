import {
  CircleAlert,
  FileText,
  LoaderCircle,
  MessageSquareText,
  PlugZap,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { CodexDiscoverySubprocessModule } from "../../../codex/cliDiscovery";
import {
  checkCodexConnection,
  diagnoseCodexConnection,
  type CodexDiagnosticMessageKey,
} from "../../../codex/diagnostics";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  updateCustomPrompt,
} from "../../sidebar/promptStore";
import { extractPromptVariables } from "../../sidebar/promptSchema";

export { PreferencesApp };
export type { PreferencesAppProps };

type PreferencesAppProps = {
  getSubprocess: () => CodexDiscoverySubprocessModule;
  translate: () => void;
};

type PreferenceSection = "connection" | "prompts";
type PromptView = ReturnType<typeof loadCustomPrompts>[number];
type CodexConnectionState =
  | { status: "checking" }
  | { status: "connected" }
  | { status: "missing"; messageKey: CodexDiagnosticMessageKey };
type PromptMessage = {
  kind: "error" | "success";
  text: string;
};

function PreferencesApp({
  getSubprocess,
  translate,
}: PreferencesAppProps): ReactElement {
  const [activeSection, setActiveSection] =
    useState<PreferenceSection>("connection");
  const [connection, setConnection] = useState<CodexConnectionState>({
    status: "checking",
  });
  const [prompts, setPrompts] = useState<PromptView[]>(() =>
    loadCustomPrompts(),
  );
  const [selectedPromptId, setSelectedPromptId] = useState<string | undefined>(
    () => loadCustomPrompts()[0]?.id,
  );
  const [promptTitle, setPromptTitle] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [promptMessage, setPromptMessage] = useState<PromptMessage>();

  useEffect(() => {
    translate();
  });

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId),
    [prompts, selectedPromptId],
  );
  const variables = useMemo(
    () => extractPromptVariables(promptBody),
    [promptBody],
  );

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptTitle("");
      setPromptBody("");
      return;
    }
    setPromptTitle(selectedPrompt.title);
    setPromptBody(selectedPrompt.body);
  }, [selectedPrompt]);

  const refreshPrompts = (nextSelectedId?: string) => {
    const nextPrompts = loadCustomPrompts();
    setPrompts(nextPrompts);
    setSelectedPromptId(
      nextSelectedId ||
        nextPrompts.find((prompt) => prompt.id === selectedPromptId)?.id ||
        nextPrompts[0]?.id,
    );
  };

  const runConnectionCheck = () => {
    setConnection({ status: "checking" });
    void detectCodexConnection(getSubprocess).then(setConnection);
  };

  useEffect(runConnectionCheck, []);

  const selectPrompt = (promptId: string) => {
    setSelectedPromptId(promptId);
    setPromptMessage(undefined);
  };
  const createBlankPrompt = () => {
    setSelectedPromptId(undefined);
    setPromptTitle("");
    setPromptBody("");
    setPromptMessage(undefined);
  };
  const savePrompt = () => {
    try {
      const saved = selectedPromptId
        ? updateCustomPrompt(selectedPromptId, {
            title: promptTitle,
            body: promptBody,
          })
        : createCustomPrompt({ title: promptTitle, body: promptBody });
      refreshPrompts(saved.id);
      setPromptMessage({ kind: "success", text: "已保存。" });
    } catch (error) {
      setPromptMessage({
        kind: "error",
        text: getPromptErrorMessage(error),
      });
    }
  };
  const removePrompt = () => {
    if (!selectedPromptId) {
      return;
    }
    deleteCustomPrompt(selectedPromptId);
    refreshPrompts();
    setPromptMessage({ kind: "success", text: "已删除。" });
  };

  return (
    <main className="zp-pref-shell">
      <aside className="zp-pref-sidebar" aria-label="Zopilot 偏好设置分组">
        <div className="zp-pref-brand">
          <MessageSquareText size={18} />
          <span>Zopilot</span>
        </div>
        <nav className="zp-pref-nav">
          <NavButton
            active={activeSection === "connection"}
            count={connection.status === "connected" ? undefined : 1}
            icon={<PlugZap size={16} />}
            label={<T id="pref-nav-connection">连接</T>}
            onClick={() => setActiveSection("connection")}
          />
          <NavButton
            active={activeSection === "prompts"}
            count={prompts.length || undefined}
            icon={<FileText size={16} />}
            label={<T id="pref-nav-prompts">Prompt</T>}
            onClick={() => setActiveSection("prompts")}
          />
        </nav>
      </aside>
      <section className="zp-pref-main">
        {activeSection === "connection" ? (
          <ConnectionPanel
            connection={connection}
            onCheck={runConnectionCheck}
          />
        ) : (
          <PromptPanel
            body={promptBody}
            message={promptMessage}
            onBodyChange={setPromptBody}
            onDelete={removePrompt}
            onNew={createBlankPrompt}
            onSave={savePrompt}
            onSelect={selectPrompt}
            onTitleChange={setPromptTitle}
            prompts={prompts}
            selectedPromptId={selectedPromptId}
            title={promptTitle}
            variables={variables}
          />
        )}
      </section>
    </main>
  );
}

function ConnectionPanel({
  connection,
  onCheck,
}: {
  connection: CodexConnectionState;
  onCheck: () => void;
}): ReactElement {
  const statusClass = `zp-pref-status zp-pref-status-${connection.status}`;
  const statusLabel =
    connection.status === "checking"
      ? "pref-codex-status-checking"
      : connection.status === "connected"
        ? "pref-codex-status-connected"
        : connection.messageKey;
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-connection-description">
            检查 Zopilot 是否能连接本地 Codex app-server。
          </T>
        }
        title={<T id="pref-connection-title">连接</T>}
      />
      <div className="zp-pref-card">
        <div className="zp-pref-card-header">
          <div>
            <h3>
              <T id="pref-codex-card-title">Codex CLI</T>
            </h3>
            <p>
              <T id="pref-codex-card-description">当前作为本地智能体运行时。</T>
            </p>
          </div>
          <button
            className="zp-pref-button zp-pref-button-secondary"
            disabled={connection.status === "checking"}
            onClick={onCheck}
            type="button"
          >
            <RotateCcw size={14} />
            <T id="pref-codex-check">重新检查</T>
          </button>
        </div>
        <div className={statusClass}>
          {connection.status === "checking" ? (
            <LoaderCircle className="zp-pref-spin" size={16} />
          ) : connection.status === "connected" ? (
            <PlugZap size={16} />
          ) : (
            <CircleAlert size={16} />
          )}
          <T id={statusLabel}>状态</T>
        </div>
      </div>
    </section>
  );
}

function PromptPanel({
  body,
  message,
  onBodyChange,
  onDelete,
  onNew,
  onSave,
  onSelect,
  onTitleChange,
  prompts,
  selectedPromptId,
  title,
  variables,
}: {
  body: string;
  message?: PromptMessage;
  onBodyChange: (body: string) => void;
  onDelete: () => void;
  onNew: () => void;
  onSave: () => void;
  onSelect: (promptId: string) => void;
  onTitleChange: (title: string) => void;
  prompts: PromptView[];
  selectedPromptId?: string;
  title: string;
  variables: string[];
}): ReactElement {
  return (
    <section className="zp-pref-page">
      <PageHeader
        action={
          <button
            className="zp-pref-button zp-pref-button-primary"
            onClick={onNew}
            type="button"
          >
            <Plus size={14} />
            <T id="pref-prompt-new">新建 Prompt</T>
          </button>
        }
        description={
          <T id="pref-prompts-description">
            创建可从 Zopilot 侧边栏快速插入的模板问题。
          </T>
        }
        title={<T id="pref-prompts-title">Prompt</T>}
      />
      <div className="zp-pref-prompt-grid">
        <div className="zp-pref-list-card">
          {prompts.length ? (
            prompts.map((prompt) => (
              <div
                className="zp-pref-prompt-row"
                data-selected={prompt.id === selectedPromptId || undefined}
                key={prompt.id}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(prompt.id);
                  }
                }}
                onClick={() => onSelect(prompt.id)}
                role="button"
                tabIndex={0}
                title={prompt.body}
              >
                <span className="zp-pref-prompt-row-title">{prompt.title}</span>
                <span className="zp-pref-prompt-row-body">{prompt.body}</span>
              </div>
            ))
          ) : (
            <div className="zp-pref-empty">
              <T id="pref-prompt-empty">暂无自定义 Prompt</T>
            </div>
          )}
        </div>
        <form
          className="zp-pref-editor-card"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <label className="zp-pref-field">
            <span>
              <T id="pref-prompt-title-label">Prompt 标题</T>
            </span>
            <input
              className="zp-pref-input"
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              value={title}
            />
          </label>
          <label className="zp-pref-field">
            <span>
              <T id="pref-prompt-body-label">模板问题</T>
            </span>
            <textarea
              className="zp-pref-textarea"
              onChange={(event) => onBodyChange(event.currentTarget.value)}
              value={body}
            />
          </label>
          <div className="zp-pref-editor-meta">
            {variables.length ? (
              <span>
                {variables.map((variable) => `{{${variable}}}`).join(" ")}
              </span>
            ) : (
              <T id="pref-prompt-no-variables">无变量</T>
            )}
          </div>
          {message ? (
            <div
              className="zp-pref-message"
              data-kind={message.kind}
              role="status"
            >
              {message.text}
            </div>
          ) : null}
          <div className="zp-pref-actions">
            <button
              className="zp-pref-button zp-pref-button-primary"
              type="submit"
            >
              <Save size={14} />
              <T id="pref-prompt-save">保存 Prompt</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-danger"
              disabled={!selectedPromptId}
              onClick={onDelete}
              type="button"
            >
              <Trash2 size={14} />
              <T id="pref-prompt-delete">删除 Prompt</T>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function PageHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: ReactNode;
  title: ReactNode;
}): ReactElement {
  return (
    <header className="zp-pref-page-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="zp-pref-page-action">{action}</div> : null}
    </header>
  );
}

function NavButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count?: number;
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="zp-pref-nav-item"
      data-active={active || undefined}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
      {count ? <span className="zp-pref-nav-count">{count}</span> : null}
    </button>
  );
}

function T({
  children,
  id,
}: {
  children: ReactNode;
  id: string;
}): ReactElement {
  return <span data-l10n-id={id}>{children}</span>;
}

function getPromptErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "保存失败。";
  }
  if (error.message === "Prompt title is required.") {
    return "Prompt 标题不能为空。";
  }
  if (error.message === "Prompt body is required.") {
    return "模板问题不能为空。";
  }
  if (error.message === "Prompt not found.") {
    return "未找到该 Prompt。";
  }
  const invalidVariable = error.message.match(
    /^Invalid prompt variable: (.+)$/,
  );
  if (invalidVariable?.[1]) {
    return `无效的 Prompt 变量：${invalidVariable[1]}`;
  }
  return "保存失败。";
}

async function detectCodexConnection(
  getSubprocess: () => CodexDiscoverySubprocessModule,
): Promise<CodexConnectionState> {
  let subprocess: CodexDiscoverySubprocessModule | undefined;
  try {
    subprocess = getSubprocess();
    if (await checkCodexConnection(subprocess)) {
      return { status: "connected" };
    }
  } catch {
    return {
      status: "missing",
      messageKey: "codex-diagnostic-unknown-error",
    };
  }
  const diagnostic = subprocess
    ? await diagnoseCodexConnection(subprocess).catch(() => undefined)
    : undefined;
  return {
    status: "missing",
    messageKey: diagnostic?.messageKey || "codex-diagnostic-unknown-error",
  };
}
