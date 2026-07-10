import type { ReactElement } from "react";
import type {
  AgentModelEntry,
  ProviderProfile,
} from "../../../../domain/agent/types";
import { PageHeader, T } from "../PreferenceChrome";
import { AddProviderForm } from "./AddProviderForm";
import { ProviderCard } from "./ProviderCard";

type ProviderPanelProps = {
  checkingProviderId?: string;
  message?: string;
  onCheck: (profileId: string) => void;
  onCreate: (input: {
    preset?: "openai-compatible";
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: AgentModelEntry[];
  }) => void;
  onDelete: (profileId: string) => void;
  onListModels: (input: {
    baseURL: string;
    apiKey: string;
  }) => Promise<AgentModelEntry[]>;
  onUpdate: (
    profileId: string,
    input: { displayName?: string; baseURL?: string; apiKey?: string },
  ) => void;
  profiles: ProviderProfile[];
};

function ProviderPanel(props: ProviderPanelProps): ReactElement {
  return (
    <section className="zp-pref-page">
      <PageHeader
        description={<T id="pref-provider-description">管理 AI Providers。</T>}
        title={<T id="pref-provider-title">Provider</T>}
      />
      <AddProviderForm
        onCreate={props.onCreate}
        onListModels={props.onListModels}
      />
      <div className="zp-pref-provider-list">
        {props.profiles.map((profile) => (
          <ProviderCard
            checking={profile.id === props.checkingProviderId}
            key={profile.id}
            onCheck={() => props.onCheck(profile.id)}
            onDelete={() => props.onDelete(profile.id)}
            onUpdate={(input) => props.onUpdate(profile.id, input)}
            profile={profile}
          />
        ))}
      </div>
      {props.message ? (
        <div className="zp-pref-status zp-pref-status-message">
          {props.message}
        </div>
      ) : null}
    </section>
  );
}

export { ProviderPanel };
export type { ProviderPanelProps };
