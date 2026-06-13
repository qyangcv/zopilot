import { config } from "../../../package.json";

const READER_TOOLBAR_BUTTON_ID = "zopilot-reader-toolbar-toggle";
const SIDEBAR_ID = "zopilot-sidebar-shell";
const SPLITTER_ID = "zopilot-sidebar-splitter";
const STYLE_URI = `chrome://${config.addonRef}/content/zoteroPane.css`;
const HTML_NS = "http://www.w3.org/1999/xhtml";

export {
  HTML_NS,
  READER_TOOLBAR_BUTTON_ID,
  SIDEBAR_ID,
  SPLITTER_ID,
  STYLE_URI,
};
