import helperPackage from "../../../helpers/pdf-helper/package.json";

export { PDF_HELPER_MANIFEST_URL, PDF_HELPER_PACKAGE_NAME, PDF_HELPER_VERSION };

const PDF_HELPER_VERSION = helperPackage.version;
const PDF_HELPER_MANIFEST_URL = `https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v${PDF_HELPER_VERSION}/pdf-helper-manifest.json`;
const PDF_HELPER_PACKAGE_NAME = helperPackage.name;
