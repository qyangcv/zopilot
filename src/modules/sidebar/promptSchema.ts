export { extractPromptVariables, validatePromptInput };

type PromptInput = {
  title: string;
  body: string;
};

function validatePromptInput(input: PromptInput): PromptInput {
  const title = input.title.replace(/\s+/g, " ").trim();
  const body = input.body.trim();
  if (!title) {
    throw new Error("Prompt title is required.");
  }
  if (!body) {
    throw new Error("Prompt body is required.");
  }
  const invalidVariable = extractPromptVariableCandidates(body).find(
    (variable) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(variable),
  );
  if (invalidVariable) {
    throw new Error(`Invalid prompt variable: ${invalidVariable}`);
  }
  return { title, body };
}

function extractPromptVariables(body: string): string[] {
  return [...new Set(extractPromptVariableCandidates(body))].filter(
    (variable) => /^[A-Za-z][A-Za-z0-9_]*$/.test(variable),
  );
}

function extractPromptVariableCandidates(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map(
    (match) => match[1] || "",
  );
}
