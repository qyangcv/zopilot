import { buildChunksAndArtifacts } from "./chunker";
import { parseMaterialBlock, parseMaterialOutline } from "./materialCodec";
import { waitForSubprocessResult } from "../../runtime/process/subprocess";
import type {
  Material,
  MaterialArtifact,
  MaterialChunk,
  MaterialManifest,
  MaterialPage,
  SourceIdentity,
} from "../types";
import { getPdfHelperCommand } from "../pdf-helper/index";
import { createLogger } from "../../runtime/logging/logger";
import { encodePathSegment } from "../../runtime/persistence/pathCodec";
import { throwIfAborted } from "../../runtime/cancellation";
import { geckoIO, geckoPath, loadSubprocessModule } from "../../platform/gecko";

export { MaterialRepository, MATERIAL_SCHEMA_VERSION, MATERIAL_PARSER_VERSION };

const MATERIAL_SCHEMA_VERSION = 3;
const MATERIAL_PARSER_VERSION = "pymupdf4llm-1.28.0-ir1";
const MATERIAL_PARSER_NAME = "Zopilot PDF Helper/PyMuPDF4LLM";
const EXTRACTOR_NAME = "PyMuPDF4LLM";
const EXTRACTOR_VERSION = "1.28.0";

const logger = createLogger("document.materialCache");

type SubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
  }): Promise<SubprocessProcess>;
};

type SubprocessProcess = {
  stdout?: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill?(timeout?: number): Promise<unknown>;
};

class MaterialRepository {
  constructor(private readonly rootDir = getDefaultMaterialRootDir()) {}

  async getOrBuild(
    source: SourceIdentity,
    signal?: AbortSignal,
  ): Promise<Material> {
    throwIfAborted(signal);
    const dir = this.getSourceDir(source.sourceId);
    const manifest = await this.readManifestIfFresh(dir, source);
    throwIfAborted(signal);
    if (manifest) {
      const currentManifest = { ...manifest, source };
      if (!sameSourceMetadata(manifest.source, source)) {
        await this.writeJSON(this.getManifestPath(dir), currentManifest);
      }
      return this.readMaterial(dir, currentManifest);
    }
    return this.build(source, dir, signal);
  }

  private async build(
    source: SourceIdentity,
    dir: string,
    signal?: AbortSignal,
  ): Promise<Material> {
    throwIfAborted(signal);
    await geckoIO.remove(dir, { recursive: true, ignoreAbsent: true });
    await geckoIO.makeDirectory(geckoPath.join(dir, "assets"), {
      createAncestors: true,
      ignoreExisting: true,
    });

    let parserWarnings: string[] = [];
    let pageCount = 0;
    try {
      const result = await this.runParser(source.filePath, dir, signal);
      parserWarnings = result.warnings;
      pageCount = result.pageCount;
    } catch (error) {
      if (signal?.aborted) {
        await geckoIO.remove(dir, { recursive: true, ignoreAbsent: true });
        throw error;
      }
      const manifest: MaterialManifest = {
        schemaVersion: MATERIAL_SCHEMA_VERSION,
        parser: MATERIAL_PARSER_NAME,
        parserVersion: MATERIAL_PARSER_VERSION,
        source,
        builtAt: new Date().toISOString(),
        pageCount: 0,
        status: "failed",
        warnings: [String(error)],
      };
      await this.writeJSON(this.getManifestPath(dir), manifest);
      throw error;
    }

    throwIfAborted(signal);
    const markdown = await geckoIO.readUTF8(geckoPath.join(dir, "paper.md"));
    const text = await geckoIO.readUTF8(geckoPath.join(dir, "paper.txt"));
    const pages = await this.readPages(dir);
    const blocks = (
      await this.readJSONL<unknown>(geckoPath.join(dir, "blocks.jsonl"))
    ).map(parseMaterialBlock);
    const outline = parseMaterialOutline(
      await geckoIO.readJSON(geckoPath.join(dir, "outline.json")),
    );
    const { chunks, artifacts } = buildChunksAndArtifacts({
      sourceId: source.sourceId,
      blocks,
      outline,
      pages,
    });
    await this.writeJSONL(geckoPath.join(dir, "chunks.jsonl"), chunks);
    await this.writeJSON(geckoPath.join(dir, "artifacts.json"), artifacts);

    const manifest: MaterialManifest = {
      schemaVersion: MATERIAL_SCHEMA_VERSION,
      parser: MATERIAL_PARSER_NAME,
      parserVersion: MATERIAL_PARSER_VERSION,
      source,
      builtAt: new Date().toISOString(),
      pageCount: pageCount || pages.length,
      status: "ready",
      warnings: parserWarnings,
    };
    await this.writeJSON(this.getManifestPath(dir), manifest);
    return {
      dir,
      manifest,
      markdown,
      text,
      pages,
      blocks,
      outline,
      chunks,
      artifacts,
    };
  }

