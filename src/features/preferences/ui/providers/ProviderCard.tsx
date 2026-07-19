import {
  ChevronRight,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useState, type ReactElement } from "react";
import type { ProviderProfile } from "../../../../domain/agent/types";
import { isModelVisible } from "../../../../domain/agent/modelCatalog";
import { l10nAttributes, type LocalizedMessage } from "../../localization";
import { PreferenceIconButton, T } from "../PreferenceChrome";
import { ProviderBrandIcon } from "../../../../ui/ProviderBrandIcon";

type ProviderCardProps = {
  checking: boolean;
  expanded: boolean;
  onCheck: () => void;
  onDelete: () => void;
  onReadApiKey: () => string;
  onSetModelVisibility: (modelId: string, visible: boolean) => void;
  onToggle: () => void;
  onUpdate: (input: {
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
  }) => void;
  profile: ProviderProfile;
};

function ProviderCard({
  checking,
  expanded,
  onCheck,
  onDelete,
  onReadApiKey,
  onSetModelVisibility,
  onToggle,
  onUpdate,
  profile,
}: ProviderCardProps): ReactElement {
  const status = checking ? "checking" : profile.status;
  const visibleModelCount = profile.models.filter(isModelVisible).length;
  const apiKeyInputId = `zp-provider-api-key-${useId().replaceAll(":", "")}`;
  const detailsId = `zp-provider-details-${useId().replaceAll(":", "")}`;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [baseURL, setBaseURL] = useState(profile.baseURL || "");
  const [apiKey, setApiKey] = useState("");
  const [savedApiKey, setSavedApiKey] = useState("");
  const hasUnsavedChanges =
    displayName !== profile.displayName ||
    baseURL !== (profile.baseURL || "") ||
    apiKey !== savedApiKey;
  useEffect(() => {
    if (!expanded) setEditing(false);
  }, [expanded]);

  const toggleEditor = () => {
    if (editing) {
      setEditing(false);
      return;
    }
    const currentApiKey = onReadApiKey();
    setDisplayName(profile.displayName);
    setBaseURL(profile.baseURL || "");
    setApiKey(currentApiKey);
    setSavedApiKey(currentApiKey);
    if (!expanded) onToggle();
    setEditing(true);
  };
  const save = () => {
    onUpdate(
      createProviderUpdateInput({
        displayName,
        baseURL,
        apiKey,
        savedApiKey,
      }),
    );
    setApiKey("");
    setSavedApiKey("");
    setEditing(false);
  };
  return (
    <section
      className="zp-pref-provider-item"
      data-expanded={expanded || undefined}
    >
      <div className="zp-pref-provider-summary">
        <button
          aria-controls={detailsId}
          aria-expanded={expanded}
          className="zp-pref-provider-summary-main"
          onClick={onToggle}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className="zp-pref-provider-disclosure"
            size={13}
          />
          <ProviderBrandIcon brand={profile.providerId} size={16} />
          <span className="zp-pref-provider-identity">
            <span className="zp-pref-provider-name">{profile.displayName}</span>
            <span className="zp-pref-provider-description">
              {profile.kind === "codex-cli" ? (
                <T id="pref-provider-codex-description" />
              ) : (
                profile.baseURL
              )}
            </span>
          </span>
          <span
            className="zp-pref-provider-summary-status"
            data-status={status}
          >
            <ProviderStatusIcon status={status} />
            <T id={getStatusMessageId(status)} />
          </span>
        </button>
        <div className="zp-pref-provider-summary-actions">
          <PreferenceIconButton
            className="zp-pref-icon-button"
            disabled={checking}
            {...l10nAttributes("pref-provider-test-button")}
            onClick={onCheck}
            tooltip={<T id="pref-provider-test" />}
            type="button"
          >
            {checking ? (
              <LoaderCircle className="zp-pref-spin" size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
          </PreferenceIconButton>
          {profile.kind !== "codex-cli" ? (
            <>
              <PreferenceIconButton
                className="zp-pref-icon-button zp-pref-provider-key-button"
                data-saved={profile.hasApiKey || undefined}
                {...l10nAttributes(
                  profile.hasApiKey
                    ? "pref-provider-key-saved-button"
                    : "pref-provider-key-missing-button",
                )}
                onClick={toggleEditor}
                tooltip={
                  profile.hasApiKey ? (
                    <T id="pref-provider-key-saved" />
                  ) : (
                    <T id="pref-provider-key-missing" />
                  )
                }
                type="button"
              >
                <KeyRound size={14} />
              </PreferenceIconButton>
              <PreferenceIconButton
                className="zp-pref-icon-button zp-pref-icon-button-danger"
                {...l10nAttributes("pref-provider-delete-button")}
                onClick={onDelete}
                tooltip={<T id="pref-provider-delete-tooltip" />}
                type="button"
              >
                <Trash2 size={14} />
              </PreferenceIconButton>
            </>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="zp-pref-provider-details" id={detailsId}>
          {profile.models.length ? (
            <div
              className="zp-pref-provider-model-list"
              {...l10nAttributes("pref-provider-model-list")}
              role="group"
            >
              {profile.models.map((model) => {
                const visible = isModelVisible(model);
                const lastVisible = visible && visibleModelCount === 1;
                return (
                  <label
                    className="zp-pref-provider-model-row"
                    key={model.id}
                    title={model.displayName}
                  >
                    <input
                      checked={visible}
                      disabled={lastVisible}
                      {...(lastVisible
                        ? l10nAttributes("pref-provider-model-required")
                        : {})}
                      onChange={(event) =>
                        onSetModelVisibility(
                          model.id,
                          event.currentTarget.checked,
                        )
                      }
                      type="checkbox"
                    />
                    <span>{model.displayName}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="zp-pref-provider-meta">
              <span>
                <T id="pref-provider-no-models" />
              </span>
            </div>
          )}
          {editing ? (
            <div className="zp-pref-form-grid zp-pref-provider-edit-form">
              <label>
                <T id="pref-provider-name" />
                <input
                  value={displayName}
                  onChange={(event) =>
                    setDisplayName(event.currentTarget.value)
                  }
                />
              </label>
              <label>
                <T id="pref-provider-base-url" />
                <input
                  value={baseURL}
                  onChange={(event) => setBaseURL(event.currentTarget.value)}
                />
              </label>
              <div className="zp-pref-form-field">
                <label htmlFor={apiKeyInputId}>
                  <T id="pref-provider-api-key" />
                </label>
                <input
                  autoComplete="off"
                  id={apiKeyInputId}
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                />
              </div>
              <div className="zp-pref-button-group">
                <button
                  className="zp-pref-button zp-pref-button-primary"
                  disabled={!hasUnsavedChanges}
                  onClick={save}
                  type="button"
                >
                  <Save aria-hidden="true" size={14} />
                  <T id="pref-provider-save" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ProviderStatusIcon({
  size = 12,
  status,
}: {
  size?: number;
  status: ProviderProfile["status"];
}): ReactElement | null {
  if (status === "connected") {
    return <PlugZap aria-hidden="true" size={size} />;
  }
  if (status === "checking") {
    return null;
  }
  return <CircleAlert aria-hidden="true" size={size} />;
}

function getStatusMessageId(
  status: ProviderProfile["status"],
): LocalizedMessage["id"] {
  return STATUS_MESSAGE_IDS[status];
}

const STATUS_MESSAGE_IDS = {
  unchecked: "pref-provider-status-unchecked",
  checking: "pref-provider-status-checking",
  connected: "pref-provider-status-connected",
  disconnected: "pref-provider-status-disconnected",
} as const;

function createProviderUpdateInput(input: {
  displayName: string;
  baseURL: string;
  apiKey: string;
  savedApiKey: string;
}): { displayName: string; baseURL: string; apiKey?: string } {
  return {
    displayName: input.displayName,
    baseURL: input.baseURL,
    ...(input.apiKey !== input.savedApiKey ? { apiKey: input.apiKey } : {}),
  };
}

export { ProviderCard, createProviderUpdateInput };
export type { ProviderCardProps };
