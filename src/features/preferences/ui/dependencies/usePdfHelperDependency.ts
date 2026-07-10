import { useCallback, useEffect, useState } from "react";
import {
  getPdfHelperStatus,
  installPdfHelperDependency,
  removePdfHelperDependency,
  updatePdfHelperDependency,
  type PdfHelperStatus,
} from "../../../../document/pdf-helper/index";
import type { DependencyState } from "../types";

export { dependencyNavCount, usePdfHelperDependency };

function usePdfHelperDependency(): {
  dependencyState: DependencyState;
  installDependencies: () => void;
  removeDependencies: () => void;
  runDependencyCheck: () => void;
} {
  const [dependencyState, setDependencyState] = useState<DependencyState>({
    status: "checking",
  });

  const runDependencyCheck = useCallback(() => {
    setDependencyState({ status: "checking" });
    void getPdfHelperStatus()
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          message: stringifyError(error),
        }),
      );
  }, []);

  const installDependencies = useCallback(() => {
    const currentHelper = getDependencyHelper(dependencyState);
    setDependencyState({
      status: "installing",
      progress: { phase: "manifest", percent: 0 },
    });
    const action = currentHelper?.hasInstallCandidate
      ? updatePdfHelperDependency
      : installPdfHelperDependency;
    void action((progress) => {
      setDependencyState({ status: "installing", progress });
    })
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          helper: currentHelper,
          message: stringifyError(error),
        }),
      );
  }, [dependencyState]);

  const removeDependencies = useCallback(() => {
    const currentHelper = getDependencyHelper(dependencyState);
    setDependencyState({ status: "removing" });
    void removePdfHelperDependency()
      .then((helper) => setDependencyState({ status: "ready", helper }))
      .catch((error) =>
        setDependencyState({
          status: "error",
          helper: currentHelper,
          message: stringifyError(error),
        }),
      );
  }, [dependencyState]);

  useEffect(() => {
    runDependencyCheck();
  }, [runDependencyCheck]);

  return {
    dependencyState,
    installDependencies,
    removeDependencies,
    runDependencyCheck,
  };
}

function dependencyNavCount(state: DependencyState): number | undefined {
  if (state.status === "checking" || state.status === "installing") {
    return undefined;
  }
  if (state.status === "ready") {
    return state.helper.status === "installed" ? undefined : 1;
  }
  if (state.status === "error") {
    return 1;
  }
  return undefined;
}

function getDependencyHelper(
  state: DependencyState,
): PdfHelperStatus | undefined {
  return state.status === "ready" || state.status === "error"
    ? state.helper
    : undefined;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
