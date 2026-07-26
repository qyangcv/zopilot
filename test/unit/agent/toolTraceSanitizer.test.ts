import { assert } from "chai";
import {
  formatToolTraceValue,
  sanitizeToolTraceText,
} from "../../../src/application/agent/toolTraceSanitizer.ts";

describe("tool trace sanitizer", function () {
  it("redacts secrets, image data, and absolute local paths", function () {
    const value = formatToolTraceValue({
      authorization: "Bearer private",
      apiKey: "sk-private",
      path: "/Users/person/private/paper.pdf",
      image: `data:image/png;base64,${"A".repeat(300)}`,
    });

    assert.notInclude(value, "Bearer private");
    assert.notInclude(value, "sk-private");
    assert.notInclude(value, "/Users/person");
    assert.notInclude(value, "A".repeat(100));
    assert.include(value, "[redacted]");
  });

  it("truncates tool payload text at the persistence boundary", function () {
    const result = sanitizeToolTraceText("x ".repeat(9000));
    assert.isAtMost(result.length, 8020);
    assert.include(result, "[truncated]");
  });
});
