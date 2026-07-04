import { useCallback, useEffect, useState } from "react";
import { getAgentBackendManager } from "../../../agent/backendManager";
import { getProviderProfileStore } from "../../../agent/providerProfiles";
import type {
  AgentProviderPreset,
  ProviderProfile,
  ProviderProfileInput,
} from "../../../agent/types";

export { useProviderProfiles };

type ProviderProfilesState = {
  activeProviderId: string;
  profiles: ProviderProfile[];
  checkingProviderId?: string;
  message?: string;
};

function useProviderProfiles(): {
  state: ProviderProfilesState;
  selectProvider: (profileId: string) => void;
  createProvider: (input: ProviderProfileInput) => void;
  updateProvider: (
    profileId: string,
    input: Partial<ProviderProfileInput>,
  ) => void;
  deleteProvider: (profileId: string) => void;
  checkProvider: (profileId: string) => void;
  presets: Exclude<AgentProviderPreset, "codex-cli">[];
} {
  const [state, setState] = useState<ProviderProfilesState>(() => ({
    ...getProviderProfileStore().getSnapshot(),
  }));

  useEffect(
    () =>
      getProviderProfileStore().subscribe((snapshot) => {
        setState((current) => ({
          ...current,
          ...snapshot,
        }));
      }),
    [],
  );

  const selectProvider = useCallback((profileId: string) => {
    getAgentBackendManager().setActiveProvider(profileId);
  }, []);

  const createProvider = useCallback((input: ProviderProfileInput) => {
    getProviderProfileStore().createProvider(input);
  }, []);

  const updateProvider = useCallback(
    (profileId: string, input: Partial<ProviderProfileInput>) => {
      getProviderProfileStore().updateProvider(profileId, input);
    },
    [],
  );

  const deleteProvider = useCallback((profileId: string) => {
    getProviderProfileStore().deleteProvider(profileId);
  }, []);

  const checkProvider = useCallback(
    (profileId: string) => {
      selectProvider(profileId);
      setState((current) => ({
        ...current,
        checkingProviderId: profileId,
        message: undefined,
      }));
      void getAgentBackendManager()
        .checkActiveStatus()
        .then((result) => {
          setState((current) => ({
            ...current,
            checkingProviderId: undefined,
            message:
              result.status === "connected"
                ? "Provider connected."
                : result.diagnostic?.message || "Provider check failed.",
          }));
        })
        .catch((error) => {
          setState((current) => ({
            ...current,
            checkingProviderId: undefined,
            message: error instanceof Error ? error.message : String(error),
          }));
        });
    },
    [selectProvider],
  );

  return {
    state,
    selectProvider,
    createProvider,
    updateProvider,
    deleteProvider,
    checkProvider,
    presets: ["deepseek", "z-ai", "minimax"],
  };
}
