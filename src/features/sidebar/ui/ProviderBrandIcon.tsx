import type { ReactElement } from "react";
import type { ProviderBrand } from "../../../domain/agent/providerBrand";
import { getProviderDefinition } from "../../../domain/agent/modelCatalog";
import { Icon } from "./Icon";

function ProviderBrandIcon({
  brand,
  className,
  size = 16,
}: {
  brand: ProviderBrand;
  className?: string;
  size?: number;
}): ReactElement {
  const file =
    brand === "openai"
      ? "openai.svg"
      : brand === "generic"
        ? undefined
        : getProviderDefinition(brand).iconFile;
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
