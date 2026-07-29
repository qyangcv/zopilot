import { geckoPath } from "../../../platform/gecko";

function getDefaultThreadRootDir(): string {
  return geckoPath.join(geckoPath.profileDir, "zopilot", "conversations");
}

function getThreadDatabasePath(rootDir: string): string {
  return geckoPath.join(rootDir, "threads.sqlite");
}

export { getDefaultThreadRootDir, getThreadDatabasePath };
