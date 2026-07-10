import { getString } from "../../app/localization";

export function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/zopilot.svg`,
    scripts: [rootURI + "content/preferences.js"],
    stylesheets: [rootURI + "content/preferences.css"],
  });
}
