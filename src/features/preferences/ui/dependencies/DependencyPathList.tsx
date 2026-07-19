import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useId, type ReactElement, type ReactNode } from "react";
import type { PdfHelperStatus } from "../../../../document/pdf-helper/index";
import { copyText } from "../../../sidebar/ui/clipboard";
import { l10nAttributes } from "../../localization";
import {
  LocalizedMessageText,
  PreferenceIconButton,
  T,
} from "../PreferenceChrome";
import { PreferenceCodeScroller } from "../PreferenceCodeScroller";
import { unsupportedDependencyMessage } from "./dependencyMessages";

type DependencyPathAction = "open-url" | "reveal";
type DependencyPathRow = {
  action?: DependencyPathAction;
  key: string;
  label: ReactNode;
  value: string;
  valueNode?: ReactNode;
};

function DependencyPathList({
  helper,
}: {
  helper: PdfHelperStatus;
}): ReactElement {
  const labelPrefix = `zp-pref-path-label-${useId().replaceAll(":", "")}`;
  return (
    <dl className="zp-pref-path-list">
      {buildDependencyPathRows(helper).map((row) => {
        const labelId = `${labelPrefix}-${row.key}`;
        return (
          <div
            className="zp-pref-path-row"
            data-scrollable={row.action || undefined}
            key={row.key}
          >
            <dt id={labelId}>{row.label}</dt>
            <dd>
              {row.action ? (
                <PreferenceCodeScroller
                  aria-labelledby={labelId}
                  value={row.value}
                />
              ) : (
                <span className="zp-pref-path-value">
                  {row.valueNode ?? row.value}
                </span>
              )}
            </dd>
            {row.action ? <PathActions row={row} /> : null}
          </div>
        );
      })}
      {helper.status === "unsupported" ? (
        <div className="zp-pref-path-row">
          <dt>
            <T id="pref-dependencies-unsupported-reason" />
          </dt>
          <dd>
            <LocalizedMessageText message={unsupportedDependencyMessage()} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function PathActions({ row }: { row: DependencyPathRow }): ReactElement {
  return (
    <div className="zp-pref-path-actions">
      <PreferenceIconButton
        className="zp-pref-icon-button zp-pref-path-action"
        {...l10nAttributes("pref-dependencies-copy-button")}
        onClick={() => void copyText(row.value).catch(() => undefined)}
        tooltip={<T id="pref-dependencies-copy" />}
        type="button"
      >
        <Copy aria-hidden="true" size={13} />
      </PreferenceIconButton>
      <PreferenceIconButton
        className="zp-pref-icon-button zp-pref-path-action"
        {...l10nAttributes(
          row.action === "open-url"
            ? "pref-dependencies-open-url-button"
            : "pref-dependencies-reveal-button",
        )}
        onClick={() => openDependencyValue(row.value, row.action)}
        tooltip={
          row.action === "open-url" ? (
            <T id="pref-dependencies-open-url" />
          ) : (
            <T id="pref-dependencies-reveal" />
          )
        }
        type="button"
      >
        {row.action === "open-url" ? (
          <ExternalLink aria-hidden="true" size={13} />
        ) : (
          <FolderOpen aria-hidden="true" size={13} />
        )}
      </PreferenceIconButton>
    </div>
  );
}

function buildDependencyPathRows(helper: PdfHelperStatus): DependencyPathRow[] {
  return [
    {
      key: "installedVersion",
      label: <T id="pref-dependencies-installed-version" />,
      value: installedVersionText(helper),
      valueNode: installedVersionNode(helper),
    },
    {
      key: "latestVersion",
      label: <T id="pref-dependencies-latest-version" />,
      value: `v${helper.latestVersion}`,
      valueNode: `v${helper.latestVersion}`,
    },
    {
      action: "reveal",
      key: "installDir",
      label: <T id="pref-dependencies-install-dir" />,
      value: helper.installDir,
    },
    {
      action: "reveal",
      key: "executablePath",
      label: <T id="pref-dependencies-executable-path" />,
      value: helper.executablePath,
    },
    {
      action: "open-url",
      key: "manifestUrl",
      label: <T id="pref-dependencies-manifest-url" />,
      value: helper.manifestUrl,
    },
  ];
}

function installedVersionText(helper: PdfHelperStatus): string {
  if (!helper.installedVersion)
    return helper.hasInstallCandidate ? "unknown" : "-";
  return `v${helper.installedVersion}`;
}

function installedVersionNode(helper: PdfHelperStatus): ReactNode {
  if (!helper.installedVersion) {
    return helper.hasInstallCandidate ? (
      <T id="pref-dependencies-version-unknown" />
    ) : (
      "-"
    );
  }
  const version = `v${helper.installedVersion}`;
  return helper.installedVersionState === "incomplete" ? (
    <>
      {version} <T id="pref-dependencies-version-incomplete" />
    </>
  ) : (
    version
  );
}

function openDependencyValue(
  value: string,
  action?: DependencyPathAction,
): void {
  if (action === "open-url") {
    Zotero.launchURL(value);
  } else if (action === "reveal") {
    void Zotero.File.reveal(value).catch(() => undefined);
  }
}

export { DependencyPathList };
