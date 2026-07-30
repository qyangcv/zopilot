type ZoteroFilePicker = {
  modeOpenMultiple: number;
  returnOK: number;
  files: string[];
  init(parentWindow: Window, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show(): Promise<number>;
};

type GeckoDialogOwnerWindow = Window & {
  openDialog?: (
    url?: string,
    name?: string,
    features?: string,
    ...args: unknown[]
  ) => Window | null;
};

type GeckoSqliteValue = string | number | null;

type GeckoSqliteRow = {
  getResultByName(name: string): unknown;
};

type GeckoSqliteConnection = {
  TRANSACTION_IMMEDIATE: string;
  close(): Promise<void>;
  execute(
    sql: string,
    params?: Record<string, GeckoSqliteValue> | GeckoSqliteValue[] | null,
  ): Promise<GeckoSqliteRow[]>;
  executeCached(
    sql: string,
    params?: Record<string, GeckoSqliteValue> | GeckoSqliteValue[] | null,
  ): Promise<GeckoSqliteRow[]>;
  executeTransaction<Value>(
    operation: (connection: GeckoSqliteConnection) => Promise<Value>,
    type?: string,
  ): Promise<Value>;
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;
};

type GeckoSqliteModule = {
  openConnection(options: {
    path: string;
    sharedMemoryCache?: boolean;
    shrinkMemoryOnConnectionIdleMS?: number;
  }): Promise<GeckoSqliteConnection>;
};

const geckoIO = createGlobalProxy<typeof IOUtils>("IOUtils");
const geckoPath = createGlobalProxy<typeof PathUtils>("PathUtils");

function createGlobalProxy<Value extends object>(name: string): Value {
  return new Proxy({} as Value, {
    get(_target, property) {
      const source = (globalThis as Record<string, unknown>)[name] as
        Record<PropertyKey, unknown> | undefined;
      if (!source) throw new Error(`${name} is unavailable in this realm`);
      const value = source[property];
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}

function loadSubprocessModule<Module>(): Module {
  return (
    ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs") as {
      Subprocess: Module;
    }
  ).Subprocess;
}

function loadSqliteModule(): GeckoSqliteModule {
  const imported = ChromeUtils.importESModule(
    "resource://gre/modules/Sqlite.sys.mjs",
  ) as { Sqlite?: GeckoSqliteModule };
  if (!imported.Sqlite) throw new Error("Gecko SQLite is unavailable");
  return imported.Sqlite;
}

function loadAddonManagerModule<Module>(): Module {
  return ChromeUtils.importESModule(
    "resource://gre/modules/AddonManager.sys.mjs",
  ) as Module;
}

function hasGeckoIO(): boolean {
  return Boolean((globalThis as { IOUtils?: unknown }).IOUtils);
}

function getGeckoComponents(): typeof Components {
  const components = (
    globalThis as typeof globalThis & { Components?: typeof Components }
  ).Components;
  if (!components) throw new Error("Gecko Components is unavailable");
  return components;
}

function copyWithGeckoClipboard(text: string, win?: Window): boolean {
  const components =
    (win as (Window & { Components?: typeof Components }) | undefined)
      ?.Components ||
    (globalThis as typeof globalThis & { Components?: typeof Components })
      .Components;
  if (!components) return false;
  try {
    const classes = components.classes as unknown as Record<
      string,
      { getService(interfaceType: unknown): nsIClipboardHelper }
    >;
    const helper = classes["@mozilla.org/widget/clipboardhelper;1"].getService(
      components.interfaces.nsIClipboardHelper,
    );
    helper.copyString(text);
    return true;
  } catch {
    return false;
  }
}

function createZoteroFilePicker(): ZoteroFilePicker {
  const imported = ChromeUtils.importESModule(
    "chrome://zotero/content/modules/filePicker.mjs",
  ) as { FilePicker?: new () => ZoteroFilePicker };
  if (!imported.FilePicker) throw new Error("Zotero FilePicker is unavailable");
  return new imported.FilePicker();
}

function openGeckoDialogWindow(
  ownerWindow: Window,
  url: string,
  name: string,
  features: string,
): Window | null {
  const owner = ownerWindow as GeckoDialogOwnerWindow;
  if (typeof owner.openDialog !== "function") return null;
  return owner.openDialog(url, name, features);
}

export {
  copyWithGeckoClipboard,
  createZoteroFilePicker,
  geckoIO,
  geckoPath,
  getGeckoComponents,
  hasGeckoIO,
  loadAddonManagerModule,
  loadSqliteModule,
  loadSubprocessModule,
  openGeckoDialogWindow,
};
export type {
  GeckoSqliteConnection,
  GeckoSqliteModule,
  GeckoSqliteRow,
  GeckoSqliteValue,
  ZoteroFilePicker,
};
