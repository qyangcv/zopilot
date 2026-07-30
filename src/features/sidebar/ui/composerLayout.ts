const DEFAULT_HOST_HEIGHT = 680;
const MIN_MAX_HEIGHT = 140;
const MAX_HOST_HEIGHT_RATIO = 0.42;
const pendingFrames = new WeakMap<HTMLTextAreaElement, number>();

function resizeTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;

  const hostHeight =
    (textarea.closest(".zp-sidebar") as HTMLElement | null)?.clientHeight ||
    DEFAULT_HOST_HEIGHT;
  const maxHeight = Math.max(
    MIN_MAX_HEIGHT,
    Math.floor(hostHeight * MAX_HOST_HEIGHT_RATIO),
  );

  textarea.style.maxHeight = `${maxHeight}px`;
  /*
   * Gecko ESR 140 can preserve the old textarea scrollport while rebuilding
   * its anonymous editor. Reset the viewport before reading scrollHeight so a
   * whole-buffer deletion can shrink from the previous capped height.
   */
  textarea.style.height = "0px";
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
}

function requestTextareaResize(textarea: HTMLTextAreaElement | null): void {
  if (!textarea || pendingFrames.has(textarea)) return;
  const win = textarea.ownerDocument?.defaultView;
  if (!win) return;

  const frame = win.requestAnimationFrame(() => {
    pendingFrames.delete(textarea);
    if (textarea.isConnected) resizeTextarea(textarea);
  });
  pendingFrames.set(textarea, frame);
}

function cancelTextareaResize(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  const frame = pendingFrames.get(textarea);
  if (frame === undefined) return;
  pendingFrames.delete(textarea);
  textarea.ownerDocument?.defaultView?.cancelAnimationFrame(frame);
}

export { cancelTextareaResize, requestTextareaResize, resizeTextarea };
