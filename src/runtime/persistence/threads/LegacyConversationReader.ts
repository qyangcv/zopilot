import { geckoIO, geckoPath } from "../../../platform/gecko";
import { createLogger } from "../../logging/logger";
import {
  parseConversationMessage,
  parseConversationMetadata,
} from "./LegacyConversationCodec";
import type {
  LegacyConversation,
  LegacyConversationMetadata,
} from "./legacyTypes";

type LegacyConversationReadResult =
  | {
      key: string;
      status: "ready";
      conversation: LegacyConversation;
    }
  | {
      key: string;
      status: "failed";
      error: Error;
    };

const logger = createLogger("store.legacyConversationReader");

class LegacyConversationReader {
  constructor(private readonly rootDir: string) {}

  async readAll(): Promise<LegacyConversationReadResult[]> {
    const results: LegacyConversationReadResult[] = [];
    for (const directoryName of ["workspaces", "papers"]) {
      const directory = geckoPath.join(this.rootDir, directoryName);
      if (!(await geckoIO.exists(directory))) continue;
      const workspaceDirs = await geckoIO.getChildren(directory);
      for (const workspaceDir of workspaceDirs.filter(
        (path) => !isHiddenPath(path),
      )) {
        let children: string[];
        try {
          children = await geckoIO.getChildren(workspaceDir);
        } catch (error) {
          results.push({
            key: workspaceDir,
            status: "failed",
            error: toError(error),
          });
          continue;
        }
        for (const metadataPath of children.filter(
          (path) => path.endsWith(".json") && !isHiddenPath(path),
        )) {
          results.push(await this.readConversation(metadataPath));
        }
      }
    }
    return results;
  }

  private async readConversation(
    metadataPath: string,
  ): Promise<LegacyConversationReadResult> {
    const key = metadataPath;
    try {
      const metadata = await this.readMetadata(metadataPath);
      const messagesPath = metadataPath.replace(/\.json$/u, ".jsonl");
      const text = await geckoIO.readUTF8(messagesPath).catch((error) => {
        logger.warn("legacy message file is unreadable", {
          metadataPath,
          messagesPath,
          error: String(error),
        });
        return "";
      });
      const messages = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => parseConversationMessage(line, messagesPath));
      return {
        key,
        status: "ready",
        conversation: { metadata, messages },
      };
    } catch (error) {
      return { key, status: "failed", error: toError(error) };
    }
  }

  private async readMetadata(
    path: string,
  ): Promise<LegacyConversationMetadata> {
    const value = (await geckoIO.readJSON(path)) as unknown;
    const metadata = parseConversationMetadata(value);
    if (!metadata) {
      throw new Error(`Invalid Zopilot conversation metadata in ${path}.`);
    }
    return metadata;
  }
}

function isHiddenPath(path: string): boolean {
  return /(?:^|[/\\])\.[^/\\]+$/u.test(path);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export { LegacyConversationReader };
export type { LegacyConversationReadResult };
