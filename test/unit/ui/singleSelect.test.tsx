import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SingleSelect,
  calculateSubmenuStyle,
  findDefaultSubOption,
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  findResolvedSubOptionIndex,
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

  it("places a cascading submenu on the side with enough room", function () {
    const right = calculateSubmenuStyle(
      { top: 20, bottom: 220, left: 40, right: 200 },
      { top: 80, bottom: 110 },
      { left: 0, right: 400 },
      100,
      96,
    );
    const left = calculateSubmenuStyle(
      { top: 20, bottom: 220, left: 180, right: 340 },
      { top: 190, bottom: 220 },
      { left: 0, right: 360 },
      100,
      96,
    );

    assert.equal(right.insetInlineStart, "100%");
    assert.isUndefined(right.insetInlineEnd);
    assert.equal(right.top, 25);
    assert.equal(left.insetInlineEnd, "100%");
    assert.isUndefined(left.insetInlineStart);
    assert.equal(left.top, 100);
  });

  it("resolves a model click to its enabled default sub-option", function () {
    assert.deepEqual(
      findDefaultSubOption({
        label: "GPT",
        value: "gpt",
        subDefaultValue: "high",
        subOptions: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ],
      }),
      { label: "High", value: "high" },
    );
    assert.deepEqual(
      findDefaultSubOption({
        label: "GPT",
        value: "gpt",
        subDefaultValue: "disabled",
        subOptions: [
          { label: "Disabled", value: "disabled", disabled: true },
          { label: "Medium", value: "medium" },
        ],
      }),
      { label: "Medium", value: "medium" },
    );
  });

  it("highlights the same default effort that a model click selects", function () {
    const luna: SingleSelectOption = {
      label: "GPT-5.6-Luna",
      value: "gpt-5.6-luna",
      subDefaultValue: "medium",
      subOptions: [
        { label: "Low", value: "low" },
        { label: "Medium", value: "medium" },
        { label: "High", value: "high" },
      ],
    };

    assert.equal(findResolvedSubOptionIndex(luna), 1);
    assert.equal(
      luna.subOptions?.[findResolvedSubOptionIndex(luna)]?.value,
      findDefaultSubOption(luna)?.value,
    );
  });

  it("prefers a saved effort over the model default when highlighting", function () {
    assert.equal(
      findResolvedSubOptionIndex({
        label: "GPT",
        value: "gpt",
        subValue: "high",
        subDefaultValue: "medium",
        subOptions: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
        ],
      }),
      2,
    );
  });
});
