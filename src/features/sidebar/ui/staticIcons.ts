import { BRAND_ICON_PATH } from "./brandIcon";

type StaticIconName = "brand" | "copied" | "copy";

type IconNode = readonly [
  tag: "circle" | "line" | "path" | "rect",
  attrs: Readonly<Record<string, string>>,
];

const ICON_NODES: Record<StaticIconName, readonly IconNode[]> = {
  brand: [
    [
      "path",
      {
        d: BRAND_ICON_PATH,
        stroke: "none",
      },
    ],
  ],
  copied: [["path", { d: "M20 6 9 17l-5-5" }]],
  copy: [
    ["rect", { height: "14", rx: "2", ry: "2", width: "14", x: "8", y: "8" }],
    ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }],
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderStaticIconHtml(
  name: StaticIconName,
  {
    className = "zp-icon",
    size = 14,
    strokeWidth = 1.8,
  }: {
    className?: string;
    size?: number;
    strokeWidth?: number;
  } = {},
): string {
  const children = ICON_NODES[name]
    .map(([tag, attrs]) => `<${tag}${renderAttributes(attrs)}></${tag}>`)
    .join("");
  return [
    `<svg aria-hidden="true" class="${className}" data-icon-name="${name}" focusable="false"${renderPresentationAttributes(name, strokeWidth)} height="${size}" viewBox="0 0 24 24" width="${size}">`,
    children,
    "</svg>",
  ].join("");
}

export function createStaticIconElement(
  doc: Document,
  name: StaticIconName,
  {
    className = "zp-icon",
    size = 20,
    strokeWidth = 1.8,
  }: {
    className?: string;
    size?: number;
    strokeWidth?: number;
  } = {},
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  svg.setAttribute("data-icon-name", name);
  svg.setAttribute("focusable", "false");
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  setPresentationAttributes(svg, name, strokeWidth);

  for (const [tag, attrs] of ICON_NODES[name]) {
    const child = doc.createElementNS(SVG_NS, tag);
    for (const [attr, value] of Object.entries(attrs)) {
      child.setAttribute(attr, value);
    }
    svg.appendChild(child);
  }

  return svg;
}

function renderAttributes(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
}

function renderPresentationAttributes(
  name: StaticIconName,
  strokeWidth: number,
): string {
  if (name === "brand") {
    return ' fill="currentColor"';
  }
  return ` fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="${strokeWidth}"`;
}

function setPresentationAttributes(
  svg: SVGSVGElement,
  name: StaticIconName,
  strokeWidth: number,
): void {
  if (name === "brand") {
    svg.setAttribute("fill", "currentColor");
    return;
  }
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-width", String(strokeWidth));
}
