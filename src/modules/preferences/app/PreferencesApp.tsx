import {
  CircleAlert,
  Download,
  FileText,
  LoaderCircle,
  PackageCheck,
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
  getPdfHelperStatus,
  installPdfHelperDependency,
  removePdfHelperDependency,
  type PdfHelperInstallProgress,
  type PdfHelperStatus,
} from "../../../document/pdfHelper";
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

type PreferenceSection = "connection" | "dependencies" | "prompts";
type PromptView = ReturnType<typeof loadCustomPrompts>[number];
type CodexConnectionState =
  | { status: "checking" }
  | { status: "connected" }
  | { status: "missing"; messageKey: CodexDiagnosticMessageKey };
type DependencyState =
  | { status: "checking" }
  | { status: "installing"; progress?: PdfHelperInstallProgress }
  | { status: "removing" }
  | { status: "ready"; helper: PdfHelperStatus }
  | { status: "error"; helper?: PdfHelperStatus; message: string };
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
  const [dependencyState, setDependencyState] = useState<DependencyState>({
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
  const runDependencyCheck = () => {
    setDependencyState({ status: "checking" });
    void getPdfHelperStatus()
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          message: stringifyError(error),
        }),
      );
  };
  const installDependencies = () => {
    const currentHelper =
      dependencyState.status === "ready" || dependencyState.status === "error"
        ? dependencyState.helper
        : undefined;
    setDependencyState({
      status: "installing",
      progress: { phase: "manifest", percent: 0 },
    });
    let subprocess: CodexDiscoverySubprocessModule;
    try {
      subprocess = getSubprocess();
    } catch (error) {
      setDependencyState({
        status: "error",
        helper: currentHelper,
        message: stringifyError(error),
      });
      return;
    }
    void installPdfHelperDependency(subprocess, (progress) => {
      setDependencyState({ status: "installing", progress });
    })
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          helper: currentHelper,
          message: stringifyError(error),
        }),
      );
  };
  const removeDependencies = () => {
    const currentHelper =
      dependencyState.status === "ready" || dependencyState.status === "error"
        ? dependencyState.helper
        : undefined;
    setDependencyState({ status: "removing" });
    void removePdfHelperDependency()
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          helper: currentHelper,
          message: stringifyError(error),
        }),
      );
  };

  useEffect(runConnectionCheck, []);
  useEffect(runDependencyCheck, []);

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
        <nav className="zp-pref-nav">
          <NavButton
            active={activeSection === "connection"}
            count={connection.status === "connected" ? undefined : 1}
            icon={<PlugZap size={16} />}
            label={<T id="pref-nav-connection">连接</T>}
            onClick={() => setActiveSection("connection")}
          />
          <NavButton
            active={activeSection === "dependencies"}
            count={dependencyNavCount(dependencyState)}
            icon={<PackageCheck size={16} />}
            label={<T id="pref-nav-dependencies">依赖管理</T>}
            onClick={() => setActiveSection("dependencies")}
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
        ) : activeSection === "dependencies" ? (
          <DependenciesPanel
            onCheck={runDependencyCheck}
            onInstall={installDependencies}
            onRemove={removeDependencies}
            state={dependencyState}
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

function DependenciesPanel({
  onCheck,
  onInstall,
  onRemove,
  state,
}: {
  onCheck: () => void;
  onInstall: () => void;
  onRemove: () => void;
  state: DependencyState;
}): ReactElement {
  const helper =
    state.status === "ready" || state.status === "error"
      ? state.helper
      : undefined;
  const busy =
    state.status === "checking" ||
    state.status === "installing" ||
    state.status === "removing";
  const installed = helper?.status === "installed";
  const unsupported = helper?.status === "unsupported";
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-dependencies-description">
            管理 Zopilot 私有 PDF 解析 helper，不会安装到系统 Python。
          </T>
        }
        title={<T id="pref-dependencies-title">依赖管理</T>}
      />
      <div className="zp-pref-card">
        <div className="zp-pref-card-header">
          <div>
            <h3>
              <T id="pref-pdf-helper-card-title">PDF 解析 helper</T>
            </h3>
            <p>
              <T id="pref-pdf-helper-card-description">
                用于解析 PDF、提取文本并渲染页面图片。
              </T>
            </p>
          </div>
          <div className="zp-pref-button-group">
            <button
              className="zp-pref-button zp-pref-button-secondary"
              disabled={busy}
              onClick={onCheck}
              type="button"
            >
              <RotateCcw size={14} />
              <T id="pref-dependencies-check">检测</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-primary"
              disabled={busy || installed || unsupported}
              onClick={onInstall}
              type="button"
            >
              {state.status === "installing" ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <Download size={14} />
              )}
              <T id="pref-dependencies-install">安装</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-danger"
              disabled={busy || unsupported}
              onClick={onRemove}
              type="button"
            >
              {state.status === "removing" ? (
                <LoaderCircle className="zp-pref-spin" size={14} />
              ) : (
                <Trash2 size={14} />
              )}
              <T id="pref-dependencies-remove">删除</T>
            </button>
          </div>
        </div>
        <DependencyStatus state={state} />
        {state.status === "installing" ? (
          <DependencyProgress progress={state.progress} />
        ) : null}
        {helper ? <DependencyPathList helper={helper} /> : null}
        {state.status === "error" ? (
          <div className="zp-pref-message" data-kind="error" role="status">
            {state.message}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DependencyProgress({
  progress,
}: {
  progress?: PdfHelperInstallProgress;
}): ReactElement {
  const percent = normalizeInstallPercent(progress?.percent);
  return (
    <div className="zp-pref-progress" role="status">
      <div className="zp-pref-progress-header">
        <span>{installProgressLabel(progress?.phase)}</span>
        <span>{percent}%</span>
      </div>
      <progress max={100} value={percent} />
      {progress?.phase === "download" &&
      typeof progress.loaded === "number" &&
      typeof progress.total === "number" ? (
        <div className="zp-pref-progress-meta">
          {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
        </div>
      ) : null}
    </div>
  );
}

function DependencyStatus({ state }: { state: DependencyState }): ReactElement {
  if (state.status === "checking") {
    return (
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-checking">正在检测依赖...</T>
      </div>
    );
  }
  if (state.status === "installing") {
    return (
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-installing">正在安装依赖...</T>
      </div>
    );
  }
  if (state.status === "removing") {
    return (
      <div className="zp-pref-status">
        <LoaderCircle className="zp-pref-spin" size={16} />
        <T id="pref-dependencies-status-removing">正在删除依赖...</T>
      </div>
    );
  }
  const helper = state.helper;
  if (!helper) {
    return (
      <div className="zp-pref-status zp-pref-status-missing">
        <CircleAlert size={16} />
        <T id="pref-dependencies-status-error">依赖状态检测失败</T>
      </div>
    );
  }
  if (helper.status === "installed") {
    return (
      <div className="zp-pref-status zp-pref-status-connected">
        <PackageCheck size={16} />
        <T id="pref-dependencies-status-installed">已安装</T>
      </div>
    );
  }
  if (helper.status === "unsupported") {
    return (
      <div className="zp-pref-status zp-pref-status-missing">
        <CircleAlert size={16} />
        <T id="pref-dependencies-status-unsupported">当前平台暂不支持</T>
      </div>
    );
  }
  return (
    <div className="zp-pref-status zp-pref-status-missing">
      <CircleAlert size={16} />
      <T id="pref-dependencies-status-not-installed">未安装</T>
    </div>
  );
}

function DependencyPathList({
  helper,
}: {
  helper: PdfHelperStatus;
}): ReactElement {
  const rows = [
    {
      label: <T id="pref-dependencies-platform">平台</T>,
      value: helper.status === "unsupported" ? "unsupported" : helper.platform,
    },
    {
      label: <T id="pref-dependencies-version">版本</T>,
      value: helper.version,
    },
    {
      label: <T id="pref-dependencies-install-dir">安装目录</T>,
      value: helper.installDir,
    },
    {
      label: <T id="pref-dependencies-executable-path">可执行文件</T>,
      value: helper.executablePath,
    },
    {
      label: <T id="pref-dependencies-manifest-url">Manifest</T>,
      value: helper.manifestUrl,
    },
  ];
  return (
    <dl className="zp-pref-path-list">
      {rows.map((row) => (
        <div className="zp-pref-path-row" key={row.value}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
      {helper.status === "unsupported" ? (
        <div className="zp-pref-path-row">
          <dt>
            <T id="pref-dependencies-unsupported-reason">原因</T>
          </dt>
          <dd>{helper.reason}</dd>
        </div>
      ) : null}
    </dl>
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
          {connection.status === "checking" ? (
            <T id="pref-codex-status-checking">正在检查 Codex 连接...</T>
          ) : connection.status === "connected" ? (
            <T id="pref-codex-status-connected">已连接</T>
          ) : (
            <T id="pref-codex-status-missing">未连接</T>
          )}
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

function dependencyNavCount(state: DependencyState): number | undefined {
  if (state.status === "checking" || state.status === "installing") {
    return undefined;
  }
  if (state.status === "ready") {
    return state.helper.status === "installed" ? undefined : 1;
  }
  if (state.status === "error") {
    return 1;
  }
  return undefined;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeInstallPercent(percent?: number): number {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function installProgressLabel(
  phase?: PdfHelperInstallProgress["phase"],
): ReactNode {
  switch (phase) {
    case "manifest":
      return <T id="pref-dependencies-progress-manifest">读取 manifest</T>;
    case "download":
      return <T id="pref-dependencies-progress-download">下载 helper</T>;
    case "verify":
      return <T id="pref-dependencies-progress-verify">校验下载</T>;
    case "write":
      return <T id="pref-dependencies-progress-write">写入文件</T>;
    case "extract":
      return <T id="pref-dependencies-progress-extract">解压安装</T>;
    case "complete":
      return <T id="pref-dependencies-progress-complete">安装完成</T>;
    default:
      return <T id="pref-dependencies-progress-starting">准备安装</T>;
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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