  private async runParser(
    filePath: string,
    dir: string,
    signal?: AbortSignal,
  ): Promise<{ pageCount: number; warnings: string[] }> {
    const subprocess = this.getSubprocess();
    const helper = await getPdfHelperCommand();
    const proc = await subprocess.call({
      command: helper.command,
      arguments: [...helper.argumentsPrefix, filePath, dir],
      environment: {
        PYTHONNOUSERSITE: "1",
      },
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const { exitCode, stdout, stderr } = await waitForSubprocessResult(proc, {
      signal,
    });
    if (exitCode !== 0) {
      throw new Error(
        `PDF material helper failed (${exitCode}): ${stderr || stdout}`,
      );
    }
    const output = (await geckoIO.readJSON(
      geckoPath.join(dir, "parser-output.json"),
    )) as {
      extractor?: unknown;
      extractorVersion?: unknown;
      pageCount?: unknown;
      warnings?: unknown;
    };
    if (
      output.extractor !== EXTRACTOR_NAME ||
      output.extractorVersion !== EXTRACTOR_VERSION
    ) {
      throw new Error(
        `Unsupported PDF extractor: ${String(output.extractor)} ${String(output.extractorVersion)}`,
      );
    }
    return {
      pageCount: typeof output.pageCount === "number" ? output.pageCount : 0,
      warnings: Array.isArray(output.warnings)
        ? output.warnings.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }

  private async readManifestIfFresh(
    dir: string,
    source: SourceIdentity,
  ): Promise<MaterialManifest | null> {
    const path = this.getManifestPath(dir);
    if (!(await geckoIO.exists(path))) {
      return null;
    }
    const manifest = (await geckoIO.readJSON(path)) as MaterialManifest;
    if (
      manifest.schemaVersion !== MATERIAL_SCHEMA_VERSION ||
      manifest.parserVersion !== MATERIAL_PARSER_VERSION ||
      manifest.status !== "ready" ||
      manifest.source.pdfHash !== source.pdfHash ||
      manifest.source.attachmentKey !== source.attachmentKey
    ) {
      return null;
    }
    return manifest;
  }

  private async readMaterial(
    dir: string,
    manifest: MaterialManifest,
  ): Promise<Material> {
    const [markdown, text, pages, blocks, outline, chunks, artifacts] =
      await Promise.all([
        geckoIO.readUTF8(geckoPath.join(dir, "paper.md")),
        geckoIO.readUTF8(geckoPath.join(dir, "paper.txt")),
        this.readPages(dir),
        this.readJSONL<unknown>(geckoPath.join(dir, "blocks.jsonl")).then(
          (items) => items.map(parseMaterialBlock),
        ),
        geckoIO
          .readJSON(geckoPath.join(dir, "outline.json"))
          .then(parseMaterialOutline),
        this.readJSONL<MaterialChunk>(geckoPath.join(dir, "chunks.jsonl")),
        geckoIO.readJSON(geckoPath.join(dir, "artifacts.json")) as Promise<
          MaterialArtifact[]
        >,
      ]);
    return {
      dir,
      manifest,
      markdown,
      text,
      pages,
      blocks,
      outline,
      chunks,
      artifacts,
    };
  }

  private async readPages(dir: string): Promise<MaterialPage[]> {
    return this.readJSONL<MaterialPage>(geckoPath.join(dir, "pages.jsonl"));
  }

  private async readJSONL<T>(path: string): Promise<T[]> {
    const text = await geckoIO.readUTF8(path);
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }

  private async writeJSON(path: string, value: unknown): Promise<void> {
    await geckoIO.writeUTF8(path, JSON.stringify(value, null, 2), {
      flush: true,
    });
  }

  private async writeJSONL(path: string, values: unknown[]): Promise<void> {
    await geckoIO.writeUTF8(
      path,
      `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
      { flush: true },
    );
  }

  private getSubprocess(): SubprocessModule {
    try {
      return loadSubprocessModule<SubprocessModule>();
    } catch (error) {
      logger.error("failed to load Zotero Subprocess module", error);
      throw error;
    }
  }

  private getSourceDir(sourceId: string): string {
    return geckoPath.join(this.rootDir, encodePathSegment(sourceId));
  }

  private getManifestPath(dir: string): string {
    return geckoPath.join(dir, "manifest.json");
  }
}

function getDefaultMaterialRootDir(): string {
  return geckoPath.join(
    geckoPath.profileDir,
    "zopilot",
    "materials",
    "sources",
  );
}

function sameSourceMetadata(
  left: SourceIdentity,
  right: SourceIdentity,
): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.paperKey === right.paperKey &&
    left.libraryID === right.libraryID &&
    left.attachmentItemID === right.attachmentItemID &&
    left.attachmentKey === right.attachmentKey &&
    left.title === right.title &&
    left.filePath === right.filePath &&
    left.mtime === right.mtime &&
    left.size === right.size &&
    left.pdfHash === right.pdfHash
  );
}
