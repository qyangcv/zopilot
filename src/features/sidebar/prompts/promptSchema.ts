export { validatePromptInput };

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
  return { title, body };
}
