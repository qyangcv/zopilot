import { config } from "../../../package.json";

const TOOLBAR_TOGGLE_BUTTON_ID = "zotero-copilot-sidebar-toolbar-toggle";
const READER_TOOLBAR_BUTTON_ID = "zotero-copilot-reader-toolbar-toggle";
const SIDEBAR_ID = "zotero-copilot-sidebar-shell";
const SPLITTER_ID = "zotero-copilot-sidebar-splitter";
const STYLE_URI = `chrome://${config.addonRef}/content/zoteroPane.css`;
const ICON_URI = `chrome://${config.addonRef}/content/icons/message-circle.svg`;
const HTML_NS = "http://www.w3.org/1999/xhtml";

export {
  HTML_NS,
  ICON_URI,
  READER_TOOLBAR_BUTTON_ID,
  SIDEBAR_ID,
  SPLITTER_ID,
  STYLE_URI,
  TOOLBAR_TOGGLE_BUTTON_ID,
};
