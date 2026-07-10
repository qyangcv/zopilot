import { config } from "../../package.json";
import hooks from "./registerHooks";
import type { FluentLocalization } from "./localization";
import { createZToolkit } from "../integrations/zotero/ztoolkit";

class Addon {
  public data: {
    config: typeof config;
    initialized: boolean;
    rootURI?: string;
    ztoolkit: ZToolkit;
    locale?: {
      current: FluentLocalization;
    };
  };
  public hooks: typeof hooks;

  constructor() {
    this.data = {
      config,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
  }
}

export default Addon;
