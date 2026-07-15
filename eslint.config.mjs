// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: {
    name: "zopilot/api-boundaries",
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/platform/gecko.ts",
      "src/features/sidebar/host/ContextPaneAdapter.ts",
      "src/features/sidebar/host/ContextPaneSidenavAdapter.ts",
      "src/features/sidebar/host/LibraryItemPaneAdapter.ts",
      "src/features/sidebar/host/SidebarHostBindings.ts",
      "src/features/sidebar/host/SidebarSurface.ts",
      "src/features/sidebar/host/contextPaneProbe.ts",
      "src/features/sidebar/host/libraryItemPaneProbe.ts",
      "src/features/sidebar/host/portalHost.ts",
      "src/features/sidebar/host/selectedItem.ts",
      "src/features/sidebar/windowRuntime.tsx",
      "src/integrations/zotero/compat/**/*.ts",
      "src/integrations/zotero/reader.ts",
      "src/integrations/zotero/selectedWorkspace.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Components", message: "Use src/platform/gecko.ts." },
        { name: "ChromeUtils", message: "Use src/platform/gecko.ts." },
        { name: "IOUtils", message: "Use src/platform/gecko.ts." },
        { name: "PathUtils", message: "Use src/platform/gecko.ts." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='globalThis'][property.name=/^(window|document)$/]",
          message: "Do not install or read DOM globals from the plugin realm.",
        },
        {
          selector:
            "MemberExpression[property.name=/^(_iframeWindow|_readers|_initPromise|_unregisterEventListenerByPluginID)$/]",
          message: "Private Zotero Reader APIs are forbidden.",
        },
        {
          selector:
            "MemberExpression[object.name='Zotero'][property.name=/^(DB|Profile)$/]",
          message: "Use public Zotero object APIs and the platform adapter.",
        },
        {
          selector: "MemberExpression[property.name='createXULElement']",
          message:
            "XUL creation is restricted to the sidebar compatibility layer.",
        },
        {
          selector:
            "MemberExpression[property.name=/^(Zotero_Tabs|ZoteroPane|ZoteroContextPane|selectedPanel)$/]",
          message:
            "Zotero host internals are restricted to compatibility files.",
        },
        {
          selector:
            "Literal[value=/^#?zotero-(pane|context-pane|item-pane|view-item-sidenav|collections-tree|items-tree)/]",
          message:
            "Zotero host selectors are restricted to the sidebar host layer.",
        },
      ],
    },
  },
});
