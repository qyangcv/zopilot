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
  length: number;
  indexedState?: number;
  warnings: string[];
};
