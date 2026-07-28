import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const requirementsPath = path.join(
  rootDir,
  "helpers",
  "pdf-helper",
  "requirements.txt",
);
const runtimeDir = path.join(rootDir, ".scaffold", "pdf-helper-development");
const venvDir = path.join(runtimeDir, "venv");
const markerPath = path.join(runtimeDir, "requirements.sha256");
const venvPython =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
const requirementsHash = createHash("sha256")
  .update(readFileSync(requirementsPath))
  .digest("hex");

if (
  existsSync(venvPython) &&
  existsSync(markerPath) &&
  readFileSync(markerPath, "utf8").trim() === requirementsHash
) {
  process.exit(0);
}

mkdirSync(runtimeDir, { recursive: true });
rmSync(venvDir, { recursive: true, force: true });

const bootstrap = findPython();
run(bootstrap.command, [...bootstrap.arguments, "-m", "venv", venvDir]);
run(venvPython, [
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "--requirement",
  requirementsPath,
]);
writeFileSync(markerPath, `${requirementsHash}\n`, "utf8");

function findPython() {
  const configured = process.env.ZOPILOT_PDF_HELPER_DEV_PYTHON?.trim();
  const candidates = configured
    ? [{ command: configured, arguments: [] }]
    : process.platform === "win32"
      ? [
          { command: "py", arguments: ["-3"] },
          { command: "python", arguments: [] },
        ]
      : [
          { command: "python3", arguments: [] },
          { command: "python", arguments: [] },
        ];
  for (const candidate of candidates) {
    const result = spawnSync(
      candidate.command,
      [...candidate.arguments, "--version"],
      { stdio: "ignore" },
    );
    if (result.status === 0) return candidate;
  }
  throw new Error(
    "Python 3 is required for the development PDF helper. " +
      "Set ZOPILOT_PDF_HELPER_DEV_PYTHON to its executable path.",
  );
}

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
}
