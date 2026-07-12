import { useCallback, useEffect, useState } from "react";
import { getAgentBackendManager } from "../../../../application/agent/BackendManager";
import { normalizeBackendError } from "../../../../domain/agent/errors";
import { createProviderProfile } from "../../../../domain/agent/modelCatalog";
import { getProviderProfileStore } from "../../../../application/providers/ProviderProfileService";
import type {
  AgentModelEntry,
  ProviderProfile,
  ProviderProfileInput,
} from "../../../../domain/agent/types";
import { getByokRuntimeBridge } from "../../../../integrations/byok/ByokRuntimeBridge";

export { useProviderProfiles };

type ProviderProfilesState = {
  activeProviderId: string;
  profiles: ProviderProfile[];
  checkingProviderId?: string;
};

function useProviderProfiles(): {
  state: ProviderProfilesState;
  createProvider: (input: ProviderProfileInput) => void;
  updateProvider: (
    profileId: string,
    input: Partial<ProviderProfileInput>,
  ) => void;
  deleteProvider: (profileId: string) => void;
  readProviderApiKey: (profileId: string) => string;
  checkProvider: (profileId: string) => void;
  listProviderModels: (input: {
    providerId: ProviderProfileInput["providerId"];
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

  const readProviderApiKey = useCallback(
    (profileId: string) =>
      getProviderProfileStore().getProfile(profileId)?.apiKey || "",
    [],
  );

  const checkProvider = useCallback((profileId: string) => {
    setState((current) => ({
      ...current,
      checkingProviderId: profileId,
    }));
    void getAgentBackendManager()
      .checkStatus(profileId)
      .catch((error) => {
        const store = getProviderProfileStore();
        const profile = store.getProfile(profileId);
        const diagnostic = normalizeBackendError(error);
        if (profile?.kind === "codex-cli") {
          store.updateCodexProvider({
            status: "disconnected",
            lastCheckedAt: new Date().toISOString(),
            lastDiagnostic: diagnostic,
          });
        } else if (profile) {
          store.updateProvider(profileId, {
            status: "disconnected",
            lastCheckedAt: new Date().toISOString(),
            lastDiagnostic: diagnostic,
          });
        }
      })
      .finally(() => {
        setState((current) => ({
          ...current,
          checkingProviderId: undefined,
        }));
      });
  }, []);

  const listProviderModels = useCallback(
    async (input: {
      providerId: ProviderProfileInput["providerId"];
      baseURL: string;
      apiKey: string;
    }) => {
      const profile = createProviderProfile({
        id: "provider-draft",
        providerId: input.providerId,
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
    readProviderApiKey,
    checkProvider,
    listProviderModels,
  };
}
