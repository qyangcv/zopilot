import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../domain/conversation";
import { getZoteroGlobal } from "./environment";
import { ZoteroSourceCatalog } from "./sources/ZoteroSourceCatalog";
import { ZoteroItemContextCatalog } from "./sources/ZoteroItemContextCatalog";
import { ZoteroWorkspaceFactory } from "./sources/ZoteroWorkspaceFactory";

class ZoteroSourceUniverse {
  private readonly catalog: ZoteroSourceCatalog;
  private readonly itemContextCatalog: ZoteroItemContextCatalog;
  private readonly workspaceFactory: ZoteroWorkspaceFactory;

  constructor(zotero: typeof Zotero = getZoteroGlobal()) {
    this.catalog = new ZoteroSourceCatalog(zotero);
    this.itemContextCatalog = new ZoteroItemContextCatalog(zotero);
    this.workspaceFactory = new ZoteroWorkspaceFactory(zotero);
  }

  getSnapshot(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }) {
    return this.catalog.getSnapshot(input);
  }

  resolveSources(
    workspace: WorkspaceIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    return this.catalog.resolveSources(workspace, currentSource);
  }

  getItemContextTree(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }) {
    return this.itemContextCatalog.getTree(input);
  }

  resolveSelectedPdfSources(
    workspace: WorkspaceIdentity,
    sourceIds: string[],
  ): Promise<PaperSourceRef[]> {
    return this.itemContextCatalog.resolveSelectedPdfSources(
      workspace,
      sourceIds,
    );
  }

  createLibraryWorkspace(
    input: Parameters<ZoteroWorkspaceFactory["createLibraryWorkspace"]>[0],
  ) {
    return this.workspaceFactory.createLibraryWorkspace(input);
  }

  createCollectionWorkspace(
    input: Parameters<ZoteroWorkspaceFactory["createCollectionWorkspace"]>[0],
  ) {
    return this.workspaceFactory.createCollectionWorkspace(input);
  }

  createItemWorkspace(source: PaperSourceRef) {
    return this.workspaceFactory.createItemWorkspace(source);
  }
}

export { ZoteroSourceUniverse };
export {
  createPaperSourceRef,
  paperSourceRefToIdentity,
} from "./sources/items";
