import type { ConversationMetadata } from "../../../domain/conversation";
import {
  cloneThread,
  type ProviderBinding,
  type Thread,
  type ThreadTurn,
} from "../../../domain/thread";
import {
  geckoIO,
  loadSqliteModule,
  type GeckoSqliteConnection,
  type GeckoSqliteRow,
} from "../../../platform/gecko";
import { createLogger } from "../../logging/logger";
import {
  parseProviderBinding,
  parseThreadMetadata,
  parseThreadTurn,
} from "./threadCodec";

type LegacyImportStatus = "imported" | "failed";

interface ThreadRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  getThread(id: string): Promise<Thread | null>;
  listWorkspaceThreads(workspaceKey: string): Promise<Thread[]>;
  listRecoverableThreads(): Promise<Thread[]>;
  insertThread(thread: Thread): Promise<void>;
  updateMetadata(metadata: ConversationMetadata): Promise<void>;
  insertTurn(metadata: ConversationMetadata, turn: ThreadTurn): Promise<void>;
  updateTurn(
    metadata: ConversationMetadata,
    turn: ThreadTurn,
    binding?: ProviderBinding,
  ): Promise<void>;
  upsertBinding(binding: ProviderBinding): Promise<void>;
  removeWorkspace(workspaceKey: string): Promise<void>;
  getLegacyImportStatus(key: string): Promise<LegacyImportStatus | undefined>;
  recordLegacyImport(
    key: string,
    status: LegacyImportStatus,
    error?: string,
  ): Promise<void>;
}

const SCHEMA_VERSION = 1;
const logger = createLogger("store.threadRepository");

class SqliteThreadRepository implements ThreadRepository {
  private connection?: GeckoSqliteConnection;
  private opening?: Promise<GeckoSqliteConnection>;

  constructor(private readonly databasePath: string) {}

  async initialize(): Promise<void> {
    await this.getConnection();
  }

  async close(): Promise<void> {
    const connection = this.connection || (await this.opening);
    this.connection = undefined;
    this.opening = undefined;
    await connection?.close();
  }

  async getThread(id: string): Promise<Thread | null> {
    const connection = await this.getConnection();
    const rows = await connection.executeCached(
      "SELECT metadata_json FROM threads WHERE id = :id",
      { id },
    );
    if (!rows.length) return null;
    const metadata = parseJsonRow(
      rows[0]!,
      "metadata_json",
      parseThreadMetadata,
      `thread ${id}`,
    );
    const [turns, bindings] = await Promise.all([
      this.readTurns(connection, id),
      this.readBindings(connection, id),
    ]);
    return { metadata, turns, bindings };
  }

  async listWorkspaceThreads(workspaceKey: string): Promise<Thread[]> {
    const connection = await this.getConnection();
    const rows = await connection.executeCached(
      `SELECT id FROM threads
       WHERE workspace_key = :workspaceKey
       ORDER BY updated_at DESC, id DESC`,
      { workspaceKey },
    );
    const threads = await Promise.all(
      rows.map((row) =>
        this.getThread(readString(row, "id", "workspace thread")),
      ),
    );
    return threads.filter((thread): thread is Thread => Boolean(thread));
  }

  async listRecoverableThreads(): Promise<Thread[]> {
    const connection = await this.getConnection();
    const rows = await connection.execute(
      `SELECT DISTINCT thread_id FROM turns
       WHERE status IN ('pending', 'running')`,
    );
    const threads = await Promise.all(
      rows.map((row) =>
        this.getThread(readString(row, "thread_id", "recoverable thread")),
      ),
    );
    return threads.filter((thread): thread is Thread => Boolean(thread));
  }

  async insertThread(thread: Thread): Promise<void> {
    const connection = await this.getConnection();
    await connection.executeTransaction(async (transaction) => {
      await insertMetadata(transaction, thread.metadata);
      for (const turn of thread.turns) await insertTurn(transaction, turn);
      for (const binding of thread.bindings) {
        await upsertBinding(transaction, binding);
      }
    }, connection.TRANSACTION_IMMEDIATE);
  }

  async updateMetadata(metadata: ConversationMetadata): Promise<void> {
    const connection = await this.getConnection();
    await updateMetadata(connection, metadata);
  }

  async insertTurn(
    metadata: ConversationMetadata,
    turn: ThreadTurn,
  ): Promise<void> {
    const connection = await this.getConnection();
    await connection.executeTransaction(async (transaction) => {
      await insertTurn(transaction, turn);
      await updateMetadata(transaction, metadata);
    }, connection.TRANSACTION_IMMEDIATE);
  }

