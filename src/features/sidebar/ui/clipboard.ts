export { copyText };

async function copyText(text: string, win = getGlobalWindow()): Promise<void> {
  if (copyWithGeckoClipboard(text, win)) {
    return;
  }

  const nav =
    win?.navigator ??
    (globalThis as typeof globalThis & { navigator?: Navigator }).navigator;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  const doc =
    win?.document ??
    (globalThis as typeof globalThis & { document?: Document }).document;
  if (!doc?.body) {
    return;
  }
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  doc.body.append(textarea);
  textarea.select();
  const copied = doc.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function getGlobalWindow(): Window | undefined {
  return (globalThis as typeof globalThis & { window?: Window }).window;
}

function copyWithGeckoClipboard(text: string, win?: Window): boolean {
  const components =
    (win as ClipboardWindow | undefined)?.Components ??
    (globalThis as ClipboardWindow).Components;
  const helperClass =
    components?.classes["@mozilla.org/widget/clipboardhelper;1"];
  const helperInterface = components?.interfaces.nsIClipboardHelper;
  if (!helperClass || !helperInterface) {
    return false;
  }

  try {
    helperClass.getService(helperInterface).copyString(text);
    return true;
  } catch {
    return false;
  }
}

type ClipboardWindow = {
  Components?: {
    classes: Record<
      string,
      | {
          getService: (iface: unknown) => {
            copyString: (value: string) => void;
          };
        }
      | undefined
    >;
    interfaces: Record<string, unknown>;
  };
};
