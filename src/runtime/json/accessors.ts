import { isRecord } from "./guards";

function getNestedValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function getNestedString(
  value: unknown,
  path: readonly string[],
): string | undefined {
  const current = getNestedValue(value, path);
  return typeof current === "string" ? current : undefined;
}

function getNestedBoolean(
  value: unknown,
  path: readonly string[],
): boolean | undefined {
  const current = getNestedValue(value, path);
  return typeof current === "boolean" ? current : undefined;
}

export { getNestedBoolean, getNestedString, getNestedValue };
