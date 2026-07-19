import { ChevronRight, Plus, Save, Trash2 } from "lucide-react";
import { type ReactElement } from "react";
import type { PromptEditorMode, PromptMessage, PromptView } from "../types";
import { LocalizedMessageText, PageHeader, T } from "../PreferenceChrome";

export { PromptPanel };

type PromptEditorProps = {
  body: string;
  hasUnsavedChanges: boolean;
  message?: PromptMessage;
  onBodyChange: (body: string) => void;
  onDelete: () => void;
  onSave: () => void;
  onTitleChange: (title: string) => void;
  selectedPromptId?: string;
  title: string;
};

function PromptPanel({
  body,
  hasUnsavedChanges,
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
  hasUnsavedChanges: boolean;
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
  return (
    <PromptListPage
      body={body}
      hasUnsavedChanges={hasUnsavedChanges}
      message={message}
      mode={mode}
      onBack={onBack}
      onBodyChange={onBodyChange}
      onDelete={onDelete}
      onNew={onNew}
      onSave={onSave}
      onSelect={onSelect}
      onTitleChange={onTitleChange}
      prompts={prompts}
      selectedPromptId={selectedPromptId}
      title={title}
    />
  );
}

function PromptListPage({
  body,
  hasUnsavedChanges,
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
  hasUnsavedChanges: boolean;
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
  const creating = mode === "edit" && !selectedPromptId;
  const newEditorId = "zp-pref-prompt-new-editor";
  return (
    <section className="zp-pref-page">
      <PageHeader
        action={
          <button
            aria-controls={newEditorId}
            aria-expanded={creating}
            className="zp-pref-button zp-pref-button-secondary"
            onClick={creating ? onBack : onNew}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            <T id="pref-prompt-new" />
          </button>
        }
        description={<T id="pref-prompts-description" />}
        title={<T id="pref-prompts-title" />}
      />
      <div className="zp-pref-prompt-list-panel">
        {creating ? (
          <div className="zp-pref-prompt-create-item">
            <PromptEditor
              body={body}
              hasUnsavedChanges={hasUnsavedChanges}
              id={newEditorId}
              message={message}
              onBodyChange={onBodyChange}
              onDelete={onDelete}
              onSave={onSave}
              onTitleChange={onTitleChange}
              title={title}
            />
          </div>
        ) : null}
        {prompts.length ? (
          prompts.map((prompt) => {
            const expanded = mode === "edit" && prompt.id === selectedPromptId;
            const editorId = `zp-pref-prompt-editor-${prompt.id}`;
            return (
              <div
                className="zp-pref-prompt-list-item"
                data-expanded={expanded || undefined}
                key={prompt.id}
              >
                <button
                  aria-controls={editorId}
                  aria-expanded={expanded}
                  className="zp-pref-prompt-row"
                  data-selected={prompt.id === selectedPromptId || undefined}
                  onClick={() => (expanded ? onBack() : onSelect(prompt.id))}
                  title={prompt.body}
                  type="button"
                >
                  <span className="zp-pref-prompt-row-content">
                    <span className="zp-pref-prompt-row-title">
                      {prompt.title}
                    </span>
                    <span
                      aria-hidden="true"
                      className="zp-pref-prompt-row-separator"
                    >
                      ·
                    </span>
                    <span className="zp-pref-prompt-row-body">
                      {prompt.body}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="zp-pref-prompt-row-disclosure"
                    size={14}
                  />
                </button>
                {expanded ? (
                  <PromptEditor
                    body={body}
                    hasUnsavedChanges={hasUnsavedChanges}
                    id={editorId}
                    message={message}
                    onBodyChange={onBodyChange}
                    onDelete={onDelete}
                    onSave={onSave}
                    onTitleChange={onTitleChange}
                    selectedPromptId={selectedPromptId}
                    title={title}
                  />
                ) : null}
              </div>
            );
          })
        ) : !creating ? (
          <div className="zp-pref-empty">
            <T id="pref-prompt-empty" />
          </div>
        ) : null}
      </div>
      {message && mode !== "edit" ? (
        <div className="zp-pref-message" data-kind={message.kind} role="status">
          <LocalizedMessageText message={message.message} />
        </div>
      ) : null}
    </section>
  );
}

function PromptEditor({
  body,
  hasUnsavedChanges,
  id,
  message,
  onBodyChange,
  onDelete,
  onSave,
  onTitleChange,
  selectedPromptId,
  title,
}: PromptEditorProps & {
  id?: string;
}): ReactElement {
  return (
    <form
      className="zp-pref-prompt-editor"
      data-inline
      id={id}
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="zp-pref-prompt-editor-body">
        <label className="zp-pref-field">
          <span>
            <T id="pref-prompt-title-label" />
          </span>
          <input
            className="zp-pref-input"
            onChange={(event) => onTitleChange(event.currentTarget.value)}
            value={title}
          />
        </label>
        <label className="zp-pref-field">
          <span>
            <T id="pref-prompt-body-label" />
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
            disabled={!hasUnsavedChanges}
            type="submit"
          >
            <Save size={14} />
            <T id="pref-prompt-save" />
          </button>
          {selectedPromptId ? (
            <button
              className="zp-pref-button zp-pref-button-danger"
              onClick={onDelete}
              type="button"
            >
              <Trash2 size={14} />
              <T id="pref-prompt-delete" />
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
