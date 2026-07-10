import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { PdfHelperStatus } from "../../../../document/pdf-helper/index";
import { copyText } from "../../../sidebar/ui/clipboard";
import { T } from "../PreferenceChrome";

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
  return (
    <dl className="zp-pref-path-list">
      {buildDependencyPathRows(helper).map((row) => (
        <div className="zp-pref-path-row" key={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.valueNode ?? row.value}</dd>
          {row.action ? <PathActions row={row} /> : null}
        </div>
      ))}
      {helper.status === "unsupported" ? (
        <div className="zp-pref-path-row">
          <dt>
            <T id="pref-dependencies-unsupported-reason">原因</T>
          </dt>
          <dd title={helper.reason}>{helper.reason}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function PathActions({ row }: { row: DependencyPathRow }): ReactElement {
  return (
    <div className="zp-pref-path-actions">
      <button
        className="zp-pref-button zp-pref-button-secondary zp-pref-path-action"
        onClick={() => void copyText(row.value).catch(() => undefined)}
        type="button"
      >
        <Copy size={13} />
        <T id="pref-dependencies-copy">复制</T>
      </button>
      <button
        className="zp-pref-button zp-pref-button-secondary zp-pref-path-action"
        onClick={() => openDependencyValue(row.value, row.action)}
        type="button"
      >
        {row.action === "open-url" ? (
          <ExternalLink size={13} />
        ) : (
          <FolderOpen size={13} />
        )}
        {row.action === "open-url" ? (
          <T id="pref-dependencies-open-url">打开链接</T>
        ) : (
          <T id="pref-dependencies-reveal">在文件管理器中显示</T>
        )}
      </button>
    </div>
  );
}

function buildDependencyPathRows(helper: PdfHelperStatus): DependencyPathRow[] {
  return [
    {
      key: "installedVersion",
      label: <T id="pref-dependencies-installed-version">已安装版本</T>,
      value: installedVersionText(helper),
      valueNode: installedVersionNode(helper),
    },
    {
      key: "latestVersion",
      label: <T id="pref-dependencies-latest-version">最新版本</T>,
      value: `v${helper.latestVersion}`,
      valueNode: `v${helper.latestVersion}`,
    },
    {
      action: "reveal",
      key: "installDir",
      label: <T id="pref-dependencies-install-dir">安装目录</T>,
      value: helper.installDir,
    },
    {
      action: "reveal",
      key: "executablePath",
      label: <T id="pref-dependencies-executable-path">可执行文件</T>,
      value: helper.executablePath,
    },
    {
      action: "open-url",
      key: "manifestUrl",
      label: <T id="pref-dependencies-manifest-url">Manifest</T>,
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
      <T id="pref-dependencies-version-unknown">未知</T>
    ) : (
      "-"
    );
  }
  const version = `v${helper.installedVersion}`;
  return helper.installedVersionState === "incomplete" ? (
    <>
      {version} <T id="pref-dependencies-version-incomplete">不完整</T>
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
