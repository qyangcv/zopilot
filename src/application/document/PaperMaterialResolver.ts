import type {
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../domain/conversation";
import { MaterialRepository } from "../../document/material/MaterialRepository";
import type {
  Material,
  SourceIdentity,
  WorkspaceQueryScope,
} from "../../document/types";
import { ZoteroPdfSourceResolver } from "../../integrations/zotero/ZoteroPdfSourceResolver";
import { ZoteroSourceUniverse } from "../../integrations/zotero/ZoteroWorkspaceService";
import { throwIfAborted } from "../../runtime/cancellation";

export {
  PaperMaterialResolver,
  PaperToolError,
  type PaperMaterialResolverOptions,
};

class PaperToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PaperToolError";
  }
}

type SourceUniverse = Pick<ZoteroSourceUniverse, "resolveSelectedPdfSources">;

type SourceResolver = {
  resolveDefaultSource(
    scope: WorkspaceQueryScope,
  ): Promise<SourceIdentity | null>;
  resolveSourceRef(source: PaperSourceRef): Promise<SourceIdentity | null>;
};

type MaterialCache = {
  getOrBuild(source: SourceIdentity, signal?: AbortSignal): Promise<Material>;
};

type PaperMaterialResolverOptions = {
  sourceUniverse?: SourceUniverse;
  sourceResolver?: SourceResolver;
  materialCache?: MaterialCache;
};

class PaperMaterialResolver {
  private sourceUniverse?: SourceUniverse;
  private sourceResolver?: SourceResolver;
  private materialCache?: MaterialCache;

  constructor(private readonly options: PaperMaterialResolverOptions = {}) {}

  async resolveOne(input: {
    scope?: WorkspaceQueryScope;
    bindingError?: string;
    sourceId?: string;
    signal?: AbortSignal;
  }): Promise<Material> {
    const materials = await this.resolveMany({
      ...input,
      sourceIds: input.sourceId ? [input.sourceId] : undefined,
    });
    if (materials.length !== 1) {
      throw new PaperToolError(
        "source_not_resolved",
        "The paper source could not be resolved.",
      );
    }
    return materials[0];
  }

  async resolveMany(input: {
    scope?: WorkspaceQueryScope;
    bindingError?: string;
    sourceIds?: string[];
    signal?: AbortSignal;
  }): Promise<Material[]> {
    throwIfAborted(input.signal);
    if (!input.scope) {
      throw new PaperToolError(
        "not_bound",
        input.bindingError || "This Zopilot conversation is not bound.",
      );
    }

    const sources = input.sourceIds?.length
      ? await this.resolveSelectedSources(
          input.scope,
          input.sourceIds,
          input.signal,
        )
      : await this.resolveDefaultSource(input.scope, input.signal);
    if (!sources.length) {
      throw new PaperToolError(
        "no_source",
        "No PDF source is selected. Pass a sourceId from the Zopilot conversation context.",
      );
    }

    const materials: Material[] = [];
    for (const source of sources) {
      throwIfAborted(input.signal);
      try {
        materials.push(
          await this.getMaterialCache().getOrBuild(source, input.signal),
        );
      } catch {
        throwIfAborted(input.signal);
        throw new PaperToolError(
          "material_unavailable",
          `The paper could not be parsed: ${source.title}.`,
        );
      }
    }
    return materials;
  }

  private async resolveSelectedSources(
    scope: WorkspaceQueryScope,
    sourceIds: string[],
    signal?: AbortSignal,
  ): Promise<SourceIdentity[]> {
    const refs = await this.getSourceUniverse().resolveSelectedPdfSources(
      scopeToWorkspace(scope),
      sourceIds,
    );
    throwIfAborted(signal);
    const refById = new Map(refs.map((source) => [source.sourceId, source]));
    const invalid = sourceIds.filter((sourceId) => !refById.has(sourceId));
    if (invalid.length) {
      throw new PaperToolError(
        "invalid_source",
        `Selected source is outside the current workspace: ${invalid.join(", ")}`,
      );
    }

    const resolved: SourceIdentity[] = [];
    for (const sourceId of sourceIds) {
      const ref = refById.get(sourceId);
      if (!ref) continue;
      const source = await this.getSourceResolver().resolveSourceRef(ref);
      throwIfAborted(signal);
      if (!source) {
        throw new PaperToolError(
          "source_unavailable",
          `The selected PDF is unavailable: ${sourceId}`,
        );
      }
      resolved.push(source);
    }
    return resolved;
  }

  private async resolveDefaultSource(
    scope: WorkspaceQueryScope,
    signal?: AbortSignal,
  ): Promise<SourceIdentity[]> {
    const source = await this.getSourceResolver().resolveDefaultSource(scope);
    throwIfAborted(signal);
    return source ? [source] : [];
  }

  private getSourceUniverse(): SourceUniverse {
    this.sourceUniverse ??=
      this.options.sourceUniverse || new ZoteroSourceUniverse();
    return this.sourceUniverse;
  }

  private getSourceResolver(): SourceResolver {
    this.sourceResolver ??=
      this.options.sourceResolver || new ZoteroPdfSourceResolver();
    return this.sourceResolver;
  }

  private getMaterialCache(): MaterialCache {
    this.materialCache ??=
      this.options.materialCache || new MaterialRepository();
    return this.materialCache;
  }
}

function scopeToWorkspace(scope: WorkspaceQueryScope): WorkspaceIdentity {
  return {
    workspaceKey: scope.workspaceKey,
    workspaceType: scope.workspaceType,
    workspaceLabel: scope.workspaceLabel,
    workspaceTitle: scope.workspaceLabel,
    libraryID: scope.libraryID,
    collectionKey: scope.collectionKey,
    collectionPath: scope.collectionPath,
    itemKey: scope.itemKey,
    defaultSource: scope.defaultSource
      ? {
          paperKey: scope.defaultSource.paperKey,
          libraryID: scope.defaultSource.libraryID,
          parentItemID: scope.defaultSource.parentItemID,
          parentItemKey: scope.defaultSource.parentItemKey,
          attachmentItemID: scope.defaultSource.attachmentItemID,
          attachmentKey: scope.defaultSource.attachmentKey,
          title: scope.defaultSource.title || scope.workspaceLabel,
        }
      : undefined,
  };
}