  async updateTurn(
    metadata: ConversationMetadata,
    turn: ThreadTurn,
    binding?: ProviderBinding,
  ): Promise<void> {
    const connection = await this.getConnection();
    await connection.executeTransaction(async (transaction) => {
      await transaction.executeCached(
        `UPDATE turns
         SET status = :status, completed_at = :completedAt,
             turn_json = :turnJson
         WHERE id = :id AND thread_id = :threadId`,
        {
          id: turn.id,
          threadId: turn.threadId,
          status: turn.status,
          completedAt: turn.completedAt || null,
          turnJson: JSON.stringify(turn),
        },
      );
      await updateMetadata(transaction, metadata);
      if (binding) await upsertBinding(transaction, binding);
    }, connection.TRANSACTION_IMMEDIATE);
  }

  async upsertBinding(binding: ProviderBinding): Promise<void> {
    await upsertBinding(await this.getConnection(), binding);
  }

  async removeWorkspace(workspaceKey: string): Promise<void> {
    const connection = await this.getConnection();
    await connection.executeCached(
      "DELETE FROM threads WHERE workspace_key = :workspaceKey",
      { workspaceKey },
    );
  }

  async getLegacyImportStatus(
    key: string,
  ): Promise<LegacyImportStatus | undefined> {
    const rows = await (
      await this.getConnection()
    ).executeCached(
      "SELECT status FROM legacy_imports WHERE legacy_key = :key",
      { key },
    );
    if (!rows.length) return undefined;
    const status = readString(rows[0]!, "status", "legacy import");
    return status === "imported" || status === "failed" ? status : undefined;
  }

  async recordLegacyImport(
    key: string,
    status: LegacyImportStatus,
    error?: string,
  ): Promise<void> {
    await (
      await this.getConnection()
    ).executeCached(
      `INSERT INTO legacy_imports
         (legacy_key, status, error, imported_at)
       VALUES (:key, :status, :error, :importedAt)
       ON CONFLICT(legacy_key) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         imported_at = excluded.imported_at`,
      {
        key,
        status,
        error: error || null,
        importedAt: new Date().toISOString(),
      },
    );
  }

  private async readTurns(
    connection: GeckoSqliteConnection,
    threadId: string,
  ): Promise<ThreadTurn[]> {
    const rows = await connection.executeCached(
      `SELECT turn_json FROM turns
       WHERE thread_id = :threadId
       ORDER BY sequence ASC`,
      { threadId },
    );
    return rows.map((row) =>
      parseJsonRow(row, "turn_json", parseThreadTurn, `thread ${threadId}`),
    );
  }

  private async readBindings(
    connection: GeckoSqliteConnection,
    threadId: string,
  ): Promise<ProviderBinding[]> {
    const rows = await connection.executeCached(
      `SELECT binding_json FROM provider_bindings
       WHERE thread_id = :threadId
       ORDER BY adapter_key`,
      { threadId },
    );
    return rows.map((row) =>
      parseJsonRow(
        row,
        "binding_json",
        parseProviderBinding,
        `thread ${threadId}`,
      ),
    );
  }

  private async getConnection(): Promise<GeckoSqliteConnection> {
    if (this.connection) return this.connection;
    this.opening ??= this.open();
    try {
      this.connection = await this.opening;
      return this.connection;
    } finally {
      this.opening = undefined;
    }
  }

  private async open(): Promise<GeckoSqliteConnection> {
    const separator = Math.max(
      this.databasePath.lastIndexOf("/"),
      this.databasePath.lastIndexOf("\\"),
    );
    if (separator > 0) {
      await geckoIO.makeDirectory(this.databasePath.slice(0, separator), {
        createAncestors: true,
        ignoreExisting: true,
      });
    }
    const connection = await loadSqliteModule().openConnection({
      path: this.databasePath,
      sharedMemoryCache: true,
      shrinkMemoryOnConnectionIdleMS: 30000,
    });
    try {
      await connection.execute("PRAGMA foreign_keys = ON");
      await connection.execute("PRAGMA journal_mode = WAL");
      await connection.execute("PRAGMA busy_timeout = 5000");
      const version = await connection.getSchemaVersion();
      if (version > SCHEMA_VERSION) {
        throw new Error(
          `Zopilot thread database schema ${version} is newer than supported ${SCHEMA_VERSION}.`,
        );
      }
      if (version < 1) await createSchema(connection);
      return connection;
    } catch (error) {
      await connection.close().catch(() => undefined);
      logger.error("failed to initialize thread database", error, {
        path: this.databasePath,
      });
      throw error;
    }
  }
}

