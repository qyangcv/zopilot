import { useEffect, useState, type ReactElement } from "react";
import { DependenciesPanel } from "./dependencies/DependenciesPanel";
import { PromptPanel } from "./prompts/PromptPanel";
import { ProviderPanel } from "./providers/ProviderPanel";
import type { PreferenceSection, PreferencesAppProps } from "./types";
import { usePdfHelperDependency } from "./dependencies/usePdfHelperDependency";
import { useProviderProfiles } from "./providers/useProviderProfiles";
import { usePromptEditor } from "./prompts/usePromptEditor";
import { PreferenceSectionNavigation } from "./PreferenceSectionNavigation";

export { PreferencesApp };
export type { PreferencesAppProps } from "./types";

const PREFERENCE_SECTIONS: PreferenceSection[] = [
  "providers",
  "dependencies",
  "prompts",
];

function PreferencesApp({ translate }: PreferencesAppProps): ReactElement {
  const [activeSection, setActiveSection] =
    useState<PreferenceSection>("providers");
  const providers = useProviderProfiles();
  const {
    dependencyState,
    installDependencies,
    removeDependencies,
    runDependencyCheck,
  } = usePdfHelperDependency();
  const promptEditor = usePromptEditor();

  useEffect(() => {
    translate();
  });

  const providerAlert = providers.state.profiles.some(
    (profile) => profile.status === "disconnected",
  );
  const dependencyAlert =
    dependencyState.status === "error" ||
    (dependencyState.status === "ready" &&
      dependencyState.helper.status !== "installed");

  const renderSection = (section: PreferenceSection): ReactElement => {
    if (section === "providers") {
      return (
        <ProviderPanel
          checkingProviderId={providers.state.checkingProviderId}
          onCheck={providers.checkProvider}
          onCreate={providers.createProvider}
          onDelete={providers.deleteProvider}
          onReadApiKey={providers.readProviderApiKey}
          onSetModelVisibility={providers.setModelVisibility}
          onUpdate={providers.updateProvider}
          onListModels={providers.listProviderModels}
          profiles={providers.state.profiles}
        />
      );
    }
    if (section === "dependencies") {
      return (
        <DependenciesPanel
          onCheck={runDependencyCheck}
          onInstall={installDependencies}
          onRemove={removeDependencies}
          state={dependencyState}
        />
      );
    }
    return (
      <PromptPanel
        body={promptEditor.body}
        hasUnsavedChanges={promptEditor.hasUnsavedChanges}
        message={promptEditor.message}
        mode={promptEditor.mode}
        onBack={promptEditor.returnToPromptList}
        onBodyChange={promptEditor.setBody}
        onDelete={promptEditor.removePrompt}
        onNew={promptEditor.openNewPromptEditor}
        onSave={promptEditor.savePrompt}
        onSelect={promptEditor.openPromptEditor}
        onTitleChange={promptEditor.setTitle}
        prompts={promptEditor.prompts}
        selectedPromptId={promptEditor.selectedPromptId}
        title={promptEditor.title}
      />
    );
  };

  return (
    <main className="zp-pref-shell">
      <PreferenceSectionNavigation
        activeSection={activeSection}
        dependencyAlert={dependencyAlert}
        onChange={setActiveSection}
        promptCount={promptEditor.prompts.length}
        providerAlert={providerAlert}
      />
      {PREFERENCE_SECTIONS.map((section) => (
        <section
          aria-labelledby={`zp-pref-tab-${section}`}
          className="zp-pref-main"
          hidden={section !== activeSection}
          id={`zp-pref-panel-${section}`}
          key={section}
          role="tabpanel"
        >
          {section === activeSection ? renderSection(section) : null}
        </section>
      ))}
    </main>
  );
}
