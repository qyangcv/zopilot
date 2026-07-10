import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { initLocale, getString };

type FluentPattern = {
  value?: string | null;
};

type FluentArgs = Record<string, string | number | null>;

type FluentLocalization = {
  formatMessagesSync(
    messages: Array<{ id: string; args?: FluentArgs }>,
  ): Array<FluentPattern | null>;
};

function initLocale(): void {
  const l10n = new (
    typeof Localization === "undefined"
      ? ztoolkit.getGlobal("Localization")
      : Localization
  )([`${config.addonRef}-addon.ftl`], true);
  addon.data.locale = {
    current: l10n,
  };
}

function getString(
  localeString: FluentMessageId,
  options: { args?: FluentArgs } = {},
): string {
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: localStringWithPrefix, args: options.args },
  ])[0];

  return pattern?.value || localStringWithPrefix;
}

export type { FluentLocalization };