type MemoryState = {
  threads: Map<string, Thread>;
  legacyImports: Map<string, LegacyImportStatus>;
};

class MemoryThreadRepository implements ThreadRepository {
  readonly state: MemoryState;

  constructor(state?: MemoryState) {
    this.state = state || {
      threads: new Map(),
      legacyImports: new Map(),
    };
  }

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}

  async getThread(id: string): Promise<Thread | null> {
    const thread = this.state.threads.get(id);
    return thread ? cloneThread(thread) : null;
  }

  async listWorkspaceThreads(workspaceKey: string): Promise<Thread[]> {
    return [...this.state.threads.values()]
      .filter((thread) => thread.metadata.workspaceKey === workspaceKey)
      .sort(
        (left, right) =>
          right.metadata.updatedAt.localeCompare(left.metadata.updatedAt) ||
          right.metadata.id.localeCompare(left.metadata.id),
      )
      .map(cloneThread);
  }

  async listRecoverableThreads(): Promise<Thread[]> {
    return [...this.state.threads.values()]
      .filter((thread) =>
        thread.turns.some(
          (turn) => turn.status === "pending" || turn.status === "running",
        ),
      )
      .map(cloneThread);
  }

  async insertThread(thread: Thread): Promise<void> {
    if (this.state.threads.has(thread.metadata.id)) {
      throw new Error(`Thread already exists: ${thread.metadata.id}`);
    }
    this.state.threads.set(thread.metadata.id, cloneThread(thread));
  }

  async updateMetadata(metadata: ConversationMetadata): Promise<void> {
    const thread = this.requireThread(metadata.id);
    thread.metadata = cloneThread(metadata);
  }

  async insertTurn(
    metadata: ConversationMetadata,
    turn: ThreadTurn,
  ): Promise<void> {
    const thread = this.requireThread(metadata.id);
    thread.turns.push(cloneThread(turn));
    thread.metadata = cloneThread(metadata);
  }

  async updateTurn(
    metadata: ConversationMetadata,
    turn: ThreadTurn,
    binding?: ProviderBinding,
  ): Promise<void> {
    const thread = this.requireThread(metadata.id);
    const index = thread.turns.findIndex((item) => item.id === turn.id);
    if (index < 0) throw new Error(`Thread turn is missing: ${turn.id}`);
    thread.turns[index] = cloneThread(turn);
    thread.metadata = cloneThread(metadata);
    if (binding) replaceBinding(thread, binding);
  }

  async upsertBinding(binding: ProviderBinding): Promise<void> {
    replaceBinding(this.requireThread(binding.threadId), binding);
  }

  async removeWorkspace(workspaceKey: string): Promise<void> {
    for (const [id, thread] of this.state.threads) {
      if (thread.metadata.workspaceKey === workspaceKey) {
        this.state.threads.delete(id);
      }
    }
  }

  async getLegacyImportStatus(
    key: string,
  ): Promise<LegacyImportStatus | undefined> {
    return this.state.legacyImports.get(key);
  }

  async recordLegacyImport(
    key: string,
    status: LegacyImportStatus,
  ): Promise<void> {
    this.state.legacyImports.set(key, status);
  }

  private requireThread(id: string): Thread {
    const thread = this.state.threads.get(id);
    if (!thread) throw new Error(`Thread is missing: ${id}`);
    return thread;
  }
}

async function createSchema(connection: GeckoSqliteConnection): Promise<void> {
  await connection.executeTransaction(async (transaction) => {
    await transaction.execute(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        workspace_key TEXT NOT NULL,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL,
        metadata_json TEXT NOT NULL
      )`);
    await transaction.execute(`
      CREATE INDEX threads_workspace_updated
      ON threads(workspace_key, archived, updated_at DESC)`);
    await transaction.execute(`
      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        turn_json TEXT NOT NULL,
        UNIQUE(thread_id, sequence)
      )`);
    await transaction.execute(`
      CREATE INDEX turns_thread_sequence
      ON turns(thread_id, sequence)`);
    await transaction.execute(`
      CREATE TABLE provider_bindings (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        adapter_key TEXT NOT NULL,
        external_thread_id TEXT NOT NULL,
        synced_sequence INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        PRIMARY KEY(thread_id, adapter_key)
      )`);
    await transaction.execute(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )`);
    await transaction.execute(`
      CREATE TABLE legacy_imports (
        legacy_key TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        error TEXT,
        imported_at TEXT NOT NULL
      )`);
    await transaction.executeCached(
      `INSERT INTO schema_migrations(version, applied_at)
       VALUES (:version, :appliedAt)`,
      { version: SCHEMA_VERSION, appliedAt: new Date().toISOString() },
    );
    await transaction.setSchemaVersion(SCHEMA_VERSION);
  }, connection.TRANSACTION_IMMEDIATE);
}

