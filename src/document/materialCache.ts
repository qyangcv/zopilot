import { buildChunksAndArtifacts } from "./chunker";
import { waitForSubprocessResult } from "../utils/subprocess";
import type {
  Material,
  MaterialArtifact,
  MaterialChunk,
  MaterialManifest,
  MaterialPage,
  SourceIdentity,
} from "./types";
import { ensurePdfHelperExecutable } from "./pdfHelper";
import { createLogger } from "../utils/logger";

export { MaterialCache, MATERIAL_SCHEMA_VERSION, MATERIAL_PARSER_VERSION };

const MATERIAL_SCHEMA_VERSION = 1;
const MATERIAL_PARSER_VERSION = "zopilot-pdf-helper-0.2.0";

const logger = createLogger("document.materialCache");

type ZoteroWithProfile = typeof Zotero & {
  Profile: {
    readonly dir: string;
  };
};

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
};

class MaterialCache {
  constructor(private readonly rootDir = getDefaultMaterialRootDir()) {}

  async getOrBuild(source: SourceIdentity): Promise<Material> {
    const dir = this.getSourceDir(source.sourceId);
    const manifest = await this.readManifestIfFresh(dir, source);
    if (manifest) {
      return this.readMaterial(dir, manifest);
    }
    return this.build(source, dir);
  }

  private async build(source: SourceIdentity, dir: string): Promise<Material> {
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(PathUtils.join(dir, "assets"), {
      createAncestors: true,
      ignoreExisting: true,
    });

    let parserWarnings: string[] = [];
    let pageCount = 0;
    try {
      const result = await this.runParser(source.filePath, dir);
      parserWarnings = result.warnings;
      pageCount = result.pageCount;
    } catch (error) {
      const manifest: MaterialManifest = {
        schemaVersion: MATERIAL_SCHEMA_VERSION,
        parser: "Zopilot PDF Helper/PyMuPDF",
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

    const markdown = await IOUtils.readUTF8(PathUtils.join(dir, "paper.md"));
    const text = await IOUtils.readUTF8(PathUtils.join(dir, "paper.txt"));
    const pages = await this.readPages(dir);
    const { chunks, artifacts } = buildChunksAndArtifacts({
      sourceId: source.sourceId,
      markdown,
      pages,
    });
    await this.writeJSONL(PathUtils.join(dir, "chunks.jsonl"), chunks);
    await this.writeJSON(PathUtils.join(dir, "artifacts.json"), artifacts);

    const manifest: MaterialManifest = {
      schemaVersion: MATERIAL_SCHEMA_VERSION,
      parser: "Zopilot PDF Helper/PyMuPDF",
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
      chunks,
      artifacts,
    };
  }

  private async runParser(
    filePath: string,
    dir: string,
  ): Promise<{ pageCount: number; warnings: string[] }> {
    const subprocess = this.getSubprocess();
    const executable = await ensurePdfHelperExecutable();
    const proc = await subprocess.call({
      command: executable,
      arguments: [filePath, dir],
      environment: {
        PYTHONNOUSERSITE: "1",
      },
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const { exitCode, stdout, stderr } = await waitForSubprocessResult(proc);
    if (exitCode !== 0) {
      throw new Error(
        `PDF material helper failed (${exitCode}): ${stderr || stdout}`,
      );
    }
    const output = (await IOUtils.readJSON(
      PathUtils.join(dir, "parser-output.json"),
    )) as { pageCount?: unknown; warnings?: unknown };
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
    if (!(await IOUtils.exists(path))) {
      return null;
    }
    const manifest = (await IOUtils.readJSON(path)) as MaterialManifest;
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
    const [markdown, text, pages, chunks, artifacts] = await Promise.all([
      IOUtils.readUTF8(PathUtils.join(dir, "paper.md")),
      IOUtils.readUTF8(PathUtils.join(dir, "paper.txt")),
      this.readPages(dir),
      this.readJSONL<MaterialChunk>(PathUtils.join(dir, "chunks.jsonl")),
      IOUtils.readJSON(PathUtils.join(dir, "artifacts.json")) as Promise<
        MaterialArtifact[]
      >,
    ]);
    return {
      dir,
      manifest,
      markdown,
      text,
      pages,
      chunks,
      artifacts,
    };
  }

  private async readPages(dir: string): Promise<MaterialPage[]> {
    return this.readJSONL<MaterialPage>(PathUtils.join(dir, "pages.jsonl"));
  }

  private async readJSONL<T>(path: string): Promise<T[]> {
    const text = await IOUtils.readUTF8(path);
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  }

  private async writeJSON(path: string, value: unknown): Promise<void> {
    await IOUtils.writeUTF8(path, JSON.stringify(value, null, 2), {
      flush: true,
    });
  }

  private async writeJSONL(path: string, values: unknown[]): Promise<void> {
    await IOUtils.writeUTF8(
      path,
      `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
      { flush: true },
    );
  }

  private getSubprocess(): SubprocessModule {
    try {
      const imported = ChromeUtils.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      ) as { Subprocess: SubprocessModule };
      return imported.Subprocess;
    } catch (error) {
      logger.error("failed to load Zotero Subprocess module", error);
      throw error;
    }
  }

  private getSourceDir(sourceId: string): string {
    return PathUtils.join(this.rootDir, encodePathSegment(sourceId));
  }

  private getManifestPath(dir: string): string {
    return PathUtils.join(dir, "manifest.json");
  }
}

function getDefaultMaterialRootDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "materials",
    "sources",
  );
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
