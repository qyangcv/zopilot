import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SingleSelect,
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  keepOptionVisible,
  type SingleSelectOption,
} from "../../../src/ui/primitives/SingleSelect.tsx";

describe("SingleSelect", function () {
  const options: SingleSelectOption[] = [
    { label: "Disabled", value: "disabled", disabled: true },
    { label: "OpenRouter", value: "openrouter" },
    { label: "DeepSeek", value: "deepseek" },
  ];

  it("renders a controlled form trigger without a native select", function () {
    const html = renderToStaticMarkup(
      <SingleSelect
        aria-label="Provider"
        onChange={() => undefined}
        options={options}
        value="openrouter"
        variant="form"
      />,
    );

    assert.include(html, 'aria-haspopup="listbox"');
    assert.include(html, 'aria-expanded="false"');
    assert.include(html, 'data-variant="form"');
    assert.include(html, "OpenRouter");
    assert.include(html, "lucide-chevron-down");
    assert.notInclude(html, "<select");
    assert.notInclude(html, "DeepSeek");
  });

  it("renders the same shared primitive in compact mode", function () {
    const html = renderToStaticMarkup(
      <SingleSelect
        aria-label="Model"
        onChange={() => undefined}
        options={[{ label: "GLM", value: "glm" }]}
        showIndicator={false}
        value="glm"
        variant="compact"
      />,
    );

    assert.include(html, 'data-variant="compact"');
    assert.include(html, "GLM");
    assert.notInclude(html, "lucide-chevron-down");
  });

  it("wraps keyboard navigation while skipping disabled options", function () {
    assert.equal(findFirstEnabledIndex(options), 1);
    assert.equal(findLastEnabledIndex(options), 2);
    assert.equal(findNextEnabledIndex(options, 1, 1), 2);
    assert.equal(findNextEnabledIndex(options, 2, 1), 1);
    assert.equal(findNextEnabledIndex(options, 1, -1), 2);
  });

  it("scrolls only the popup container to reveal its active option", function () {
    const listbox = {
      scrollTop: 20,
      getBoundingClientRect: () => ({ top: 100, bottom: 200 }),
    } as unknown as HTMLElement;
    const optionBelow = {
      getBoundingClientRect: () => ({ top: 190, bottom: 230 }),
    } as unknown as HTMLElement;
    const optionAbove = {
      getBoundingClientRect: () => ({ top: 70, bottom: 110 }),
    } as unknown as HTMLElement;

    keepOptionVisible(listbox, optionBelow);
    assert.equal(listbox.scrollTop, 50);
    keepOptionVisible(listbox, optionAbove);
    assert.equal(listbox.scrollTop, 20);
  });
});
