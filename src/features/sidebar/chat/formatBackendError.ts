import { getString } from "../../../app/localization";

function formatBackendError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [getString("sidebar-backend-error"), "", "```", message, "```"].join(
    "\n",
  );
}

export { formatBackendError };
