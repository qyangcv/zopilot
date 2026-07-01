import { buildChunksAndArtifacts } from "./chunker";
import type {
  Material,
  MaterialArtifact,
  MaterialChunk,
  MaterialManifest,
  MaterialPage,
  SourceIdentity,
} from "./types";
import { createLogger } from "../utils/logger";

export { MaterialCache, MATERIAL_SCHEMA_VERSION, MATERIAL_PARSER_VERSION };

const MATERIAL_SCHEMA_VERSION = 1;
const MATERIAL_PARSER_VERSION = "pymupdf4llm-light-3";
const PARSER_SCRIPT = String.raw`
import json
import os
import sys

pdf_path, out_dir = sys.argv[1], sys.argv[2]
assets_dir = os.path.join(out_dir, "assets")
os.makedirs(assets_dir, exist_ok=True)

warnings = []
markdown = ""

try:
    import pymupdf4llm
    markdown = pymupdf4llm.to_markdown(pdf_path, page_chunks=False)
except Exception as exc:
    warnings.append("Markdown extraction failed; page text extraction was used.")

try:
    import fitz
except Exception as exc:
    raise SystemExit("PyMuPDF import failed: " + repr(exc))

doc = fitz.open(pdf_path)
pages = []
texts = []
for index, page in enumerate(doc, start=1):
    text = page.get_text("text") or ""
    texts.append(text)
    image_path = os.path.join(assets_dir, "page-%04d.png" % index)
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        pix.save(image_path)
    except Exception as exc:
        image_path = None
        warnings.append("Page render failed for page %d: %r" % (index, exc))
    pages.append({"page": index, "text": text, "imagePath": image_path})

if not markdown.strip():
    markdown = "\n\n".join("# Page %d\n\n%s" % (page["page"], page["text"]) for page in pages)

with open(os.path.join(out_dir, "paper.md"), "w", encoding="utf-8") as fh:
    fh.write(markdown)
with open(os.path.join(out_dir, "paper.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n\n".join(texts))
with open(os.path.join(out_dir, "pages.jsonl"), "w", encoding="utf-8") as fh:
    for page in pages:
        fh.write(json.dumps(page, ensure_ascii=False) + "\n")
with open(os.path.join(out_dir, "parser-output.json"), "w", encoding="utf-8") as fh:
    json.dump({"pageCount": len(doc), "warnings": warnings}, fh, ensure_ascii=False, indent=2)
`;

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
        parser: "PyMuPDF4LLM/PyMuPDF",
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
      parser: "PyMuPDF4LLM/PyMuPDF",
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
    const python = await resolvePythonCommand();
    const proc = await subprocess.call({
      command: python,
      arguments: ["-c", PARSER_SCRIPT, filePath, dir],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, wait] = await Promise.all([
      proc.stdout?.readString().catch(() => "") || "",
      proc.stderr?.readString().catch(() => "") || "",
      proc.wait(),
    ]);
    if (wait.exitCode !== 0) {
      throw new Error(
        `PDF material parser failed (${wait.exitCode}): ${stderr || stdout}`,
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

async function resolvePythonCommand(): Promise<string> {
  for (const command of [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
  ]) {
    try {
      if (await IOUtils.exists(command)) {
        return command;
      }
    } catch {
      // Keep probing known Python locations.
    }
  }
  return "python3";
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
