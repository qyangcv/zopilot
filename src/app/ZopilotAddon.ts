import { config } from "../../package.json";
import hooks from "./registerHooks";
import type { FluentLocalization } from "./localization";

class Addon {
  public data: {
    config: typeof config;
    initialized: boolean;
    rootURI?: string;
    locale?: {
      current: FluentLocalization;
    };
  };
  public hooks: typeof hooks;

  constructor() {
    this.data = {
      config,
      initialized: false,
    };
    this.hooks = hooks;
  }
}

export default Addon;
