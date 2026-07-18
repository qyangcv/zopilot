import { assert } from "chai";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { configureLocaleFormatter } from "../../../src/app/localization.ts";
import { PromptPicker } from "../../../src/features/sidebar/ui/PromptPicker.tsx";

describe("PromptPicker", function () {
  before(function () {
    configureLocaleFormatter((id) =>
      id === "sidebar-prompts" ? "Prompt" : id,
    );
  });

  after(function () {
    configureLocaleFormatter(undefined);
  });

  it("renders prompt content without a trailing insert hint", function () {
    const html = renderToStaticMarkup(
      <PromptPicker
        onClose={() => undefined}
        onInsert={() => undefined}
        prompts={[
          {
            id: "custom-summary",
            title: "总结论文",
            body: "总结这篇论文。",
            scope: "global",
            updatedAt: "2026-07-17T10:00:00.000Z",
            custom: true,
          },
        ]}
        triggerRef={createRef<HTMLButtonElement>()}
      />,
    );

    assert.include(html, "总结论文");
    assert.include(html, "总结这篇论文。");
    assert.include(html, "zp-popup-row-separator");
    assert.notInclude(html, "zp-panel-row-main");
    assert.notInclude(html, "zp-panel-row-meta");
    assert.notInclude(html, "插入");
  });
});
