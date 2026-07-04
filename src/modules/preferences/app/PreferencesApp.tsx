import { PackageCheck, PencilSparkles, PlugZap } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { ConnectionPanel } from "./ConnectionPanel";
import { DependenciesPanel } from "./DependenciesPanel";
import { PromptPanel } from "./PromptPanel";
import { NavButton, T } from "./shared";
import type { PreferenceSection, PreferencesAppProps } from "./types";
import { useCodexConnection } from "./useCodexConnection";
import {
  dependencyNavCount,
  usePdfHelperDependency,
} from "./usePdfHelperDependency";
import { usePromptEditor } from "./usePromptEditor";

export { PreferencesApp };
export type { PreferencesAppProps } from "./types";

function PreferencesApp({
  getSubprocess,
  translate,
}: PreferencesAppProps): ReactElement {
  const [activeSection, setActiveSection] =
    useState<PreferenceSection>("connection");
  const { connection, runConnectionCheck } = useCodexConnection(getSubprocess);
  const {
    dependencyState,
    installDependencies,
    removeDependencies,
    runDependencyCheck,
  } = usePdfHelperDependency(getSubprocess);
  const promptEditor = usePromptEditor();

  useEffect(() => {
    translate();
  });

  return (
    <main className="zp-pref-shell">
      <aside className="zp-pref-sidebar" aria-label="Zopilot 偏好设置分组">
        <nav className="zp-pref-nav">
          <NavButton
            active={activeSection === "connection"}
            count={connection.status === "connected" ? undefined : 1}
            icon={<PlugZap size={16} />}
            label={<T id="pref-nav-connection">连接</T>}
            onClick={() => setActiveSection("connection")}
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
        {activeSection === "connection" ? (
          <ConnectionPanel
            connection={connection}
            onCheck={runConnectionCheck}
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
