import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  updateCustomPrompt,
} from "../../sidebar/promptStore";
import { extractPromptVariables } from "../../sidebar/promptSchema";
import type { PromptMessage, PromptView } from "./types";

export { usePromptEditor };

function usePromptEditor(): {
  body: string;
  createBlankPrompt: () => void;
  message?: PromptMessage;
  prompts: PromptView[];
  removePrompt: () => void;
  savePrompt: () => void;
  selectPrompt: (promptId: string) => void;
  selectedPromptId?: string;
  setBody: (body: string) => void;
  setTitle: (title: string) => void;
  title: string;
  variables: string[];
} {
  const [promptState, setPromptState] = useState(() => {
    const prompts = loadCustomPrompts();
    return {
      prompts,
      selectedPromptId: prompts[0]?.id as string | undefined,
    };
  });
  const [promptTitle, setPromptTitle] = useState("");
  const [promptBody, setPromptBody] = useState("");
  const [promptMessage, setPromptMessage] = useState<PromptMessage>();

  const selectedPrompt = useMemo(
    () =>
      promptState.prompts.find(
        (prompt) => prompt.id === promptState.selectedPromptId,
      ),
    [promptState.prompts, promptState.selectedPromptId],
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

  const selectPrompt = useCallback((promptId: string) => {
    setPromptState((current) => ({
      ...current,
      selectedPromptId: promptId,
    }));
    setPromptMessage(undefined);
  }, []);

  const createBlankPrompt = useCallback(() => {
    setPromptState((current) => ({
      ...current,
      selectedPromptId: undefined,
    }));
    setPromptTitle("");
    setPromptBody("");
    setPromptMessage(undefined);
  }, []);

  const savePrompt = useCallback(() => {
    try {
      const saved = promptState.selectedPromptId
        ? updateCustomPrompt(promptState.selectedPromptId, {
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
  }, [promptBody, promptState.selectedPromptId, promptTitle, refreshPrompts]);

  const removePrompt = useCallback(() => {
    if (!promptState.selectedPromptId) {
      return;
    }
    deleteCustomPrompt(promptState.selectedPromptId);
    refreshPrompts();
    setPromptMessage({ kind: "success", text: "已删除。" });
  }, [promptState.selectedPromptId, refreshPrompts]);

  return {
    body: promptBody,
    createBlankPrompt,
    message: promptMessage,
    prompts: promptState.prompts,
    removePrompt,
    savePrompt,
    selectPrompt,
    selectedPromptId: promptState.selectedPromptId,
    setBody: setPromptBody,
    setTitle: setPromptTitle,
    title: promptTitle,
    variables,
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
  const invalidVariable = error.message.match(
    /^Invalid prompt variable: (.+)$/,
  );
  if (invalidVariable?.[1]) {
    return `无效的 Prompt 变量：${invalidVariable[1]}`;
  }
  return "保存失败。";
}
