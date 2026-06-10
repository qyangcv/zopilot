import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { transformSync } from "esbuild";

export function resolve(specifier, context, defaultResolve) {
  if (
    context.parentURL?.startsWith("file:") &&
    specifier.startsWith(".") &&
    !specifier.match(/\.[cm]?[jt]s$/u)
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const tsPath = resolvePath(dirname(parentPath), `${specifier}.ts`);
    if (existsSync(tsPath)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(tsPath).href,
      };
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export function load(url, context, defaultLoad) {
  if (url.endsWith("/package.json") && !url.includes("/node_modules/")) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const value = JSON.parse(source);
    const namedExports = Object.keys(value)
      .filter((key) => /^[A-Za-z_$][\w$]*$/u.test(key))
      .map((key) => `export const ${key} = __json[${JSON.stringify(key)}];`)
      .join("\n");

    return {
      format: "module",
      shortCircuit: true,
      source: [
        `const __json = ${JSON.stringify(value)};`,
        "export default __json;",
        namedExports,
      ].join("\n"),
    };
  }

  if (!url.endsWith(".ts")) {
    return defaultLoad(url, context, defaultLoad);
  }

  const source = readFileSync(fileURLToPath(url), "utf8");
  const result = transformSync(source, {
    format: "esm",
    loader: "ts",
    sourcemap: "inline",
    target: "es2022",
  });

  return {
    format: "module",
    shortCircuit: true,
    source: result.code,
  };
}
