type ZoteroFilePicker = {
  modeOpenMultiple: number;
  returnOK: number;
  files: string[];
  init(parentWindow: Window, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show(): Promise<number>;
};

const geckoIO = createGlobalProxy<typeof IOUtils>("IOUtils");
const geckoPath = createGlobalProxy<typeof PathUtils>("PathUtils");

function createGlobalProxy<Value extends object>(name: string): Value {
  return new Proxy({} as Value, {
    get(_target, property) {
      const source = (globalThis as Record<string, unknown>)[name] as
        | Record<PropertyKey, unknown>
        | undefined;
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

export {
  copyWithGeckoClipboard,
  createZoteroFilePicker,
  geckoIO,
  geckoPath,
  getGeckoComponents,
  hasGeckoIO,
  loadSubprocessModule,
};
export type { ZoteroFilePicker };
