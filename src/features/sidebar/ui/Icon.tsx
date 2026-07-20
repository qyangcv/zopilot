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
  File,
  FileImage,
  FilePlusCorner,
  FileText,
  Folder,
  Forward,
  History,
  Landmark,
  LoaderCircle,
  NotebookText,
  Paperclip,
  Pencil,
  PencilSparkles,
  Plus,
  RefreshCcw,
  RotateCcw,
  Square,
  SquareCheck,
  StickyNote,
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
  file: File,
  history: History,
  newChat: Plus,
  notebookText: NotebookText,
  noteContext: StickyNote,
  paperclip: Paperclip,
  paperMention: FileText,
  prompt: PencilSparkles,
  reload: RefreshCcw,
  resend: RotateCcw,
  send: Forward,
  square: Square,
  squareCheck: SquareCheck,
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
