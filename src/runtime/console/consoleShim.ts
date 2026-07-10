const noop = () => undefined;

const fallbackConsole = {
  assert: noop,
  clear: noop,
  count: noop,
  countReset: noop,
  debug: noop,
  dir: noop,
  dirxml: noop,
  error: noop,
  group: noop,
  groupCollapsed: noop,
  groupEnd: noop,
  info: noop,
  log: noop,
  profile: noop,
  profileEnd: noop,
  table: noop,
  time: noop,
  timeEnd: noop,
  timeLog: noop,
  timeStamp: noop,
  trace: noop,
  warn: noop,
};

const root = globalThis as Record<string, unknown>;
root.console ??= fallbackConsole;
