import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemContextMentionPopover } from "../../../src/features/sidebar/ui/ItemContextMentionPopover.tsx";
import type { ItemContextTree } from "../../../src/domain/conversation.ts";

describe("ItemContextMentionPopover", function () {
  before(function () {
    installLocaleMock();
  });

  it("renders an unselectable root with selectable and disabled children", function () {
    const html = renderToStaticMarkup(
      <ItemContextMentionPopover
        activeIndex={1}
        expanded
        nodes={createTree().nodes}
        onActiveIndexChange={() => undefined}
        onClose={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
        selectedNodeIds={new Set(["note:1:NOTE"])}
        tree={createTree()}
      />,
    );

    assert.include(html, 'role="tree"');
    assert.include(html, 'aria-expanded="true"');
    assert.include(html, "Paper A");
    assert.include(html, "Main.pdf");
    assert.include(html, "Reading notes");
    assert.include(html, "Figure.png");
    assert.include(html, 'data-icon-name="file"');
    assert.include(html, "lucide-file");
    assert.include(html, 'data-icon-name="notebookText"');
    assert.include(html, "lucide-notebook-text");
    assert.equal(count(html, 'data-icon-name="squareCheck"'), 2);
    assert.equal(count(html, 'data-icon-name="square"'), 1);
    assert.include(html, "sidebar-item-context-default-source");
    assert.include(html, 'aria-disabled="true"');
    assert.include(html, "sidebar-item-context-unsupported");
  });

  it("keeps the root visible when no child matches", function () {
    const html = renderToStaticMarkup(
      <ItemContextMentionPopover
        activeIndex={0}
        expanded
        nodes={[]}
        onActiveIndexChange={() => undefined}
        onClose={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
        selectedNodeIds={new Set()}
        tree={createTree()}
      />,
    );

    assert.include(html, "Paper A");
    assert.include(html, "sidebar-item-context-empty");
  });

  it("keeps an unavailable persistent note selected and removable", function () {
    const tree = createTree();
    const unavailable = {
      ...tree.nodes[1],
      invalidReason: "unavailable" as const,
    };
    const html = renderToStaticMarkup(
      <ItemContextMentionPopover
        activeIndex={1}
        expanded
        nodes={[unavailable]}
        onActiveIndexChange={() => undefined}
        onClose={() => undefined}
        onSelect={() => undefined}
        onToggle={() => undefined}
        selectedNodeIds={new Set(["note:1:NOTE"])}
        tree={tree}
      />,
    );

    assert.include(html, 'data-invalid="true"');
    assert.include(html, 'aria-selected="true"');
    assert.notInclude(html, 'aria-disabled="true"');
    assert.include(html, "sidebar-item-context-note-unavailable");
  });
});

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function createTree(): ItemContextTree {
  return {
    root: { itemID: 1, itemKey: "PAPER", title: "Paper A" },
    nodes: [
      {
        id: "1-PDF",
        kind: "pdf",
        title: "Main.pdf",
        current: true,
        selectable: true,
        source: {
          sourceId: "1-PDF",
          paperKey: "1:PAPER",
          libraryID: 1,
          parentItemID: 1,
          parentItemKey: "PAPER",
          attachmentItemID: 11,
          attachmentKey: "PDF",
          title: "Main.pdf",
        },
      },
      {
        id: "note:1:NOTE",
        kind: "note",
        title: "Reading notes",
        selectable: true,
        note: {
          id: "note:1:NOTE",
          libraryID: 1,
          parentItemID: 1,
          parentItemKey: "PAPER",
          noteItemID: 21,
          noteItemKey: "NOTE",
          title: "Reading notes",
          dateModified: "2026-07-17 10:00:00",
        },
      },
      {
        id: "attachment:1:IMAGE",
        kind: "unsupported-attachment",
        title: "Figure.png",
        selectable: false,
        disabledReason: "unsupported-type",
        attachmentItemID: 12,
        attachmentKey: "IMAGE",
        contentType: "image/png",
      },
    ],
  };
}

function installLocaleMock(): void {
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
}
