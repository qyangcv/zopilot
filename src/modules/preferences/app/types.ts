import type {
  PdfHelperInstallProgress,
  PdfHelperStatus,
} from "../../../document/pdfHelper";
import type { SidebarPromptView } from "../../sidebar/app/types";

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
  | { status: "error"; helper?: PdfHelperStatus; message: string };

type PromptMessage = {
  kind: "error" | "success";
  text: string;
};

export type {
  DependencyState,
  PreferenceSection,
  PromptEditorMode,
  PreferencesAppProps,
  PromptMessage,
  PromptView,
};
