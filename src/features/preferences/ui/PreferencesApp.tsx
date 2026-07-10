import { PackageCheck, PencilSparkles, PlugZap } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { DependenciesPanel } from "./dependencies/DependenciesPanel";
import { PromptPanel } from "./prompts/PromptPanel";
import { ProviderPanel } from "./providers/ProviderPanel";
import { NavButton, T } from "./PreferenceChrome";
import type { PreferenceSection, PreferencesAppProps } from "./types";
import {
  dependencyNavCount,
  usePdfHelperDependency,
} from "./dependencies/usePdfHelperDependency";
import { useProviderProfiles } from "./providers/useProviderProfiles";
import { usePromptEditor } from "./prompts/usePromptEditor";

export { PreferencesApp };
export type { PreferencesAppProps } from "./types";

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

  return (
    <main className="zp-pref-shell">
      <aside className="zp-pref-sidebar" aria-label="Zopilot 偏好设置分组">
        <nav className="zp-pref-nav">
          <NavButton
            active={activeSection === "providers"}
            count={
              providers.state.profiles.some(
                (profile) => profile.status === "disconnected",
              )
                ? 1
                : undefined
            }
            icon={<PlugZap size={16} />}
            label={<T id="pref-nav-providers">Provider</T>}
            onClick={() => setActiveSection("providers")}
          />
          <NavButton
            active={activeSection === "dependencies"}
            count={dependencyNavCount(dependencyState)}
            icon={<PackageCheck size={16} />}
            label={<T id="pref-nav-dependencies">依赖管理</T>}
            onClick={() => setActiveSection("dependencies")}
          />
          <NavButton
            active={activeSection === "prompts"}
            count={promptEditor.prompts.length || undefined}
            icon={<PencilSparkles size={16} />}
            label={<T id="pref-nav-prompts">Prompt</T>}
            onClick={() => setActiveSection("prompts")}
          />
        </nav>
      </aside>
      <section className="zp-pref-main">
        {activeSection === "providers" ? (
          <ProviderPanel
            checkingProviderId={providers.state.checkingProviderId}
            message={providers.state.message}
            onCheck={providers.checkProvider}
            onCreate={providers.createProvider}
            onDelete={providers.deleteProvider}
            onUpdate={providers.updateProvider}
            onListModels={providers.listProviderModels}
            profiles={providers.state.profiles}
          />
        ) : activeSection === "dependencies" ? (
          <DependenciesPanel
            onCheck={runDependencyCheck}
            onInstall={installDependencies}
            onRemove={removeDependencies}
            state={dependencyState}
          />
        ) : (
          <PromptPanel
            body={promptEditor.body}
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
        )}
      </section>
    </main>
  );
}
