import { useCallback, useEffect, useState } from "react";
import type { CodexDiscoverySubprocessModule } from "../../../codex/cliDiscovery";
import {
  checkCodexConnection,
  diagnoseCodexConnection,
} from "../../../codex/diagnostics";
import type { CodexConnectionState } from "./types";

export { useCodexConnection };

function useCodexConnection(
  getSubprocess: () => CodexDiscoverySubprocessModule,
): {
  connection: CodexConnectionState;
  runConnectionCheck: () => void;
} {
  const [connection, setConnection] = useState<CodexConnectionState>({
    status: "checking",
  });

  const runConnectionCheck = useCallback(() => {
    setConnection({ status: "checking" });
    void detectCodexConnection(getSubprocess).then(setConnection);
  }, [getSubprocess]);

  useEffect(() => {
    runConnectionCheck();
  }, [runConnectionCheck]);

  return { connection, runConnectionCheck };
}

async function detectCodexConnection(
  getSubprocess: () => CodexDiscoverySubprocessModule,
): Promise<CodexConnectionState> {
  let subprocess: CodexDiscoverySubprocessModule | undefined;
  try {
    subprocess = getSubprocess();
    if (await checkCodexConnection(subprocess)) {
      return { status: "connected" };
    }
  } catch {
    return {
      status: "missing",
      messageKey: "codex-diagnostic-unknown-error",
    };
  }
  const diagnostic = subprocess
    ? await diagnoseCodexConnection(subprocess).catch(() => undefined)
    : undefined;
  return {
    status: "missing",
    messageKey: diagnostic?.messageKey || "codex-diagnostic-unknown-error",
  };
}
