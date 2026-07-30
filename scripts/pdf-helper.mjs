import { spawnSync } from "node:child_process";
import console from "node:console";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const helperPackagePath = "helpers/pdf-helper/package.json";
const pythonScriptPath = "scripts/pdf_helper.py";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "build":
      runPython([pythonScriptPath, "build", ...args]);
      return;
    case "release":
      await releaseHelper(args);
      return;
    case "test":
      runTests();
      return;
    case "version":
      runPython([pythonScriptPath, "version"]);
      return;
    case "verify-tag":
      runPython([pythonScriptPath, "verify-tag", ...args]);
      return;
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown PDF helper command: ${command}`);
  }
}

async function releaseHelper(args) {
  const options = parseReleaseOptions(args);
  if (options.help) {
    printReleaseHelp();
    return;
  }
  if (isCiEnvironment()) {
    publishRelease();
    return;
  }

  const { versionBump } = await import("bumpp");
  const startedAt = Date.now();
  const result = await versionBump({
    release: options.version ?? "prompt",
    preid: options.preid,
    confirm: !options.yes,
    files: [helperPackagePath],
    commit: "chore(pdf-helper): release v%s",
    tag: "pdf-helper-v%s",
    push: true,
    cwd: rootDir,
    execute: () => runTests(),
    progress: reportReleaseProgress,
  });

  console.log(
    `PDF helper ${result.newVersion} released in ${(
      (Date.now() - startedAt) /
      1_000
    ).toFixed(1)}s.`,
  );
  console.log(
    "GitHub Actions: https://github.com/qyangcv/zopilot/actions/workflows/pdf-helper.yml",
  );
}

function publishRelease() {
  const packageMetadata = JSON.parse(
    readFileSync(path.join(rootDir, helperPackagePath), "utf8"),
  );
  const version = packageMetadata.version;
  if (typeof version !== "string" || !version) {
    throw new Error("Invalid PDF helper package version");
  }

  const tag = process.env.GITHUB_REF_NAME;
  if (!tag) {
    throw new Error("GITHUB_REF_NAME is required to publish a PDF helper");
  }
  runPython([pythonScriptPath, "verify-tag", tag]);

  const releaseDir = path.resolve(
    rootDir,
    process.env.ZOPILOT_PDF_HELPER_RELEASE_DIR ?? "dist/pdf-helper",
  );
  const manifestPath = path.join(releaseDir, "pdf-helper-manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing PDF helper manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.schemaVersion !== 2 ||
    manifest.version !== version ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 3
  ) {
    throw new Error(`Invalid PDF helper manifest: ${manifestPath}`);
  }

  const assetNames = new Set();
  const assets = manifest.artifacts.map((artifact) => {
    if (
      typeof artifact !== "object" ||
      artifact === null ||
      typeof artifact.fileName !== "string" ||
      path.basename(artifact.fileName) !== artifact.fileName ||
      assetNames.has(artifact.fileName)
    ) {
      throw new Error(`Invalid PDF helper manifest: ${manifestPath}`);
    }
    assetNames.add(artifact.fileName);
    const assetPath = path.join(releaseDir, artifact.fileName);
    if (!existsSync(assetPath)) {
      throw new Error(`Missing PDF helper release asset: ${assetPath}`);
    }
    return assetPath;
  });
  assets.push(manifestPath);

  if (commandSucceeds("gh", ["release", "view", tag])) {
    runCommand("gh", ["release", "upload", tag, ...assets, "--clobber"]);
    console.log(`Updated GitHub release ${tag}`);
    return;
  }

  const releaseArgs = [
    "release",
    "create",
    tag,
    "--verify-tag",
    "--latest=false",
    "--title",
    `PDF Helper v${version}`,
    "--notes",
    `Zopilot PDF Helper ${version}`,
  ];
  if (version.includes("-")) {
    releaseArgs.push("--prerelease");
  }
  runCommand("gh", [...releaseArgs, ...assets]);
  console.log(`Created GitHub release ${tag}`);
}

function isCiEnvironment() {
  if (process.env.GITHUB_ACTIONS === "true") {
    return true;
  }
  return ["1", "true"].includes(process.env.CI?.toLowerCase());
}

function parseReleaseOptions(args) {
  const options = {
    version: undefined,
    preid: "beta",
    yes: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "-y" || value === "--yes") {
      options.yes = true;
      continue;
    }
    if (value === "-h" || value === "--help") {
      options.help = true;
      continue;
    }
    if (value === "--preid") {
      const preid = args[index + 1];
      if (!preid || preid.startsWith("-")) {
        throw new Error("--preid requires a value");
      }
      options.preid = preid;
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      throw new Error(`Unknown release option: ${value}`);
    }
    if (options.version) {
      throw new Error("Only one PDF helper version may be specified");
    }
    options.version = value;
  }

  return options;
}

function reportReleaseProgress(progress) {
  switch (progress.event) {
    case "file updated":
      console.log(
        `Updated ${progress.updatedFiles.at(-1)} to ${progress.newVersion}`,
      );
      break;
    case "file skipped":
      console.log(`Skipped ${progress.skippedFiles.at(-1)}`);
      break;
    case "git commit":
      console.log("Git commit created");
      break;
    case "git tag":
      console.log(`Git tag created: ${progress.tag}`);
      break;
    case "git push":
      console.log("Git commit and tag pushed");
      break;
    case "npm script":
      console.log(`Ran npm ${progress.script}`);
      break;
  }
}

function runTests() {
  runPython(["-m", "unittest", "discover", "-s", "test/pdf-helper"]);
  runCommand(process.execPath, [
    "--import",
    "./test/register-ts-loader.mjs",
    "./node_modules/mocha/bin/mocha",
    "test/unit/document/pdfHelper.test.ts",
  ]);
}

function runPython(args) {
  const configured = process.env.ZOPILOT_PDF_HELPER_BUILD_PYTHON?.trim();
  const python =
    configured || (process.platform === "win32" ? "python" : "python3");
  runCommand(python, ["-B", ...args]);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function commandSucceeds(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "ignore",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status === 0;
}

function printHelp() {
  console.log(`Usage: node scripts/pdf-helper.mjs <command>

Commands:
  build [--platform <platform>]  Build the current host helper
  release [version] [options]    Bump, commit, tag, and push a release
  test                           Run PDF helper tests
  version                        Print the configured helper version
  verify-tag <tag>               Verify a release tag`);
}

function printReleaseHelp() {
  console.log(`Usage: npm run release:pdf-helper -- [version] [options]

Version:
  major, minor, patch, pre*, or an explicit semantic version

Options:
  --preid <preid>  Prerelease identifier (default: beta)
  -y, --yes        Skip confirmation
  -h, --help       Show this help`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
