import { getString } from "../../utils/locale";

export { getPlaceholderAnswer };

function getPlaceholderAnswer(): string {
  return [
    getString("sidebar-placeholder-answer"),
    "",
    `- ${getString("sidebar-placeholder-context")}`,
    `- ${getString("sidebar-placeholder-rendering")}`,
    "",
    `| ${getString("sidebar-placeholder-surface")} | ${getString(
      "sidebar-placeholder-status",
    )} |`,
    "| --- | --- |",
    `| Markdown | ${getString("sidebar-placeholder-markdown-ready")} |`,
    `| LaTeX | ${getString("sidebar-placeholder-latex-placeholder")} |`,
    "",
    `${getString("sidebar-placeholder-inline-formula")} $E = mc^2$`,
    "",
    "$$",
    "p(y \\mid x) = \\prod_t p(y_t \\mid y_{<t}, x)",
    "$$",
    "",
    "[Zotero](https://www.zotero.org)",
  ].join("\n");
}
