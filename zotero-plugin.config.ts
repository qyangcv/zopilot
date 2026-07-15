import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
    pkg.version.includes("-") ? "update-beta.json" : "update.json"
  }`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/app/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
      {
        entryPoints: ["src/features/sidebar/windowRuntime.tsx"],
        bundle: true,
        format: "iife",
        target: "firefox115",
        outfile: ".scaffold/build/addon/content/scripts/sidebar-window.js",
      },
      {
        entryPoints: ["src/features/preferences/mountPreferencesApp.ts"],
        bundle: true,
        format: "iife",
        target: "firefox115",
        outfile: ".scaffold/build/addon/content/preferences.js",
      },
      {
        entryPoints: ["src/integrations/byok/runtime/serverEntry.ts"],
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node20",
        outfile: ".scaffold/build/addon/content/scripts/byok-runtime.cjs",
      },
    ],
  },

  release: {
    github: {
      releaseNote: (ctx) =>
        ctx.release.changelog.replace(
          /^(#{3,4})\s+(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?|\uFE0F|\u200D)+\s+/gmu,
          "$1 ",
        ),
    },
  },

  test: {
    entries: ["test/scaffold"],
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
    watch: false,
  },
});
