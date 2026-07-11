import type { ReactElement } from "react";
import type {
  AgentModelEntry,
  AgentProviderId,
  ProviderProfile,
} from "../../../../domain/agent/types";
import type { LocalizedMessage } from "../../localization";
import { LocalizedMessageText, PageHeader, T } from "../PreferenceChrome";
import { AddProviderForm } from "./AddProviderForm";
import { ProviderCard } from "./ProviderCard";

type ProviderPanelProps = {
  checkingProviderId?: string;
  message?: LocalizedMessage;
  onCheck: (profileId: string) => void;
  onCreate: (input: {
    providerId: Exclude<AgentProviderId, "codex">;
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: AgentModelEntry[];
  }) => void;
  onDelete: (profileId: string) => void;
  onListModels: (input: {
    providerId: Exclude<AgentProviderId, "codex">;
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
        description={
          <T id="pref-provider-description">
            管理 Codex CLI 和兼容 OpenAI API 的模型服务。
          </T>
        }
        title={<T id="pref-provider-title">模型服务</T>}
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
          <LocalizedMessageText message={props.message} />
        </div>
      ) : null}
    </section>
  );
}

export { ProviderPanel };
export type { ProviderPanelProps };
