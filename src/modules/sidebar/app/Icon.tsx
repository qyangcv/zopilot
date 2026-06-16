import {
  Archive,
  ArchiveX,
  Check,
  CircleAlert,
  Copy,
  CornerDownLeft,
  FileText,
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
  archive: Archive,
  archiveRestore: ArchiveX,
  brand: MessageCircle,
  checking: LoaderCircle,
  close: X,
  context: FileText,
  copied: Check,
  copy: Copy,
  disconnected: CircleAlert,
  edit: Pencil,
  history: History,
  insert: CornerDownLeft,
  newChat: Plus,
  resend: RotateCcw,
  retry: RotateCcw,
  send: SendHorizontal,
  stop: Square,
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
