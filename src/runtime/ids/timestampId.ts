type TimestampIdOptions = {
  separator?: string;
  randomLength?: number;
};

function createTimestampId(
  prefix: string,
  options: TimestampIdOptions = {},
): string {
  const separator = options.separator ?? "-";
  const randomLength = options.randomLength ?? 8;
  const timestamp = Date.now().toString(36);
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + randomLength);
  return [prefix, timestamp, random].join(separator);
}

export { createTimestampId };
export type { TimestampIdOptions };
