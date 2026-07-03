import { Plus, Save, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import type { PromptMessage, PromptView } from "./types";
import { PageHeader, T } from "./shared";

export { PromptPanel };

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
