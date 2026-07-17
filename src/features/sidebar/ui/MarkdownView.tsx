import {
  useCallback,
  useMemo,
  type MouseEvent,
  type ReactElement,
} from "react";
import { copyText } from "./clipboard";
import { isInternalUrl, renderMarkdownToHtml } from "./markdownRenderer";
import { beginSidebarPerformanceMeasure } from "./performanceMetrics";
import { createStaticIconElement } from "./staticIcons";

type MarkdownViewProps = {
  className?: string;
  segmentId?: string;
  markdown: string;
  onOpenLink: (url: string) => void;
  unwrapSingleParagraph?: boolean;
};

export function MarkdownView({
  className,
  segmentId,
  markdown,
  onOpenLink,
  unwrapSingleParagraph = false,
}: MarkdownViewProps): ReactElement {
  const finishCommit = beginSidebarPerformanceMeasure("markdown.reactCommit", {
    textLength: markdown.length,
  });
  const html = useMemo(
    () => renderMarkdownToHtml(markdown, { unwrapSingleParagraph }),
    [markdown, unwrapSingleParagraph],
  );
  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!hasClosest(target)) {
        return;
      }

      const copyButton = target.closest("button[data-zp-copy-code]");
      if (copyButton && event.currentTarget.contains(copyButton)) {
        event.preventDefault();
        void copyText(
          decodeCopyPayload(
            copyButton.getAttribute("data-zp-copy-code") ?? undefined,
          ),
        ).then(() => showCopiedState(copyButton));
        return;
      }

      const anchor = target.closest("a[href]");
      if (!anchor || !event.currentTarget.contains(anchor)) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || isInternalUrl(href)) {
        return;
      }

      event.preventDefault();
      onOpenLink(href);
    },
    [onOpenLink],
  );

  return (
    <div
      className={["zp-markdown-rendered", className].filter(Boolean).join(" ")}
      data-zp-markdown-segment={segmentId}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
      ref={
        finishCommit
          ? (element) => {
              if (element) finishCommit();
            }
          : undefined
      }
    />
  );
}

function hasClosest(target: EventTarget | null): target is Element {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}

function decodeCopyPayload(encoded: string | undefined): string {
  if (!encoded) {
    return "";
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
}

function showCopiedState(button: Element): void {
  const icon = button.querySelector("svg.zp-icon");
  if (!icon) {
    return;
  }

  const doc = button.ownerDocument;
  if (!doc) return;
  button.replaceChildren(
    createStaticIconElement(doc, "copied", {
      className: "zp-icon zp-code-copy-icon",
      size: 14,
    }),
  );
  doc.defaultView?.setTimeout(() => {
    if (!button.isConnected) return;
    button.replaceChildren(
      createStaticIconElement(doc, "copy", {
        className: "zp-icon zp-code-copy-icon",
        size: 14,
      }),
    );
  }, 900);
}
