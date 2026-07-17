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
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
