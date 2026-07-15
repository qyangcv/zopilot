import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = join(root, "src");
const files = await listSourceFiles(sourceRoot);

const absoluteBans = [
  /\b_iframeWindow\b/u,
  /\b_readers\b/u,
  /\b_initPromise\b/u,
  /\b_unregisterEventListenerByPluginID\b/u,
  /\bZotero\s*\.\s*DB\b/u,
  /\bZotero\s*\.\s*Profile\b/u,
  /\bglobalThis\s*\.\s*(?:window|document)\b/u,
  /\bztoolkit\b/iu,
];

const scopedRules = [
  {
    pattern: /\b(?:Components|ChromeUtils|IOUtils|PathUtils)\b/u,
    allow: ["src/platform/gecko.ts"],
    label: "Gecko platform global",
  },
  {
    pattern: /\bZotero\s*\.\s*Server\s*\.\s*Endpoints\b/u,
    allow: ["src/integrations/zotero/compat/serverEndpointRegistry.ts"],
    label: "Zotero.Server.Endpoints",
  },
  {
    pattern: /\bcreateXULElement\b/u,
    allow: [
      "src/features/sidebar/host/ContextPaneAdapter.ts",
      "src/features/sidebar/host/LibraryItemPaneAdapter.ts",
    ],
    label: "XUL element creation",
  },
  {
    pattern: /\bselectedPanel\b/u,
    allow: [
      "src/features/sidebar/host/ContextPaneAdapter.ts",
      "src/features/sidebar/host/LibraryItemPaneAdapter.ts",
      "src/features/sidebar/host/contextPaneProbe.ts",
      "src/features/sidebar/host/libraryItemPaneProbe.ts",
    ],
    label: "XUL deck selection",
  },
  {
    pattern: /\bZotero_Tabs\b/u,
    allow: [
      "src/integrations/zotero/reader.ts",
      "src/integrations/zotero/selectedWorkspace.ts",
    ],
    label: "Zotero tab compatibility API",
  },
  {
    pattern: /\bZoteroContextPane\b/u,
    allow: ["src/features/sidebar/host/ContextPaneAdapter.ts"],
    label: "Zotero Context Pane compatibility API",
  },
  {
    pattern: /\bZoteroPane\b/u,
    allow: [
      "src/features/sidebar/host/selectedItem.ts",
      "src/integrations/zotero/selectedWorkspace.ts",
    ],
    label: "Zotero pane compatibility API",
  },
  {
    pattern:
      /\bzotero-(?:pane|context-pane|item-pane|view-item-sidenav|collections-tree|items-tree)\b|\.highlight-notes-(?:active|inactive)|\.btn\[data-pane\]/u,
    allow: [
      "src/features/sidebar/windowRuntime.tsx",
      "src/features/sidebar/host/ContextPaneAdapter.ts",
      "src/features/sidebar/host/ContextPaneSidenavAdapter.ts",
      "src/features/sidebar/host/LibraryItemPaneAdapter.ts",
      "src/features/sidebar/host/SidebarHostBindings.ts",
      "src/features/sidebar/host/SidebarSurface.ts",
      "src/features/sidebar/host/contextPaneProbe.ts",
      "src/features/sidebar/host/libraryItemPaneProbe.ts",
      "src/features/sidebar/host/portalHost.ts",
      "src/integrations/zotero/selectedWorkspace.ts",
    ],
    label: "Zotero host selector",
  },
];

const failures = [];
for (const file of files) {
  const path = relative(root, file).replaceAll("\\", "/");
  const text = await readFile(file, "utf8");
  for (const pattern of absoluteBans) {
    if (pattern.test(text)) failures.push(`${path}: forbidden ${pattern}`);
  }
  for (const rule of scopedRules) {
    if (rule.pattern.test(text) && !rule.allow.includes(path)) {
      failures.push(
        `${path}: ${rule.label} must stay in its compatibility layer`,
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `API boundary check passed (${files.length} source files).\n`,
  );
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listSourceFiles(path) : [path];
    }),
  );
  return nested
    .flat()
    .filter((path) => [".ts", ".tsx"].includes(extname(path)));
}
