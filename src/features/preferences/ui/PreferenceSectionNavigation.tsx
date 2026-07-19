import {
  PackageCheck,
  PencilSparkles,
  PlugZap,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { SingleSelect } from "../../../ui/primitives/index";
import {
  formatLocalizedMessage,
  l10nAttributes,
  localized,
} from "../localization";
import { T } from "./PreferenceChrome";
import type { PreferenceSection } from "./types";

export { PreferenceSectionNavigation, findNextPreferenceSection };

const SECTION_ORDER: PreferenceSection[] = [
  "providers",
  "dependencies",
  "prompts",
];

const SECTION_CONFIG: Record<
  PreferenceSection,
  {
    icon: LucideIcon;
    l10nId: "pref-nav-providers" | "pref-nav-dependencies" | "pref-nav-prompts";
  }
> = {
  providers: {
    icon: PlugZap,
    l10nId: "pref-nav-providers",
  },
  dependencies: {
    icon: PackageCheck,
    l10nId: "pref-nav-dependencies",
  },
  prompts: {
    icon: PencilSparkles,
    l10nId: "pref-nav-prompts",
  },
};

function PreferenceSectionNavigation({
  activeSection,
  dependencyAlert,
  onChange,
  promptCount,
  providerAlert,
}: {
  activeSection: PreferenceSection;
  dependencyAlert: boolean;
  onChange: (section: PreferenceSection) => void;
  promptCount: number;
  providerAlert: boolean;
}): ReactElement {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels = useSectionLabels();

  const selectAndFocus = (section: PreferenceSection) => {
    onChange(section);
    const index = SECTION_ORDER.indexOf(section);
    queueMicrotask(() =>
      tabRefs.current[index]?.focus({ preventScroll: true }),
    );
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    section: PreferenceSection,
  ) => {
    const next = findNextPreferenceSection(section, event.key);
    if (!next) return;
    event.preventDefault();
    selectAndFocus(next);
  };

  return (
    <div className="zp-pref-section-navigation">
      <nav
        className="zp-pref-tabs"
        {...l10nAttributes("pref-navigation")}
        role="tablist"
      >
        {SECTION_ORDER.map((section, index) => {
          const config = SECTION_CONFIG[section];
          const Icon = config.icon;
          const active = section === activeSection;
          const alert =
            section === "providers"
              ? providerAlert
              : section === "dependencies"
                ? dependencyAlert
                : false;
          return (
            <button
              aria-controls={`zp-pref-panel-${section}`}
              aria-selected={active}
              className="zp-pref-tab"
              data-active={active || undefined}
              id={`zp-pref-tab-${section}`}
              key={section}
              onClick={() => onChange(section)}
              onKeyDown={(event) => handleKeyDown(event, section)}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={14} />
              <T id={config.l10nId} />
              {alert ? (
                <span
                  aria-hidden="true"
                  className="zp-pref-tab-alert"
                  data-kind="error"
                />
              ) : null}
              {section === "prompts" && promptCount ? (
                <span className="zp-pref-tab-count">{promptCount}</span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="zp-pref-section-switcher">
        <SingleSelect
          aria-label={labels.navigation}
          allowFullTriggerLabel
          onChange={(value) => onChange(value as PreferenceSection)}
          options={SECTION_ORDER.map((section) => {
            const config = SECTION_CONFIG[section];
            const Icon = config.icon;
            return {
              icon: <Icon aria-hidden="true" size={14} />,
              label:
                section === "prompts" && promptCount
                  ? `${labels[section]} · ${promptCount}`
                  : labels[section],
              value: section,
            };
          })}
          popupMinWidth={180}
          popupWidthMode="anchor"
          preferredSide="below"
          value={activeSection}
          variant="form"
        />
      </div>
    </div>
  );
}

function findNextPreferenceSection(
  current: PreferenceSection,
  key: string,
): PreferenceSection | undefined {
  const currentIndex = SECTION_ORDER.indexOf(current);
  if (key === "Home") return SECTION_ORDER[0];
  if (key === "End") return SECTION_ORDER[SECTION_ORDER.length - 1];
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const direction = key === "ArrowRight" ? 1 : -1;
  return SECTION_ORDER[
    (currentIndex + direction + SECTION_ORDER.length) % SECTION_ORDER.length
  ];
}

function useSectionLabels(): Record<PreferenceSection | "navigation", string> {
  const [labels, setLabels] = useState({
    providers: "",
    dependencies: "",
    prompts: "",
    navigation: "",
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      ...SECTION_ORDER.map((section) =>
        formatLocalizedMessage(localized(SECTION_CONFIG[section].l10nId)),
      ),
      formatLocalizedMessage(localized("pref-navigation-label")),
    ]).then(([providers, dependencies, prompts, navigation]) => {
      if (!cancelled) {
        setLabels({ providers, dependencies, prompts, navigation });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}
