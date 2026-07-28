import { geckoIO, geckoPath } from "../../platform/gecko";

export {
  getDevelopmentPdfHelperCommand,
  getDevelopmentPdfHelperStatusPaths,
  isDevelopmentPdfHelper,
  isDevelopmentPdfHelperReady,
  type PdfHelperCommand,
};

type PdfHelperCommand = {
  command: string;
  argumentsPrefix: string[];
};

type DevelopmentPdfHelperPaths = {
  python: string;
  script: string;
  rootDir: string;
};

function isDevelopmentPdfHelper(): boolean {
  return typeof __env__ !== "undefined" && __env__ === "development";
}

function getDevelopmentPdfHelperStatusPaths(): DevelopmentPdfHelperPaths {
  if (!isDevelopmentPdfHelper()) {
    throw new Error("The development PDF helper is not active.");
  }
  const python =
    typeof __pdfHelperDevPython__ === "string"
      ? __pdfHelperDevPython__.trim()
      : "";
  const script =
    typeof __pdfHelperDevScript__ === "string"
      ? __pdfHelperDevScript__.trim()
      : "";
  if (!python || !script) {
    throw new Error("The development PDF helper paths were not configured.");
  }
  return {
    python,
    script,
    rootDir: geckoPath.parent(script) || script,
  };
}

async function isDevelopmentPdfHelperReady(): Promise<boolean> {
  const paths = getDevelopmentPdfHelperStatusPaths();
  const [pythonExists, scriptExists] = await Promise.all([
    geckoIO.exists(paths.python).catch(() => false),
    geckoIO.exists(paths.script).catch(() => false),
  ]);
  return pythonExists && scriptExists;
}

async function getDevelopmentPdfHelperCommand(): Promise<PdfHelperCommand> {
  const paths = getDevelopmentPdfHelperStatusPaths();
  if (!(await isDevelopmentPdfHelperReady())) {
    throw new Error(
      "The development PDF helper is unavailable. Run npm run start " +
        "to prepare its local Python environment.",
    );
  }
  return {
    command: paths.python,
    argumentsPrefix: [paths.script],
  };
}
