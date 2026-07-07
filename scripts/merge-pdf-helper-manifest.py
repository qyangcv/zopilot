#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path

SUPPORTED_PLATFORMS = ("macos-arm64", "macos-x64", "windows-x64")


def main() -> int:
    root_dir = Path(__file__).resolve().parents[1]
    dist_dir = root_dir / "dist" / "pdf-helper"
    version = os.environ.get("ZOPILOT_PDF_HELPER_VERSION", "0.2.0")
    artifacts = []
    for platform in SUPPORTED_PLATFORMS:
        path = dist_dir / f"pdf-helper-artifact-{platform}.json"
        if not path.exists():
            raise SystemExit(f"Missing PDF helper artifact metadata: {path}")
        artifacts.append(json.loads(path.read_text(encoding="utf-8")))
    manifest = {
        "schemaVersion": 2,
        "version": version,
        "artifacts": artifacts,
    }
    output_path = dist_dir / "pdf-helper-manifest.json"
    output_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Built {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
