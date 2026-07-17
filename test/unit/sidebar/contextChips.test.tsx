import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextChips } from "../../../src/features/sidebar/ui/ContextChips.tsx";

describe("ContextChips", function () {
  before(function () {
    (globalThis as typeof globalThis & { addon: unknown }).addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync(messages: Array<{ id: string }>) {
              return messages.map((message) => ({ value: message.id }));
            },
          },
        },
      },
    };
  });

  it("uses one compact chip primitive for fixed items and attachments", function () {
    const html = renderToStaticMarkup(
      <ContextChips
        attachments={[
          {
            id: "local-pdf",
            path: "/tmp/attachment.pdf",
            filename: "attachment.pdf",
            kind: "pdf",
          },
        ]}
        itemContext={{
          expanded: false,
          title: "Current Zotero item",
        }}
        onOpenItemContext={() => undefined}
        onRemoveAttachment={() => undefined}
      />,
    );

    assert.equal(count(html, "zp-compact-context-chip"), 2);
    assert.equal(count(html, "zp-context-chip-trigger"), 1);
    assert.equal(count(html, 'data-removable="true"'), 1);
    assert.include(html, 'aria-haspopup="tree"');
    assert.include(html, 'data-icon-name="workspaceItem"');
    assert.include(html, 'data-icon-name="attachmentPdf"');
  });

  it("makes a removable item mention open its tree without nesting buttons", function () {
    const html = renderToStaticMarkup(
      <ContextChips
        mentions={[
          {
            id: "mention-a",
            sourceId: "1-PDF",
            paperKey: "1:PAPER",
            libraryID: 1,
            parentItemID: 1,
            parentItemKey: "PAPER",
            attachmentItemID: 2,
            attachmentKey: "PDF",
            title: "Paper A",
          },
        ]}
        onOpenMention={() => undefined}
        onRemoveMention={() => undefined}
      />,
    );

    assert.include(html, "zp-context-chip-trigger");
    assert.include(html, "zp-context-chip-activate");
    assert.include(html, 'aria-haspopup="tree"');
    assert.equal(count(html, "<button"), 2);
    assert.notMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
