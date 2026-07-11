import { useCallback, useEffect, useState } from "react";
import { getAgentBackendManager } from "../../../../application/agent/BackendManager";
import { createProviderProfile } from "../../../../domain/agent/modelCatalog";
import { getProviderProfileStore } from "../../../../application/providers/ProviderProfileService";
import type {
  AgentModelEntry,
  ProviderProfile,
  ProviderProfileInput,
} from "../../../../domain/agent/types";
import { getByokRuntimeBridge } from "../../../../integrations/byok/ByokRuntimeBridge";
import { localized, type LocalizedMessage } from "../../localization";
import {
  providerDiagnosticMessage,
  providerErrorMessage,
} from "./providerMessages";

export { useProviderProfiles };

type ProviderProfilesState = {
  activeProviderId: string;
  profiles: ProviderProfile[];
  checkingProviderId?: string;
  message?: LocalizedMessage;
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
              ? localized("pref-provider-check-connected")
              : result.diagnostic
                ? providerDiagnosticMessage(result.diagnostic.code)
                : localized("pref-provider-check-failed"),
        }));
      })
      .catch((error) => {
        setState((current) => ({
          ...current,
          checkingProviderId: undefined,
          message: providerErrorMessage(error),
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
    checkProvider,
    listProviderModels,
  };
}
