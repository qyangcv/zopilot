import type { CodexDiscoverySubprocessModule } from "../../../codex/cliDiscovery";
import type { CodexDiagnosticMessageKey } from "../../../codex/diagnostics";
import type {
  PdfHelperInstallProgress,
  PdfHelperStatus,
} from "../../../document/pdfHelper";
import type { SidebarPromptView } from "../../sidebar/app/types";

type PreferencesAppProps = {
  getSubprocess: () => CodexDiscoverySubprocessModule;
  translate: () => void;
};

type PreferenceSection = "connection" | "dependencies" | "prompts";

type PromptView = SidebarPromptView;

type CodexConnectionState =
  | { status: "checking" }
  | { status: "connected" }
  | { status: "missing"; messageKey: CodexDiagnosticMessageKey };

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
  CodexConnectionState,
  DependencyState,
  PreferenceSection,
  PreferencesAppProps,
  PromptMessage,
  PromptView,
};
