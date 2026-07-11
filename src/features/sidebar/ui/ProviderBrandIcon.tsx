import type { ReactElement } from "react";
import type { ProviderBrand } from "../../../domain/agent/providerBrand";
import { Icon } from "./Icon";

const PROVIDER_ICON_FILES: Partial<Record<ProviderBrand, string>> = {
  codex: "codex-color.svg",
  openai: "openai.svg",
  deepseek: "deepseek-color.svg",
  minimax: "minimax-color.svg",
  "z-ai": "zhipu-color.svg",
};

function ProviderBrandIcon({
  brand,
  className,
  size = 16,
}: {
  brand: ProviderBrand;
  className?: string;
  size?: number;
}): ReactElement {
  const file = PROVIDER_ICON_FILES[brand];
  if (!file) {
    return (
      <span
        aria-hidden="true"
        className={[
          "zp-provider-brand-icon",
          "zp-provider-brand-icon-generic",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        data-provider-brand={brand}
        style={{ height: size, width: size }}
      >
        <Icon name="brand" size={size} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={["zp-provider-brand-icon", className]
        .filter(Boolean)
        .join(" ")}
      data-provider-brand={brand}
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        height={size}
        src={`chrome://zopilot/content/icons/providers/${file}`}
        width={size}
      />
    </span>
  );
}

export { ProviderBrandIcon };
