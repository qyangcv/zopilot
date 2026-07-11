import type { ReactElement } from "react";
import { getProviderDefinition } from "../domain/agent/modelCatalog";
import type { ProviderBrand } from "../domain/agent/providerBrand";
import { BrandIcon } from "./BrandIcon";

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
  const classes = [
    "zp-provider-brand-icon",
    !file && "zp-provider-brand-icon-generic",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-hidden="true"
      className={classes}
      data-provider-brand={brand}
      style={{ height: size, width: size }}
    >
      {file ? (
        <img
          alt=""
          height={size}
          src={`chrome://zopilot/content/icons/providers/${file}`}
          width={size}
        />
      ) : (
        <BrandIcon
          className="zp-icon"
          data-icon-name="brand"
          focusable="false"
          size={size}
        />
      )}
    </span>
  );
}

export { ProviderBrandIcon };
