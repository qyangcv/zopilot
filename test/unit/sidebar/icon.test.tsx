import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, type IconName } from "../../../src/features/sidebar/ui/Icon.tsx";
import { renderStaticIconHtml } from "../../../src/features/sidebar/ui/staticIcons.ts";

describe("sidebar Icon", function () {
  it("renders known icons through the shared icon wrapper", function () {
    const names: IconName[] = [
      "add",
      "archive",
      "archiveRestore",
      "atSign",
      "brand",
      "checking",
      "close",
      "copied",
      "copy",
      "disconnected",
      "edit",
      "file",
      "history",
      "newChat",
      "notebookText",
      "attachmentImage",
      "attachmentPdf",
      "paperMention",
      "reload",
      "resend",
      "send",
      "square",
      "squareCheck",
      "stop",
    ];

    for (const name of names) {
      const html = renderToStaticMarkup(<Icon name={name} />);
      assert.include(html, "<svg");
      assert.include(html, "zp-icon");
      assert.include(html, `data-icon-name="${name}"`);
    }
  });

  it("uses the Lucide at-sign icon for mention guidance", function () {
    const atSign = renderToStaticMarkup(<Icon name="atSign" />);

    assert.include(atSign, "lucide-at-sign");
    assert.include(atSign, 'data-icon-name="atSign"');
  });

  it("renders the Remix chat-ai brand icon", function () {
    const brand = renderToStaticMarkup(<Icon name="brand" size={18} />);

    assert.include(brand, 'data-icon-name="brand"');
    assert.include(brand, 'fill="currentColor"');
    assert.include(brand, 'stroke="none"');
    assert.include(brand, "M12 1.99996C12.8632");
    assert.notInclude(brand, "lucide-message-circle");
  });

  it("renders the static brand icon as a fill SVG", function () {
    const brand = renderStaticIconHtml("brand", { size: 20 });

    assert.include(brand, 'data-icon-name="brand"');
    assert.include(brand, 'fill="currentColor"');
    assert.include(brand, 'stroke="none"');
    assert.include(brand, "M12 1.99996C12.8632");
    assert.notInclude(brand, 'stroke="currentColor"');
  });

  it("uses an archive-family icon for restore", function () {
    const archiveRestore = renderToStaticMarkup(
      <Icon name="archiveRestore" size={14} />,
    );

    assert.include(archiveRestore, "lucide-archive-x");
    assert.include(archiveRestore, 'data-icon-name="archiveRestore"');
  });

  it("uses the requested icons for file context and workspaces", function () {
    const paper = renderToStaticMarkup(<Icon name="paperMention" />);
    const pdf = renderToStaticMarkup(<Icon name="attachmentPdf" />);
    const image = renderToStaticMarkup(<Icon name="attachmentImage" />);
    const item = renderToStaticMarkup(<Icon name="workspaceItem" />);
    const library = renderToStaticMarkup(<Icon name="workspaceLibrary" />);
    const collection = renderToStaticMarkup(
      <Icon name="workspaceCollection" />,
    );

    assert.include(paper, "lucide-file-text");
    assert.include(pdf, "lucide-file-plus-corner");
    assert.include(image, "lucide-file-image");
    assert.include(item, "lucide-file-text");
    assert.include(library, "lucide-landmark");
    assert.include(collection, "lucide-folder");
    assert.notInclude(paper, "data-icon-tone");
    assert.notInclude(pdf, "data-icon-tone");
    assert.notInclude(image, "data-icon-tone");
    assert.notInclude(library, "data-icon-tone");
    assert.notInclude(collection, "data-icon-tone");
  });

  it("uses Lucide file and notebook-text for item context nodes", function () {
    const file = renderToStaticMarkup(<Icon name="file" />);
    const notebook = renderToStaticMarkup(<Icon name="notebookText" />);

    assert.include(file, "lucide-file");
    assert.notInclude(file, "lucide-file-text");
    assert.include(notebook, "lucide-notebook-text");
  });
});
