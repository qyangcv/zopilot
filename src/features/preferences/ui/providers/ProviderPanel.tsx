import { Plus } from "lucide-react";
import { useState, type ReactElement } from "react";
import type {
  AgentModelEntry,
  AgentProviderId,
  ProviderProfile,
} from "../../../../domain/agent/types";
import { PageHeader, T } from "../PreferenceChrome";
import { AddProviderForm } from "./AddProviderForm";
import { ProviderCard } from "./ProviderCard";

type ProviderPanelProps = {
  checkingProviderId?: string;
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
  onReadApiKey: (profileId: string) => string;
  onSetModelVisibility: (
    profileId: string,
    modelId: string,
    visible: boolean,
  ) => void;
  onUpdate: (
    profileId: string,
    input: { displayName?: string; baseURL?: string; apiKey?: string },
  ) => void;
  profiles: ProviderProfile[];
};

function ProviderPanel(props: ProviderPanelProps): ReactElement {
  const [createExpanded, setCreateExpanded] = useState(false);
  const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(
    () => new Set(),
  );

  return (
    <section className="zp-pref-page">
      <PageHeader
        action={
          <button
            aria-expanded={createExpanded}
            className="zp-pref-button zp-pref-button-secondary"
            onClick={() => setCreateExpanded((current) => !current)}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            <T id="pref-provider-add-action" />
          </button>
        }
        description={<T id="pref-provider-description" />}
        title={<T id="pref-provider-title" />}
      />
      {createExpanded ? (
        <AddProviderForm
          onCancel={() => setCreateExpanded(false)}
          onCreate={props.onCreate}
          onCreated={() => setCreateExpanded(false)}
          onListModels={props.onListModels}
        />
      ) : null}
      <div className="zp-pref-provider-list">
        {props.profiles.map((profile) => (
          <ProviderCard
            checking={profile.id === props.checkingProviderId}
            expanded={expandedProviderIds.has(profile.id)}
            key={profile.id}
            onCheck={() => props.onCheck(profile.id)}
            onDelete={() => {
              props.onDelete(profile.id);
              setExpandedProviderIds((current) => {
                if (!current.has(profile.id)) return current;
                const next = new Set(current);
                next.delete(profile.id);
                return next;
              });
            }}
            onReadApiKey={() => props.onReadApiKey(profile.id)}
            onSetModelVisibility={(modelId, visible) =>
              props.onSetModelVisibility(profile.id, modelId, visible)
            }
            onToggle={() =>
              setExpandedProviderIds((current) =>
                toggleProviderExpansion(current, profile.id),
              )
            }
            onUpdate={(input) => props.onUpdate(profile.id, input)}
            profile={profile}
          />
        ))}
      </div>
    </section>
  );
}

function toggleProviderExpansion(
  expandedProviderIds: ReadonlySet<string>,
  profileId: string,
): Set<string> {
  const next = new Set(expandedProviderIds);
  if (next.has(profileId)) {
    next.delete(profileId);
  } else {
    next.add(profileId);
  }
  return next;
}

export { ProviderPanel, toggleProviderExpansion };
export type { ProviderPanelProps };
