import { config } from "../../../../package.json";
import { getPref, setPref } from "../../../runtime/preferences/prefs";
import type { ProviderProfile } from "../../../domain/agent/types";
import {
  parseStoredCodexStatus,
  parseStoredProfiles,
  toStoredCodexStatus,
  toStoredProviderProfile,
  type StoredCodexStatus,
  type StoredProviderProfile,
} from "./profileCodec";
import { SECRETS_PREF } from "./ProviderSecretStore";

const PROVIDERS_PREF = "agent.providerProfiles";
const ACTIVE_PROVIDER_PREF = "agent.activeProviderId";
const CODEX_STATUS_PREF = "agent.codexProviderStatus";

class ProviderProfileRepository {
  readProfiles(): StoredProviderProfile[] {
    return parseStoredProfiles(getPref(PROVIDERS_PREF));
  }

  writeProfiles(profiles: StoredProviderProfile[]): void {
    setPref(
      PROVIDERS_PREF,
      JSON.stringify(profiles.map(toStoredProviderProfile)),
    );
  }

  readActiveProviderId(): string {
    return String(getPref(ACTIVE_PROVIDER_PREF) || "");
  }

  writeActiveProviderId(profileId: string): void {
    setPref(ACTIVE_PROVIDER_PREF, profileId);
  }

  readCodexStatus(): StoredCodexStatus {
    return parseStoredCodexStatus(getPref(CODEX_STATUS_PREF));
  }

  writeCodexStatus(profile: ProviderProfile): void {
    setPref(CODEX_STATUS_PREF, JSON.stringify(toStoredCodexStatus(profile)));
  }

  observe(listener: () => void): () => void {
    const prefs = Zotero.Prefs as typeof Zotero.Prefs & {
      registerObserver?: (
        key: string,
        callback: () => void,
        global?: boolean,
      ) => symbol;
      unregisterObserver?: (observer: symbol) => void;
    };
    const observers: symbol[] = [];
    for (const key of [
      PROVIDERS_PREF,
      ACTIVE_PROVIDER_PREF,
      CODEX_STATUS_PREF,
      SECRETS_PREF,
    ]) {
      const observer = prefs.registerObserver?.(
        `${config.prefsPrefix}.${key}`,
        listener,
        true,
      );
      if (observer) observers.push(observer);
    }
    return () => {
      observers
        .splice(0)
        .forEach((observer) => prefs.unregisterObserver?.(observer));
    };
  }
}

export {
  ACTIVE_PROVIDER_PREF,
  CODEX_STATUS_PREF,
  PROVIDERS_PREF,
  ProviderProfileRepository,
};