async function insertMetadata(
  connection: GeckoSqliteConnection,
  metadata: ConversationMetadata,
): Promise<void> {
  await connection.executeCached(
    `INSERT INTO threads
       (id, workspace_key, label, created_at, updated_at, archived,
        revision, metadata_json)
     VALUES
       (:id, :workspaceKey, :label, :createdAt, :updatedAt, :archived,
        :revision, :metadataJson)`,
    {
      ...mutableMetadataParams(metadata),
      createdAt: metadata.createdAt,
    },
  );
}

async function updateMetadata(
  connection: GeckoSqliteConnection,
  metadata: ConversationMetadata,
): Promise<void> {
  await connection.executeCached(
    `UPDATE threads SET
       workspace_key = :workspaceKey,
       label = :label,
       updated_at = :updatedAt,
       archived = :archived,
       revision = :revision,
       metadata_json = :metadataJson
     WHERE id = :id`,
    mutableMetadataParams(metadata),
  );
}

function mutableMetadataParams(metadata: ConversationMetadata) {
  return {
    id: metadata.id,
    workspaceKey: metadata.workspaceKey,
    label: metadata.label,
    updatedAt: metadata.updatedAt,
    archived: metadata.archived ? 1 : 0,
    revision: metadata.revision,
    metadataJson: JSON.stringify(metadata),
  };
}

async function insertTurn(
  connection: GeckoSqliteConnection,
  turn: ThreadTurn,
): Promise<void> {
  await connection.executeCached(
    `INSERT INTO turns
       (id, thread_id, sequence, status, created_at, completed_at, turn_json)
     VALUES
       (:id, :threadId, :sequence, :status, :createdAt, :completedAt,
        :turnJson)`,
    {
      id: turn.id,
      threadId: turn.threadId,
      sequence: turn.sequence,
      status: turn.status,
      createdAt: turn.createdAt,
      completedAt: turn.completedAt || null,
      turnJson: JSON.stringify(turn),
    },
  );
}

async function upsertBinding(
  connection: GeckoSqliteConnection,
  binding: ProviderBinding,
): Promise<void> {
  await connection.executeCached(
    `INSERT INTO provider_bindings
       (thread_id, adapter_key, external_thread_id, synced_sequence,
        state, updated_at, binding_json)
     VALUES
       (:threadId, :adapterKey, :externalThreadId, :syncedSequence,
        :state, :updatedAt, :bindingJson)
     ON CONFLICT(thread_id, adapter_key) DO UPDATE SET
       external_thread_id = excluded.external_thread_id,
       synced_sequence = excluded.synced_sequence,
       state = excluded.state,
       updated_at = excluded.updated_at,
       binding_json = excluded.binding_json`,
    {
      threadId: binding.threadId,
      adapterKey: binding.adapterKey,
      externalThreadId: binding.externalThreadId,
      syncedSequence: binding.syncedThroughSequence,
      state: binding.state,
      updatedAt: binding.updatedAt,
      bindingJson: JSON.stringify(binding),
    },
  );
}

function replaceBinding(thread: Thread, binding: ProviderBinding): void {
  const index = thread.bindings.findIndex(
    (item) => item.adapterKey === binding.adapterKey,
  );
  if (index < 0) thread.bindings.push(cloneThread(binding));
  else thread.bindings[index] = cloneThread(binding);
}

function parseJsonRow<Value>(
  row: GeckoSqliteRow,
  column: string,
  parse: (value: unknown, source: string) => Value,
  source: string,
): Value {
  const text = readString(row, column, source);
  try {
    return parse(JSON.parse(text) as unknown, source);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${source}: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

function readString(
  row: GeckoSqliteRow,
  column: string,
  source: string,
): string {
  const value = row.getResultByName(column);
  if (typeof value !== "string") {
    throw new Error(`Invalid ${column} in ${source}.`);
  }
  return value;
}

export {
  MemoryThreadRepository,
  SqliteThreadRepository,
  type LegacyImportStatus,
  type MemoryState,
  type ThreadRepository,
};
