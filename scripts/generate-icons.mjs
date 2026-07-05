#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const iconDir = join(rootDir, "assets", "app-icon");
const previewDir = join(iconDir, "preview");
const addonIconDir = join(rootDir, "addon", "content", "icons");
const sourceSvg = join(iconDir, "zopilot-icon.svg");

const pngSizes = [16, 32, 48, 64, 96, 128, 256, 512, 1024];
const icnsSizes = [16, 32, 64, 128, 256, 512, 1024];

async function run(command, args) {
  try {
    await execFile(command, args);
  } catch (error) {
    const detail = error.stderr || error.message;
    throw new Error(`${command} ${args.join(" ")} failed:\n${detail}`);
  }
}

async function ensureTool(command) {
  try {
    await execFile("sh", ["-lc", `command -v ${command}`]);
  } catch {
    throw new Error(`Missing required icon generation tool: ${command}`);
  }
}

function pngPath(size) {
  return join(iconDir, `zopilot-icon-${size}.png`);
}

async function renderPng(size, outputPath = pngPath(size)) {
  await run("rsvg-convert", [
    "--width",
    String(size),
    "--height",
    String(size),
    "--keep-aspect-ratio",
    "--format",
    "png",
    "--output",
    outputPath,
    sourceSvg,
  ]);
}

async function generatePngs() {
  await Promise.all(pngSizes.map((size) => renderPng(size)));
}

async function generateIco() {
  const icoInputs = [16, 32, 48, 64, 128, 256].map(pngPath);
  await run("magick", [...icoInputs, join(iconDir, "favicon.ico")]);
  await copyFile(join(iconDir, "favicon.ico"), join(iconDir, "app.ico"));
}

async function generateIcns() {
  const iconsetDir = join(iconDir, "app.iconset");
  await rm(iconsetDir, { force: true, recursive: true });
  await mkdir(iconsetDir, { recursive: true });

  for (const size of icnsSizes) {
    await renderPng(size, join(iconsetDir, `icon_${size}x${size}.png`));
    if (size < 1024) {
      await renderPng(
        size * 2,
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      );
    }
  }

  await run("iconutil", [
    "--convert",
    "icns",
    "--output",
    join(iconDir, "app.icns"),
    iconsetDir,
  ]);
  await rm(iconsetDir, { force: true, recursive: true });
}

async function syncAddonIcons() {
  await mkdir(addonIconDir, { recursive: true });
  await copyFile(pngPath(48), join(addonIconDir, "zopilot-icon-48.png"));
  await copyFile(pngPath(96), join(addonIconDir, "zopilot-icon-96.png"));
}

async function generateContactSheet() {
  await mkdir(previewDir, { recursive: true });
  const tileDir = join(previewDir, ".contact-sheet-tiles");
  await rm(tileDir, { force: true, recursive: true });
  await mkdir(tileDir, { recursive: true });

  const tilePaths = [];
  for (const size of pngSizes) {
    const tilePath = join(tileDir, `tile-${size}.png`);
    tilePaths.push(tilePath);
    await run("magick", [
      "-background",
      "#ffffff",
      "-gravity",
      "center",
      pngPath(size),
      "-resize",
      "120x120>",
      "-extent",
      "132x132",
      "-background",
      "#ffffff",
      "-fill",
      "#233041",
      "-font",
      "Helvetica",
      "-pointsize",
      "18",
      `label:${size}px`,
      "-append",
      tilePath,
    ]);
  }

  await run("magick", [
    "montage",
    ...tilePaths,
    "-background",
    "#ffffff",
    "-tile",
    "3x3",
    "-geometry",
    "176x176+18+18",
    join(previewDir, "contact-sheet.png"),
  ]);
  await rm(tileDir, { force: true, recursive: true });
}

async function main() {
  await ensureTool("rsvg-convert");
  await ensureTool("magick");
  await ensureTool("iconutil");
  await mkdir(iconDir, { recursive: true });
  await generatePngs();
  await generateIco();
  await generateIcns();
  await syncAddonIcons();
  await generateContactSheet();
  console.log(`Generated app icons in ${iconDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
