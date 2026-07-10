import type { WorkspaceType } from "../domain/conversation";
import type { PaperSourceRef } from "../domain/conversation";

export type SourceIdentity = {
  sourceId: string;
  paperKey: string;
  libraryID: number;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
  filePath: string;
  mtime: number;
  size: number;
  pdfHash: string;
};

export type WorkspaceQueryScope = {
  conversationId: string;
  workspaceKey: string;
  workspaceType: WorkspaceType;
  workspaceLabel: string;
  libraryID: number;
  collectionKey?: string;
  collectionPath?: string[];
  itemKey?: string;
  defaultSource?: {
    paperKey: string;
    libraryID: number;
    parentItemID?: number;
    parentItemKey?: string;
    attachmentItemID: number;
    attachmentKey: string;
    title?: string;
  };
};

export type MaterialManifest = {
  schemaVersion: number;
  parser: string;
  parserVersion: string;
  source: SourceIdentity;
  builtAt: string;
  pageCount: number;
  status: "ready" | "failed";
  warnings: string[];
};

export type ContextSourceSelection = {
  sourceIds?: string[];
  sources?: PaperSourceRef[];
};

export type MaterialPage = {
  page: number;
  text: string;
  imagePath?: string;
};

export type MaterialArtifactType = "figure" | "table" | "equation" | "page";

export type MaterialArtifact = {
  id: string;
  type: MaterialArtifactType;
  label: string;
  page?: number;
  caption?: string;
  imagePath?: string;
  surroundingChunkIds: string[];
  confidence: number;
  note?: string;
};

export type MaterialChunkKind =
  | "title"
  | "abstract"
  | "body"
  | "caption"
  | "table"
  | "references";

export type MaterialChunk = {
  id: string;
  sourceId: string;
  index: number;
  kind: MaterialChunkKind;
  title?: string;
  sectionPath: string[];
  pageStart?: number;
  pageEnd?: number;
  text: string;
  artifactIds: string[];
};

export type Material = {
  dir: string;
  manifest: MaterialManifest;
  markdown: string;
  text: string;
  pages: MaterialPage[];
  chunks: MaterialChunk[];
  artifacts: MaterialArtifact[];
};

export type QueryIntent =
  | "summary"
  | "table"
  | "figure"
  | "equation"
  | "page"
  | "metadata"
  | "general";

export type QueryPlan = {
  query: string;
  intent: QueryIntent;
  locator?: {
    type: "table" | "figure" | "equation" | "page";
    value: string;
    page?: number;
  };
  includeReferences: boolean;
};

export type RetrievalCandidate = {
  chunk: MaterialChunk;
  score: number;
  reasons: string[];
};

export type ContextEvidence = {
  type: "chunk" | "artifact";
  sourceId: string;
  chunkId?: string;
  artifactId?: string;
  label?: string;
  page?: number;
  sectionPath: string[];
  imagePath?: string;
  score: number;
  reasons: string[];
  text: string;
};

export type BuiltContext = {
  status: "ready" | "not_bound" | "no_source" | "material_error" | "no_match";
  workspace: {
    key: string;
    type: WorkspaceType;
    label: string;
  };
  sources: SourceIdentity[];
  query: QueryPlan;
  evidence: ContextEvidence[];
  warnings: string[];
};
