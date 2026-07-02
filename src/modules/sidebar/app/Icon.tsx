import {
  Archive,
  ArchiveX,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  Command,
  Copy,
  FilePlus,
  FileImage,
  FileText,
  FolderTree,
  History,
  Library,
  LoaderCircle,
  MessageCircle,
  MessageSquareText,
  Pencil,
  PencilSparkles,
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
  attachment: FilePlus,
  attachmentImage: FileImage,
  attachmentPdf: FileText,
  brand: MessageCircle,
  checking: LoaderCircle,
  check: Check,
  command: Command,
  collapse: ChevronDown,
  "chevrons-down-up": ChevronsDownUp,
  "chevrons-up-down": ChevronsUpDown,
  close: X,
  context: FileText,
  copied: Check,
  copy: Copy,
  disconnected: CircleAlert,
  edit: Pencil,
  expand: ChevronRight,
  history: History,
  newChat: Plus,
  paperMention: BookOpenText,
  prompt: PencilSparkles,
  reader: FileText,
  resend: RotateCcw,
  send: SendHorizontal,
  stop: Square,
  workspace: MessageSquareText,
  workspaceCollection: FolderTree,
  workspaceItem: FileText,
  workspaceLibrary: Library,
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
