function formatEffortLabel(effort: string): string {
  return effort.replace(/(^|[-_ ])\w/g, (match) => match.toUpperCase());
}

function formatModelEffortLabel(model: string, effort?: string): string {
  const normalizedEffort = effort?.trim();
  return normalizedEffort
    ? `${model} · ${formatEffortLabel(normalizedEffort)}`
    : model;
}

export { formatEffortLabel, formatModelEffortLabel };
