import {
  useCallback,
  useMemo,
  type MouseEvent,
  type ReactElement,
} from "react";
import { copyText } from "./clipboard";
import { isInternalUrl, renderMarkdownToHtml } from "./markdownRenderer";

type MarkdownViewProps = {
  markdown: string;
  onOpenLink: (url: string) => void;
};

export function MarkdownView({
  markdown,
  onOpenLink,
}: MarkdownViewProps): ReactElement {
  const html = useMemo(() => renderMarkdownToHtml(markdown), [markdown]);
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
      className="zp-markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
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
  const icon = button.querySelector("span");
  if (!icon) {
    return;
  }

  icon.className = "zp-check-icon";
  globalThis.setTimeout(() => {
    icon.className = "zp-copy-icon";
  }, 900);
}
