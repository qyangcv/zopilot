import { ArrowLeft, ChevronRight, Plus, Save, Trash2 } from "lucide-react";
import { type ReactElement } from "react";
import { l10nAttributes } from "../../localization";
import type { PromptEditorMode, PromptMessage, PromptView } from "../types";
import { LocalizedMessageText, PageHeader, T } from "../PreferenceChrome";

export { PromptPanel };

function PromptPanel({
  body,
  message,
  mode,
  onBack,
  onBodyChange,
  onDelete,
  onNew,
  onSave,
  onSelect,
  onTitleChange,
  prompts,
  selectedPromptId,
  title,
}: {
  body: string;
  message?: PromptMessage;
  mode: PromptEditorMode;
  onBack: () => void;
  onBodyChange: (body: string) => void;
  onDelete: () => void;
  onNew: () => void;
  onSave: () => void;
  onSelect: (promptId: string) => void;
  onTitleChange: (title: string) => void;
  prompts: PromptView[];
  selectedPromptId?: string;
  title: string;
}): ReactElement {
  if (mode === "edit") {
    return (
      <PromptEditPage
        body={body}
        message={message}
        onBack={onBack}
        onBodyChange={onBodyChange}
        onDelete={onDelete}
        onSave={onSave}
        onTitleChange={onTitleChange}
        selectedPromptId={selectedPromptId}
        title={title}
      />
    );
  }

  return (
    <PromptListPage
      message={message}
      onNew={onNew}
      onSelect={onSelect}
      prompts={prompts}
      selectedPromptId={selectedPromptId}
    />
  );
}

function PromptListPage({
  message,
  onNew,
  onSelect,
  prompts,
  selectedPromptId,
}: {
  message?: PromptMessage;
  onNew: () => void;
  onSelect: (promptId: string) => void;
  prompts: PromptView[];
  selectedPromptId?: string;
}): ReactElement {
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={
          <T id="pref-prompts-description">
            创建可从 Zopilot 侧边栏快速插入的模板问题。
          </T>
        }
        title={<T id="pref-prompts-title">提示词</T>}
      />
      <div className="zp-pref-prompt-list-actions">
        <button
          className="zp-pref-button zp-pref-button-primary"
          onClick={onNew}
          type="button"
        >
          <Plus size={14} />
          <T id="pref-prompt-new">新建提示词</T>
        </button>
      </div>
      <div className="zp-pref-prompt-list-panel">
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
              <span className="zp-pref-prompt-row-content">
                <span className="zp-pref-prompt-row-title">{prompt.title}</span>
                <span className="zp-pref-prompt-row-body">{prompt.body}</span>
              </span>
              <ChevronRight size={16} />
            </div>
          ))
        ) : (
          <div className="zp-pref-empty">
            <T id="pref-prompt-empty">暂无自定义提示词</T>
          </div>
        )}
      </div>
      {message ? (
        <div className="zp-pref-message" data-kind={message.kind} role="status">
          <LocalizedMessageText message={message.message} />
        </div>
      ) : null}
    </section>
  );
}

function PromptEditPage({
  body,
  message,
  onBack,
  onBodyChange,
  onDelete,
  onSave,
  onTitleChange,
  selectedPromptId,
  title,
}: {
  body: string;
  message?: PromptMessage;
  onBack: () => void;
  onBodyChange: (body: string) => void;
  onDelete: () => void;
  onSave: () => void;
  onTitleChange: (title: string) => void;
  selectedPromptId?: string;
  title: string;
}): ReactElement {
  return (
    <section className="zp-pref-page zp-pref-prompt-edit-page">
      <form
        className="zp-pref-prompt-editor"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header className="zp-pref-prompt-edit-header">
          <button
            className="zp-pref-back-button"
            {...l10nAttributes("pref-prompt-back-button")}
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={15} />
          </button>
        </header>
        <div className="zp-pref-editor-card">
          <label className="zp-pref-field">
            <span>
              <T id="pref-prompt-title-label">名称</T>
            </span>
            <input
              className="zp-pref-input"
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              value={title}
            />
          </label>
          <label className="zp-pref-field">
            <span>
              <T id="pref-prompt-body-label">内容</T>
            </span>
            <textarea
              className="zp-pref-textarea"
              onChange={(event) => onBodyChange(event.currentTarget.value)}
              value={body}
            />
          </label>
          {message ? (
            <div
              className="zp-pref-message"
              data-kind={message.kind}
              role="status"
            >
              <LocalizedMessageText message={message.message} />
            </div>
          ) : null}
          <div className="zp-pref-actions zp-pref-prompt-edit-actions">
            <button
              className="zp-pref-button zp-pref-button-primary"
              type="submit"
            >
              <Save size={14} />
              <T id="pref-prompt-save">保存</T>
            </button>
            <button
              className="zp-pref-button zp-pref-button-danger"
              disabled={!selectedPromptId}
              onClick={onDelete}
              type="button"
            >
              <Trash2 size={14} />
              <T id="pref-prompt-delete">删除</T>
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
