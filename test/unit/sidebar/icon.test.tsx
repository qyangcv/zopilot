import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, type IconName } from "../../../src/modules/sidebar/app/Icon.tsx";
import { renderStaticIconHtml } from "../../../src/modules/sidebar/app/staticIcons.ts";

describe("sidebar Icon", function () {
  it("renders known icons through the shared icon wrapper", function () {
    const names: IconName[] = [
      "add",
      "archive",
      "archiveRestore",
      "brand",
      "checking",
      "close",
      "context",
      "copied",
      "copy",
      "disconnected",
      "edit",
      "history",
      "newChat",
      "paperMention",
      "resend",
      "send",
      "stop",
    ];

    for (const name of names) {
      const html = renderToStaticMarkup(<Icon name={name} />);
      assert.include(html, "<svg");
      assert.include(html, "zp-icon");
      assert.include(html, `data-icon-name="${name}"`);
    }
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

  it("uses the closed folder icon for workspace", function () {
    const workspace = renderToStaticMarkup(<Icon name="workspace" size={15} />);

    assert.include(workspace, "lucide-folder-closed");
    assert.include(workspace, 'data-icon-name="workspace"');
  });
});
