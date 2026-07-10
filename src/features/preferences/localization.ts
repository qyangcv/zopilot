import { config } from "../../../package.json";
import type { FluentMessageId } from "../../../typings/i10n";

export { formatLocalizedMessage, l10nAttributes, localized };
export type { FluentArgs, LocalizedMessage };

type FluentArgs = Record<string, string | number>;

type LocalizedMessage = {
  args?: FluentArgs;
  id: FluentMessageId;
};

type PreferenceLocalization = {
  formatValue?(id: string, args?: FluentArgs): Promise<string>;
};

declare const document:
  | (Document & { l10n?: PreferenceLocalization })
  | undefined;

function localized(id: FluentMessageId, args?: FluentArgs): LocalizedMessage {
  return args ? { id, args } : { id };
}

function l10nAttributes(
  id: FluentMessageId,
  args?: FluentArgs,
): { "data-l10n-args"?: string; "data-l10n-id": string } {
  return {
    "data-l10n-args": args ? JSON.stringify(args) : undefined,
    "data-l10n-id": `${config.addonRef}-${id}`,
  };
}

async function formatLocalizedMessage(
  message: LocalizedMessage,
): Promise<string> {
  const attributes = l10nAttributes(message.id, message.args);
  const id = attributes["data-l10n-id"];
  if (typeof document === "undefined") {
    return id;
  }
  try {
    return (await document.l10n?.formatValue?.(id, message.args)) || id;
  } catch {
    return id;
  }
}
