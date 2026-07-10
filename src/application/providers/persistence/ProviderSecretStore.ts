import { getPref, setPref } from "../../../runtime/preferences/prefs";

const SECRETS_PREF = "agent.providerSecrets";
type ProviderSecrets = Record<string, string>;

class ProviderSecretStore {
  get(profileId: string): string | undefined {
    return this.read()[profileId];
  }

  has(profileId: string): boolean {
    return Boolean(this.get(profileId));
  }

  set(profileId: string, apiKey: string): void {
    const secrets = this.read();
    if (apiKey.trim()) {
      secrets[profileId] = apiKey.trim();
    } else {
      delete secrets[profileId];
    }
    this.write(secrets);
  }

  delete(profileId: string): void {
    const secrets = this.read();
    delete secrets[profileId];
    this.write(secrets);
  }

  private read(): ProviderSecrets {
    try {
      const parsed = JSON.parse(
        String(getPref(SECRETS_PREF) || "{}"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" && typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  private write(secrets: ProviderSecrets): void {
    setPref(SECRETS_PREF, JSON.stringify(secrets));
  }
}

export { ProviderSecretStore, SECRETS_PREF };
