import { config } from "../package.json";
import hooks from "./hooks";
import type { FluentLocalization } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    config: typeof config;
    initialized: boolean;
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
