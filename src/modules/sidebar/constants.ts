import { config } from "../../../package.json";

const READER_TOOLBAR_BUTTON_ID = "zopilot-reader-toolbar-toggle";
const CONTEXT_PANE_DECK_ID = "zopilot-context-pane-deck";
const PORTAL_ROOT_ID = "zopilot-portal-root";
const STYLE_URI = `chrome://${config.addonRef}/content/zoteroPane.css`;
const HTML_NS = "http://www.w3.org/1999/xhtml";

export {
  CONTEXT_PANE_DECK_ID,
  HTML_NS,
  PORTAL_ROOT_ID,
  READER_TOOLBAR_BUTTON_ID,
  STYLE_URI,
};
