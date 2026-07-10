import {
  buildCodexSubprocessEnvironment,
  type CodexCommandSpec,
  type CodexDiscoverySubprocessModule,
  resolveCodexBinaryPath,
} from "./cliDiscovery";
import { waitForSubprocessResult } from "../../runtime/process/subprocess";
import { getHomeDir } from "../../runtime/platform/host";

export {
  checkCodexConnection,
  diagnoseCodexConnection,
  getCodexDiagnosticMessageKey,
  type CodexDiagnostic,
  type CodexDiagnosticCode,
  type CodexDiagnosticMessageKey,
};

type CodexDiagnosticCode =
  | "cli_not_found"
  | "app_server_unavailable"
  | "not_logged_in"
  | "command_timeout"
  | "permission_denied"
  | "unknown_error";

type CodexDiagnostic = {
  code: CodexDiagnosticCode;
  messageKey: CodexDiagnosticMessageKey;
};

type CodexDiagnosticMessageKey =
  | "codex-diagnostic-cli-not-found"
  | "codex-diagnostic-app-server-unavailable"
  | "codex-diagnostic-not-logged-in"
  | "codex-diagnostic-command-timeout"
  | "codex-diagnostic-permission-denied"
  | "codex-diagnostic-unknown-error";

const COMMAND_TIMEOUT_MS = 5000;
const DIAGNOSTIC_MESSAGE_KEYS: Record<
  CodexDiagnosticCode,
  CodexDiagnosticMessageKey
> = {
  cli_not_found: "codex-diagnostic-cli-not-found",
  app_server_unavailable: "codex-diagnostic-app-server-unavailable",
  not_logged_in: "codex-diagnostic-not-logged-in",
  command_timeout: "codex-diagnostic-command-timeout",
  permission_denied: "codex-diagnostic-permission-denied",
  unknown_error: "codex-diagnostic-unknown-error",
};

async function checkCodexConnection(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<boolean> {
  try {
    const context = await resolveCodexCommand(subprocess);
    const appServer = await runCodexCommand(context, ["app-server", "--help"]);
    if (appServer.exitCode !== 0) {
      return false;
    }
    const login = await runCodexCommand(context, ["login", "status"]);
    return login.exitCode === 0 && isLoggedIn(login);
  } catch {
    return false;
  }
}

async function diagnoseCodexConnection(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<CodexDiagnostic | undefined> {
  let context: CodexCommandContext;
  try {
    context = await resolveCodexCommand(subprocess);
  } catch (error) {
    return toDiagnostic(
      isPermissionFailure(error) ? "permission_denied" : "cli_not_found",
    );
  }

  try {
    const appServer = await runCodexCommand(context, ["app-server", "--help"]);
    const appServerFailure = classifyCommandFailure(
      appServer,
      "app_server_unavailable",
    );
    if (appServerFailure) {
      return toDiagnostic(appServerFailure);
    }
  } catch (error) {
    return toDiagnostic(classifyThrownFailure(error));
  }

  try {
    const login = await runCodexCommand(context, ["login", "status"]);
    const loginFailure = classifyCommandFailure(login, "not_logged_in");
    if (loginFailure) {
      return toDiagnostic(loginFailure);
    }
    if (!isLoggedIn(login)) {
      return toDiagnostic("not_logged_in");
    }
  } catch (error) {
    return toDiagnostic(classifyThrownFailure(error));
  }

  return undefined;
}

function getCodexDiagnosticMessageKey(
  code: CodexDiagnosticCode,
): CodexDiagnosticMessageKey {
  return DIAGNOSTIC_MESSAGE_KEYS[code];
}

type CodexCommandContext = {
  subprocess: CodexDiscoverySubprocessModule;
  command: CodexCommandSpec;
  environment: Record<string, string>;
};

type CodexCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function resolveCodexCommand(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<CodexCommandContext> {
  const environment = await buildCodexSubprocessEnvironment(subprocess);
  const command = await resolveCodexBinaryPath(environment.PATH);
  return { subprocess, command, environment };
}

async function runCodexCommand(
  context: CodexCommandContext,
  args: string[],
): Promise<CodexCommandResult> {
  const proc = await context.subprocess.call({
    command: context.command.command,
    arguments: [...context.command.argsPrefix, ...args],
    environment: context.environment,
    environmentAppend: true,
    stdout: "pipe",
    stderr: "pipe",
    workdir: getHomeDir(context.subprocess.getEnvironment()),
  });

  return waitForSubprocessResult(proc, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    killTimeoutMs: 500,
  });
}

function classifyCommandFailure(
  result: CodexCommandResult,
  defaultCode: CodexDiagnosticCode,
): CodexDiagnosticCode | undefined {
  if (result.exitCode === 0) {
    return undefined;
  }
  if (result.exitCode === 124) {
    return "command_timeout";
  }
  if (isPermissionFailure(`${result.stdout}\n${result.stderr}`)) {
    return "permission_denied";
  }
  return defaultCode;
}

function classifyThrownFailure(error: unknown): CodexDiagnosticCode {
  return isPermissionFailure(error) ? "permission_denied" : "unknown_error";
}

function isLoggedIn(result: CodexCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  const authenticated = /logged in|authenticated/i.test(output);
  const unauthenticated =
    /not logged in|not authenticated|not signed in|unauthenticated/i.test(
      output,
    );
  return authenticated && !unauthenticated;
}

function isPermissionFailure(value: unknown): boolean {
  const text = value instanceof Error ? value.message : String(value);
  return /permission denied|eacces|eperm/i.test(text);
}

function toDiagnostic(code: CodexDiagnosticCode): CodexDiagnostic {
  return {
    code,
    messageKey: getCodexDiagnosticMessageKey(code),
  };
}
