import { getCodexBridge } from "./CodexBridge";
import { diagnoseCodexConnection, type CodexDiagnostic } from "./diagnostics";
import type { CodexDiscoverySubprocessModule } from "./cliDiscovery";
import type {
  AgentBackend,
  AgentCancelInput,
  AgentCapabilities,
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  BackendStatusResult,
  ProviderProfile,
} from "../../domain/agent/types";
import { createCapabilities } from "../../domain/agent/capabilities";
import { createDiagnostic } from "../../domain/agent/errors";
import {
  buildPromptWithLocalAttachments,
  buildPromptWithSourceRefs,
} from "../../application/agent/prompt/contextAssembler";

export { CodexCliBackend };

class CodexCliBackend implements AgentBackend {
  readonly id: string;
  readonly label: string;
  readonly kind = "codex-cli" as const;
  readonly capabilities: AgentCapabilities;
  private readonly profile: ProviderProfile;
  private diagnosticSubprocess?: CodexDiscoverySubprocessModule;

  constructor(profile: ProviderProfile) {
    this.profile = profile;
    this.id = profile.id;
    this.label = profile.displayName;
    this.capabilities = createCapabilities("codex-cli");
  }

  async checkStatus(): Promise<BackendStatusResult> {
    try {
      const models = await this.listModels();
      return {
        status: "connected",
        models,
      };
    } catch {
      const diagnostic = await this.diagnose();
      return {
        status: "disconnected",
        diagnostic: mapCodexDiagnostic(diagnostic),
      };
    }
  }

  async listModels(): Promise<AgentModelEntry[]> {
    const models = await getCodexBridge().listModels();
    return models.map((model) => ({
      id: model.slug,
      displayName: model.displayName,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
    }));
  }

  async sendPrompt(
    input: AgentPromptInput,
    callbacks: AgentPromptCallbacks = {},
  ): Promise<AgentRunResult> {
    const result = await getCodexBridge().sendPrompt(
      buildPromptWithLocalAttachments(
        buildPromptWithSourceRefs(input.prompt, input.mentions || []),
        input.localAttachments || [],
      ),
      {
        conversation: input.conversation.metadata,
        model: input.model,
        effort: input.reasoningEffort,
        onTurnStarted: (threadId, turnId) => {
          callbacks.onRunStarted?.({
            backendId: this.id,
            providerProfileId: this.profile.id,
            runId: threadId,
            turnId,
            legacy: {
              codexThreadId: threadId,
              codexTurnId: turnId,
            },
          });
        },
        onDelta: callbacks.onTextDelta,
        onTraceEvent: callbacks.onTraceEvent,
        onNotice: callbacks.onNotice,
        onToolActivity: () => callbacks.onToolStarted?.("paper_read"),
      },
    );
    return {
      backendId: this.id,
      providerProfileId: this.profile.id,
      runId: result.threadId,
      turnId: result.turnId,
      text: result.text,
      status: result.status,
      legacy: {
        codexThreadId: result.threadId,
        codexTurnId: result.turnId,
      },
    };
  }

  async cancelTurn(input: AgentCancelInput): Promise<void> {
    const threadId = input.legacy?.codexThreadId || input.runId;
    const turnId = input.legacy?.codexTurnId || input.turnId;
    if (!threadId || !turnId) {
      return;
    }
    await getCodexBridge().interruptTurn(threadId, turnId);
  }

  dispose(): void {
    return undefined;
  }

  private async diagnose(): Promise<CodexDiagnostic | undefined> {
    return diagnoseCodexConnection(this.getDiagnosticSubprocess()).catch(
      () => undefined,
    );
  }

  private getDiagnosticSubprocess(): CodexDiscoverySubprocessModule {
    if (this.diagnosticSubprocess) {
      return this.diagnosticSubprocess;
    }
    const imported = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as { Subprocess: CodexDiscoverySubprocessModule };
    this.diagnosticSubprocess = imported.Subprocess;
    return this.diagnosticSubprocess;
  }
}

function mapCodexDiagnostic(diagnostic: CodexDiagnostic | undefined) {
  if (!diagnostic) {
    return createDiagnostic("unknown_backend_error");
  }
  if (diagnostic.code === "cli_not_found") {
    return createDiagnostic("missing_codex_cli");
  }
  if (diagnostic.code === "not_logged_in") {
    return createDiagnostic("codex_not_signed_in");
  }
  if (diagnostic.code === "command_timeout") {
    return createDiagnostic("provider_timeout");
  }
  return createDiagnostic("unknown_backend_error");
}
