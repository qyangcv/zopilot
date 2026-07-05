import { useCallback, useEffect, useState } from "react";
import { getAgentBackendManager } from "../../../agent/backendManager";
import { createPresetProviderProfile } from "../../../agent/modelCatalog";
import { getProviderProfileStore } from "../../../agent/providerProfiles";
import type {
  AgentModelEntry,
  ProviderProfile,
  ProviderProfileInput,
} from "../../../agent/types";
import { getByokRuntimeBridge } from "../../../byokRuntime/bridge";

export { useProviderProfiles };

type ProviderProfilesState = {
  activeProviderId: string;
  profiles: ProviderProfile[];
  checkingProviderId?: string;
  message?: string;
};

function useProviderProfiles(): {
  state: ProviderProfilesState;
  createProvider: (input: ProviderProfileInput) => void;
  updateProvider: (
    profileId: string,
    input: Partial<ProviderProfileInput>,
  ) => void;
  deleteProvider: (profileId: string) => void;
  checkProvider: (profileId: string) => void;
  listProviderModels: (input: {
    baseURL: string;
    apiKey: string;
  }) => Promise<AgentModelEntry[]>;
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

  const checkProvider = useCallback((profileId: string) => {
    setState((current) => ({
      ...current,
      checkingProviderId: profileId,
      message: undefined,
    }));
    void getAgentBackendManager()
      .checkStatus(profileId)
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
  }, []);

  const listProviderModels = useCallback(
    async (input: { baseURL: string; apiKey: string }) => {
      const profile = createPresetProviderProfile({
        id: "provider-draft",
        preset: "openai-compatible",
        displayName: "OpenAI compatible",
        baseURL: input.baseURL,
        models: [],
        hasApiKey: true,
      });
      return getByokRuntimeBridge().listModels({
        ...profile,
        apiKey: input.apiKey,
      });
    },
    [],
  );

  return {
    state,
    createProvider,
    updateProvider,
    deleteProvider,
    checkProvider,
    listProviderModels,
  };
}
