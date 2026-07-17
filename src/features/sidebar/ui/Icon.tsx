import {
  Archive,
  ArchiveX,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleAlert,
  CircleStop,
  Copy,
  FileImage,
  FilePlusCorner,
  FileText,
  Folder,
  Forward,
  History,
  Landmark,
  LoaderCircle,
  Paperclip,
  Pencil,
  PencilSparkles,
  Plus,
  RotateCcw,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import { BrandIcon } from "../../../ui/BrandIcon";

const ICONS = {
  add: Plus,
  archive: Archive,
  archiveRestore: ArchiveX,
  atSign: AtSign,
  attachmentImage: FileImage,
  attachmentPdf: FilePlusCorner,
  checking: LoaderCircle,
  check: Check,
  collapse: ChevronDown,
  "chevrons-down-up": ChevronsDownUp,
  "chevrons-up-down": ChevronsUpDown,
  close: X,
  copied: Check,
  copy: Copy,
  disconnected: CircleAlert,
  edit: Pencil,
  expand: ChevronRight,
  history: History,
  newChat: Plus,
  paperclip: Paperclip,
  paperMention: FileText,
  prompt: PencilSparkles,
  resend: RotateCcw,
  send: Forward,
  stop: CircleStop,
  tool: Wrench,
  workspaceCollection: Folder,
  workspaceItem: FileText,
  workspaceLibrary: Landmark,
} satisfies Record<string, LucideIcon>;

export type IconName = "brand" | keyof typeof ICONS;

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
  if (name === "brand") {
    return (
      <BrandIcon
        aria-hidden="true"
        className={["zp-icon", className].filter(Boolean).join(" ")}
        data-icon-name={name}
        focusable="false"
        size={size}
      />
    );
  }

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
