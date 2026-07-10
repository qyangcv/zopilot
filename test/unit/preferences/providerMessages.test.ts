import { assert } from "chai";
import {
  providerDiagnosticMessage,
  providerErrorMessage,
} from "../../../src/features/preferences/ui/providers/providerMessages.ts";
import { dependencyErrorMessage } from "../../../src/features/preferences/ui/dependencies/dependencyMessages.ts";
import { promptErrorMessage } from "../../../src/features/preferences/ui/prompts/promptMessages.ts";

describe("provider preference messages", function () {
  it("maps diagnostics to stable localization ids", function () {
    assert.deepEqual(providerDiagnosticMessage("rate_limited"), {
      id: "pref-provider-diagnostic-rate-limited",
    });
  });

  it("normalizes backend errors before presenting them", function () {
    assert.deepEqual(providerErrorMessage(new Error("401 Unauthorized")), {
      id: "pref-provider-diagnostic-unauthorized",
    });
    assert.deepEqual(providerErrorMessage(new Error("request aborted")), {
      id: "pref-provider-diagnostic-timeout",
    });
    assert.deepEqual(providerErrorMessage(new Error("unexpected failure")), {
      id: "pref-provider-diagnostic-unknown-error",
    });
  });

  it("normalizes dependency failures by category and operation", function () {
    assert.deepEqual(
      dependencyErrorMessage(
        new Error("PDF helper download checksum mismatch."),
        "install",
      ),
      { id: "pref-dependencies-error-verification" },
    );
    assert.deepEqual(
      dependencyErrorMessage(new Error("unexpected failure"), "remove"),
      { id: "pref-dependencies-error-remove-failed" },
    );
  });

  it("maps prompt validation errors to localization ids", function () {
    assert.deepEqual(
      promptErrorMessage(new Error("Prompt title is required.")),
      { id: "pref-prompt-message-title-required" },
    );
    assert.deepEqual(promptErrorMessage(new Error("unexpected failure")), {
      id: "pref-prompt-message-save-failed",
    });
  });
});
