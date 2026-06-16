import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, type IconName } from "../../../src/modules/sidebar/app/Icon.tsx";

describe("sidebar Icon", function () {
  it("renders known icons through the shared Lucide wrapper", function () {
    const names: IconName[] = [
      "add",
      "archive",
      "brand",
      "checking",
      "close",
      "context",
      "copied",
      "copy",
      "disconnected",
      "edit",
      "history",
      "insert",
      "newChat",
      "resend",
      "retry",
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
});
