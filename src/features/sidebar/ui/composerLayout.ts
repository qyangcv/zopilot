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

export { resizeTextarea };
