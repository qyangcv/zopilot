#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_VERSION="${ZOPILOT_PDF_HELPER_VERSION:-0.1.0}"
PLATFORM="macos-arm64"
DIST_DIR="$ROOT_DIR/dist/pdf-helper"
PACKAGE_ROOT="$DIST_DIR/zopilot-pdf-helper-$PLATFORM-v$HELPER_VERSION"
BUILD_VENV="$DIST_DIR/build-venv-$PLATFORM-v$HELPER_VERSION"
PYINSTALLER_WORK="$DIST_DIR/pyinstaller-work-$PLATFORM-v$HELPER_VERSION"
PYINSTALLER_SPEC="$DIST_DIR/pyinstaller-spec-$PLATFORM-v$HELPER_VERSION"
ARCHIVE_NAME="zopilot-pdf-helper-$PLATFORM-v$HELPER_VERSION.tar.gz"
ARCHIVE_PATH="$DIST_DIR/$ARCHIVE_NAME"
BASE_URL="${ZOPILOT_PDF_HELPER_BASE_URL:-https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v$HELPER_VERSION}"

rm -rf "$PACKAGE_ROOT" "$BUILD_VENV" "$PYINSTALLER_WORK" "$PYINSTALLER_SPEC" "$ARCHIVE_PATH"
mkdir -p "$PACKAGE_ROOT" "$DIST_DIR"

python3 -m venv "$BUILD_VENV"
"$BUILD_VENV/bin/python" -m pip install --upgrade pip
"$BUILD_VENV/bin/python" -m pip install -r "$ROOT_DIR/helpers/pdf-helper/requirements-macos-arm64.txt"
"$BUILD_VENV/bin/python" -m pip install pyinstaller

"$BUILD_VENV/bin/python" -m PyInstaller \
  --clean \
  --noconfirm \
  --onedir \
  --name zopilot-pdf-helper \
  --distpath "$PACKAGE_ROOT/bin" \
  --workpath "$PYINSTALLER_WORK" \
  --specpath "$PYINSTALLER_SPEC" \
  "$ROOT_DIR/helpers/pdf-helper/zopilot_pdf_helper.py"

cat > "$PACKAGE_ROOT/VERSION" <<EOF
$HELPER_VERSION
EOF

(
  cd "$DIST_DIR"
  tar -czf "$ARCHIVE_NAME" "zopilot-pdf-helper-$PLATFORM-v$HELPER_VERSION"
)

SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
SIZE="$(wc -c < "$ARCHIVE_PATH" | tr -d ' ')"

cat > "$DIST_DIR/pdf-helper-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "version": "$HELPER_VERSION",
  "artifacts": [
    {
      "platform": "$PLATFORM",
      "fileName": "$ARCHIVE_NAME",
      "url": "$BASE_URL/$ARCHIVE_NAME",
      "sha256": "$SHA256",
      "size": $SIZE,
      "entrypoint": "zopilot-pdf-helper-$PLATFORM-v$HELPER_VERSION/bin/zopilot-pdf-helper/zopilot-pdf-helper"
    }
  ]
}
EOF

echo "Built $ARCHIVE_PATH"
echo "Built $DIST_DIR/pdf-helper-manifest.json"
