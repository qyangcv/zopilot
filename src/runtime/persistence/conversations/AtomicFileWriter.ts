import { createLogger } from "../../logging/logger";
import { createTimestampId } from "../../ids/timestampId";

const logger = createLogger("store.atomicFileWriter");

class AtomicFileWriter {
  async writeJSON(path: string, value: unknown): Promise<void> {
    await this.writeUTF8(path, JSON.stringify(value, null, 2));
  }

  async writeUTF8(path: string, text: string): Promise<void> {
    const tmpPath = `${path}.${createTemporaryId()}`;
    try {
      await IOUtils.writeUTF8(tmpPath, text, { flush: true });
    } catch (error) {
      logger.error("failed to write conversation temp file", error, {
        path,
        tmpPath,
      });
      throw error;
    }
    try {
      await IOUtils.move(tmpPath, path);
    } catch (firstMoveError) {
      logger.warn("conversation atomic move fallback", {
        path,
        tmpPath,
        error: String(firstMoveError),
      });
      try {
        await IOUtils.remove(path, { ignoreAbsent: true });
        await IOUtils.move(tmpPath, path);
      } catch (error) {
        logger.error("failed to move conversation temp file", error, {
          path,
          tmpPath,
        });
        throw error;
      }
    }
  }
}

function createTemporaryId(): string {
  return createTimestampId("tmp");
}

export { AtomicFileWriter };
