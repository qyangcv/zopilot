import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  updateCustomPrompt,
} from "../../../sidebar/prompts/promptStore";
import type { PromptEditorMode, PromptMessage, PromptView } from "../types";

export { usePromptEditor };

function usePromptEditor(): {
  body: string;
  mode: PromptEditorMode;
  message?: PromptMessage;
  openNewPromptEditor: () => void;
  openPromptEditor: (promptId: string) => void;
  prompts: PromptView[];
  removePrompt: () => void;
  returnToPromptList: () => void;
  savePrompt: () => void;
  selectedPromptId?: string;
  setBody: (body: string) => void;
  setTitle: (title: string) => void;
  title: string;
} {
  const [promptState, setPromptState] = useState(() => {
    const prompts = loadCustomPrompts();
    return {
      prompts,
      selectedPromptId: undefined as string | undefined,
    };
  });
  const [mode, setMode] = useState<PromptEditorMode>("list");
  const [promptTitle, setPromptTitle] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [savedDraft, setSavedDraft] = useState({ title: "", body: "" });
  const [promptMessage, setPromptMessage] = useState<PromptMessage>();

  const selectedPrompt = useMemo(
    () =>
      promptState.prompts.find(
        (prompt) => prompt.id === promptState.selectedPromptId,
      ),
    [promptState.prompts, promptState.selectedPromptId],
  );
  const hasUnsavedChanges =
    mode === "edit" &&
    (promptTitle !== savedDraft.title || promptBody !== savedDraft.body);

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }
    if (!selectedPrompt) {
      setPromptTitle("");
      setPromptBody("");
      setSavedDraft({ title: "", body: "" });
      return;
    }
    setPromptTitle(selectedPrompt.title);
    setPromptBody(selectedPrompt.body);
    setSavedDraft({ title: selectedPrompt.title, body: selectedPrompt.body });
  }, [mode, selectedPrompt]);

  const refreshPrompts = useCallback(
    (nextSelectedId?: string) => {
      const nextPrompts = loadCustomPrompts();
      setPromptState({
        prompts: nextPrompts,
        selectedPromptId:
          nextSelectedId ||
          nextPrompts.find(
            (prompt) => prompt.id === promptState.selectedPromptId,
          )?.id ||
          nextPrompts[0]?.id,
      });
    },
    [promptState.selectedPromptId],
  );

  const openPromptEditor = useCallback(
    (promptId: string) => {
      const prompt = promptState.prompts.find((item) => item.id === promptId);
      if (!prompt) {
        setPromptMessage({ kind: "error", text: "未找到该 Prompt。" });
        return;
      }
      setPromptState((current) => ({
        ...current,
        selectedPromptId: promptId,
      }));
      setPromptTitle(prompt.title);
      setPromptBody(prompt.body);
      setSavedDraft({ title: prompt.title, body: prompt.body });
      setPromptMessage(undefined);
      setMode("edit");
    },
    [promptState.prompts],
  );

  const openNewPromptEditor = useCallback(() => {
    setPromptState((current) => ({
      ...current,
      selectedPromptId: undefined,
    }));
    setPromptTitle("");
    setPromptBody("");
    setSavedDraft({ title: "", body: "" });
    setPromptMessage(undefined);
    setMode("edit");
  }, []);

  const returnToPromptList = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !confirmPromptAction("当前 Prompt 有未保存修改，确定返回列表？")
    ) {
      return;
    }
    setMode("list");
    setPromptMessage(undefined);
  }, [hasUnsavedChanges]);

  const savePrompt = useCallback(() => {
    try {
      const saved = promptState.selectedPromptId
        ? updateCustomPrompt(promptState.selectedPromptId, {
            title: promptTitle,
            body: promptBody,
          })
        : createCustomPrompt({ title: promptTitle, body: promptBody });
      refreshPrompts(saved.id);
      setSavedDraft({ title: saved.title, body: saved.body });
      setPromptMessage({ kind: "success", text: "已保存。" });
    } catch (error) {
      setPromptMessage({
        kind: "error",
        text: getPromptErrorMessage(error),
      });
    }
  }, [promptBody, promptState.selectedPromptId, promptTitle, refreshPrompts]);

  const removePrompt = useCallback(() => {
    if (!promptState.selectedPromptId) {
      return;
    }
    if (!confirmPromptAction("确定删除这个 Prompt？")) {
      return;
    }
    deleteCustomPrompt(promptState.selectedPromptId);
    refreshPrompts();
    setPromptState((current) => ({
      ...current,
      selectedPromptId: undefined,
    }));
    setPromptTitle("");
    setPromptBody("");
    setSavedDraft({ title: "", body: "" });
    setMode("list");
    setPromptMessage({ kind: "success", text: "已删除。" });
  }, [promptState.selectedPromptId, refreshPrompts]);

  return {
    body: promptBody,
    mode,
    message: promptMessage,
    openNewPromptEditor,
    openPromptEditor,
    prompts: promptState.prompts,
    removePrompt,
    returnToPromptList,
    savePrompt,
    selectedPromptId: promptState.selectedPromptId,
    setBody: setPromptBody,
    setTitle: setPromptTitle,
    title: promptTitle,
  };
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
  return "保存失败。";
}

function confirmPromptAction(message: string): boolean {
  const host = globalThis as typeof globalThis & {
    confirm?: (message?: string) => boolean;
  };
  return typeof host.confirm !== "function" || host.confirm(message);
}
