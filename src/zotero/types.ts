export type PaperScope = {
  source: "reader";
  readerItemID: number;
  attachmentItemID: number;
  attachmentKey: string;
  parentItemID?: number;
  libraryID: number;
  readerType?: string;
  warnings: string[];
};

export type PaperMetadata = {
  itemID: number;
  libraryID: number;
  key: string;
  itemType: string;
  title: string;
  creators: string[];
  date?: string;
  year?: string;
  doi?: string;
  abstract?: string;
  warnings: string[];
};

export type PdfAttachment = {
  itemID: number;
  libraryID: number;
  key: string;
  title: string;
  contentType?: string;
  path?: string;
  isPdf: boolean;
  exists?: boolean;
  readable: boolean;
  warnings: string[];
};

export type PaperTextStatus =
  | "indexed"
  | "partial"
  | "unindexed"
  | "queued"
  | "unavailable"
  | "empty"
  | "error";

export type PaperTextResult = {
  status: PaperTextStatus;
  text: string;
  preview: string;
  length: number;
  indexedState?: number;
  warnings: string[];
};

export type SelectedTextResult = {
  status: "selected" | "empty" | "unavailable" | "error";
  text: string;
  warnings: string[];
};

export type PaperPromptContext = {
  scope: PaperScope | null;
  metadata: PaperMetadata | null;
  attachment: PdfAttachment | null;
  text: PaperTextResult;
  selection: SelectedTextResult;
  warnings: string[];
};
