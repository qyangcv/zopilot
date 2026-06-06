import { READER_TOOLBAR_BUTTON_ID, STYLE_URI } from "./constants";
import { getString } from "../../utils/locale";

export { createReaderToolbarButton };

function createReaderToolbarButton(
  doc: Document,
  open: boolean,
  onClick: () => void,
): HTMLButtonElement {
  injectReaderToolbarStylesheet(doc);

  const button = doc.createElement("button");
  button.id = READER_TOOLBAR_BUTTON_ID;
  button.className = "zcp-reader-toolbar-button";
  button.type = "button";
  button.title = getString("sidebar-toggle-tooltip");
  button.setAttribute("aria-label", getString("sidebar-toggle-tooltip"));
  button.setAttribute("aria-pressed", String(open));

  const icon = doc.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  button.addEventListener("click", onClick);

  return button;
}

function injectReaderToolbarStylesheet(doc: Document): void {
  const links = Array.from(
    doc.querySelectorAll('link[rel="stylesheet"]'),
  ) as HTMLLinkElement[];

  if (links.some((link) => link.getAttribute("href") === STYLE_URI)) {
    return;
  }
  const link = doc.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", STYLE_URI);
  doc.head?.appendChild(link);
}
