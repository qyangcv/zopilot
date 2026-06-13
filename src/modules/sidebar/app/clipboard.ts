export { copyText };

async function copyText(text: string): Promise<void> {
  const nav = (globalThis as typeof globalThis & { navigator?: Navigator })
    .navigator;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  const doc = (globalThis as typeof globalThis & { document?: Document })
    .document;
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
  doc.execCommand("copy");
  textarea.remove();
}
