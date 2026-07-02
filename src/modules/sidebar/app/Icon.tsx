import {
  Archive,
  ArchiveX,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Command,
  Copy,
  CornerDownLeft,
  FilePlus,
  FileText,
  HelpCircle,
  History,
  LoaderCircle,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  SendHorizontal,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

const ICONS = {
  add: Plus,
  agentMode: Bot,
  archive: Archive,
  archiveRestore: ArchiveX,
  askMode: HelpCircle,
  attachment: FilePlus,
  brand: MessageCircle,
  checking: LoaderCircle,
  command: Command,
  collapse: ChevronDown,
  close: X,
  context: FileText,
  copied: Check,
  copy: Copy,
  disconnected: CircleAlert,
  edit: Pencil,
  expand: ChevronRight,
  history: History,
  insert: CornerDownLeft,
  newChat: Plus,
  prompt: FileText,
  reader: FileText,
  resend: RotateCcw,
  retry: RotateCcw,
  send: SendHorizontal,
  stop: Square,
  skill: Bot,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

type IconProps = {
  className?: string;
  name: IconName;
  size?: number;
  strokeWidth?: number;
};

export function Icon({
  className,
  name,
  size = 16,
  strokeWidth = 1.8,
}: IconProps): ReactElement {
  const Component = ICONS[name];
  return (
    <Component
      aria-hidden="true"
      className={["zp-icon", className].filter(Boolean).join(" ")}
      data-icon-name={name}
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}
