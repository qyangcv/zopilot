import { localized, type LocalizedMessage } from "../../localization";

export { promptErrorMessage };

function promptErrorMessage(error: unknown): LocalizedMessage {
  if (!(error instanceof Error)) {
    return localized("pref-prompt-message-save-failed");
  }
  if (error.message === "Prompt title is required.") {
    return localized("pref-prompt-message-title-required");
  }
  if (error.message === "Prompt body is required.") {
    return localized("pref-prompt-message-body-required");
  }
  if (error.message === "Prompt not found.") {
    return localized("pref-prompt-message-not-found");
  }
  return localized("pref-prompt-message-save-failed");
}
