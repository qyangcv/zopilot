# PDF Helper Distribution

Zopilot distributes the PDF parser as a private helper runtime instead of
installing Python packages into the user's system environment.

## Current Target

- Platform: `macos-arm64`
- Helper version: `0.1.0`
- Python dependency: `pymupdf==1.28.0`
- Excluded for now: `pymupdf4llm`, `pymupdf-layout`
- Packaging: PyInstaller `onedir` bundle. Users do not need a system Python.

## Build

```sh
npm run build:pdf-helper:macos-arm64
```

The script writes:

- `dist/pdf-helper/zopilot-pdf-helper-macos-arm64-v0.1.0.tar.gz`
- `dist/pdf-helper/pdf-helper-manifest.json`

## Release

Upload both files to a GitHub release named:

```text
pdf-helper-v0.1.0
```

The plugin downloads:

```text
https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v0.1.0/pdf-helper-manifest.json
```

The manifest points to the platform archive and includes its SHA256. The plugin
verifies the archive before extracting it into the Zotero profile directory.
