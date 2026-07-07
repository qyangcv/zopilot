import { spawnSync } from "node:child_process";
import process from "node:process";

const python = process.platform === "win32" ? "python" : "python3";
const result = spawnSync(python, ["scripts/build-pdf-helper-current.py"], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
