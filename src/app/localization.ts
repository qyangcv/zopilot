import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { configureLocaleFormatter, initLocale, getString };

type FluentPattern = {
  value?: string | null;
};

type FluentArgs = Record<string, string | number | null>;

type FluentLocalization = {
  formatMessagesSync(
    messages: Array<{ id: string; args?: FluentArgs }>,
  ): Array<FluentPattern | null>;
};

type LocaleFormatter = (
  id: FluentMessageId,
  options?: { args?: FluentArgs },
) => string;

let currentLocalization: FluentLocalization | undefined;
let localeFormatter: LocaleFormatter | undefined;

function initLocale(): void {
  const l10n = new Localization([`${config.addonRef}-addon.ftl`], true);
  currentLocalization = l10n;
  addon.data.locale = {
    current: l10n,
  };
}

function configureLocaleFormatter(
  formatter: LocaleFormatter | undefined,
): void {
  localeFormatter = formatter;
}

function getString(
  localeString: FluentMessageId,
  options: { args?: FluentArgs } = {},
): string {
  if (localeFormatter) return localeFormatter(localeString, options);
  const localStringWithPrefix = `${config.addonRef}-${localeString}`;
  const storedLocalization =
    typeof addon === "undefined" ? undefined : addon.data.locale?.current;
  const pattern = (
    currentLocalization || storedLocalization
  )?.formatMessagesSync([{ id: localStringWithPrefix, args: options.args }])[0];

  return pattern?.value || localStringWithPrefix;
}

export type { FluentLocalization };
