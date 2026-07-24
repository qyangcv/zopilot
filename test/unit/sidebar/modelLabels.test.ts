import { assert } from "chai";
import {
  formatEffortLabel,
  formatModelEffortLabel,
} from "../../../src/features/sidebar/ui/modelLabels.ts";

describe("sidebar model labels", function () {
  it("formats effort labels with the same capitalization as the selector", function () {
    assert.equal(formatEffortLabel("max"), "Max");
    assert.equal(formatEffortLabel("high"), "High");
    assert.equal(formatEffortLabel("xhigh"), "Xhigh");
    assert.equal(formatEffortLabel("very_high"), "Very_High");
  });

  it("appends a non-empty effort to a model label", function () {
    assert.equal(
      formatModelEffortLabel("GPT-5.6-Sol", " max "),
      "GPT-5.6-Sol · Max",
    );
    assert.equal(formatModelEffortLabel("GPT-5.6-Sol", " "), "GPT-5.6-Sol");
    assert.equal(formatModelEffortLabel("GPT-5.6-Sol"), "GPT-5.6-Sol");
  });
});
