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
  Copy,
  FilePlus,
  FileImage,
  FileText,
  FolderClosed,
  FolderTree,
  History,
  Library,
  LoaderCircle,
  Paperclip,
  Pencil,
  PencilSparkles,
  Plus,
  RotateCcw,
  SendHorizontal,
  Square,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement, SVGProps } from "react";
import { BRAND_ICON_PATH } from "./brandIcon";

const ICONS = {
  add: Plus,
  archive: Archive,
  archiveRestore: ArchiveX,
  attachment: FilePlus,
  attachmentImage: FileImage,
  attachmentPdf: FileText,
  checking: LoaderCircle,
  check: Check,
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
  paperclip: Paperclip,
  paperMention: BookOpenText,
  prompt: PencilSparkles,
  reader: FileText,
  resend: RotateCcw,
  send: SendHorizontal,
  stop: Square,
  tool: Wrench,
  workspace: FolderClosed,
  workspaceCollection: FolderTree,
  workspaceItem: FileText,
  workspaceLibrary: Library,
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

function BrandIcon({
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }): ReactElement {
  return (
    <svg
      {...props}
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={BRAND_ICON_PATH} stroke="none" />
    </svg>
  );
}
