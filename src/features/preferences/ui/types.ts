import type {
  PdfHelperInstallProgress,
  PdfHelperStatus,
} from "../../../document/pdf-helper/index";
import type { SidebarPromptView } from "../../sidebar/ui/types";
import type { LocalizedMessage } from "../localization";

type PreferencesAppProps = {
  translate: () => void;
};

type PreferenceSection = "providers" | "dependencies" | "prompts";

type PromptEditorMode = "list" | "edit";

type PromptView = SidebarPromptView;

type DependencyState =
  | { status: "checking" }
  | { status: "installing"; progress?: PdfHelperInstallProgress }
  | { status: "removing" }
  | { status: "ready"; helper: PdfHelperStatus }
  | {
      status: "error";
      helper?: PdfHelperStatus;
      message: LocalizedMessage;
    };

type PromptMessage = {
  kind: "error" | "success";
  message: LocalizedMessage;
};

export type {
  DependencyState,
  PreferenceSection,
  PromptEditorMode,
  PreferencesAppProps,
  PromptMessage,
  PromptView,
};
