import type { FluentMessageId } from "../../../../typings/i10n";
import type {
  SidebarActions,
  SidebarState,
  SidebarStreamingSnapshot,
} from "../ui/types";

type SidebarActionCommand = {
  [Name in keyof SidebarActions]: {
    type: Name;
    args: Parameters<SidebarActions[Name]>;
  };
}[keyof SidebarActions];

type SidebarCommand =
  | SidebarActionCommand
  | {
      type: "localize";
      args: [
        FluentMessageId,
        { args?: Record<string, string | number | null> }?,
      ];
    };

type SidebarCommandDispatch = (command: SidebarCommand) => unknown;

type SidebarWindowHost = {
  attach(panel: Element): boolean;
  render(state: SidebarState): void;
  publishStreaming(snapshot: SidebarStreamingSnapshot | undefined): void;
  isAttachedTo(panel: Element): boolean;
  focus(): void;
  destroy(): void;
};

type SidebarWindowRuntime = {
  createHost(
    panel: Element,
    dispatch: SidebarCommandDispatch,
  ): SidebarWindowHost;
};

const SIDEBAR_WINDOW_RUNTIME_KEY = "__zopilotSidebarWindowRuntime__";

export { SIDEBAR_WINDOW_RUNTIME_KEY };
export type {
  SidebarActionCommand,
  SidebarCommand,
  SidebarCommandDispatch,
  SidebarWindowHost,
  SidebarWindowRuntime,
};
