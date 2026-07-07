#!/usr/bin/env python3
"""Build Zopilot PDF material files from a PDF attachment."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HELPER_VERSION = "0.2.0"


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            "usage: zopilot-pdf-helper <pdf-path> <output-dir>",
            file=sys.stderr,
        )
        return 2

    pdf_path = Path(argv[1])
    out_dir = Path(argv[2])
    assets_dir = out_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []

    try:
        try:
            import pymupdf as fitz
        except Exception:
            import fitz  # type: ignore[no-redef]
    except Exception as exc:
        print(f"PyMuPDF import failed: {exc!r}", file=sys.stderr)
        return 1

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        print(f"PDF open failed: {exc!r}", file=sys.stderr)
        return 1

    pages: list[dict[str, object]] = []
    texts: list[str] = []
    markdown_parts: list[str] = []

    for index, page in enumerate(doc, start=1):
        try:
            text = page.get_text("text") or ""
        except Exception as exc:
            text = ""
            warnings.append(f"Text extraction failed for page {index}: {exc!r}")

        texts.append(text)
        markdown_parts.append(f"# Page {index}\n\n{text}".rstrip())

        image_path: str | None = str(assets_dir / f"page-{index:04d}.png")
        try:
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            pix.save(image_path)
        except Exception as exc:
            image_path = None
            warnings.append(f"Page render failed for page {index}: {exc!r}")

        pages.append({"page": index, "text": text, "imagePath": image_path})

    (out_dir / "paper.md").write_text(
        "\n\n".join(markdown_parts),
        encoding="utf-8",
    )
    (out_dir / "paper.txt").write_text(
        "\n\n".join(texts),
        encoding="utf-8",
    )
    with (out_dir / "pages.jsonl").open("w", encoding="utf-8") as fh:
        for page in pages:
            fh.write(json.dumps(page, ensure_ascii=False) + "\n")
    (out_dir / "parser-output.json").write_text(
        json.dumps(
            {
                "helperVersion": HELPER_VERSION,
                "pageCount": len(doc),
                "warnings": warnings,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
