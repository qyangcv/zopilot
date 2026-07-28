#!/usr/bin/env python3
"""Build Zopilot document materials from a PDF attachment."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

HELPER_VERSION = "0.3.0"
EXCLUDED_LAYOUT_CLASSES = {"page-header", "page-footer"}
PICTURE_TEXT_COMMENTS = re.compile(
    r"<!--\s*(?:Start|End) of picture text\s*-->",
    re.IGNORECASE,
)
MAX_BLOCK_CHARS = 8_000


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
        import pymupdf
        import pymupdf4llm
    except Exception as exc:
        print(f"PyMuPDF4LLM import failed: {exc!r}", file=sys.stderr)
        return 1

    try:
        page_chunks = extract_page_chunks(
            pymupdf4llm,
            pdf_path,
            warnings,
        )
    except Exception as exc:
        print(f"PDF extraction failed: {exc!r}", file=sys.stderr)
        return 1

    pages, blocks = build_document_ir(page_chunks)
    outline = build_outline(page_chunks, blocks)

    try:
        document = pymupdf.open(str(pdf_path))
    except Exception as exc:
        print(f"PDF open failed: {exc!r}", file=sys.stderr)
        return 1

    try:
        if len(document) != len(pages):
            warnings.append(
                "The parser and renderer reported different page counts."
            )
        render_pages(document, pages, assets_dir, warnings, pymupdf)
    finally:
        document.close()

    markdown = "\n\n".join(page["text"] for page in pages).strip()
    plain_text = "\n\n".join(
        markdown_to_plain_text(str(block["text"]))
        for block in blocks
        if str(block["text"]).strip()
    ).strip()

    (out_dir / "paper.md").write_text(markdown, encoding="utf-8")
    (out_dir / "paper.txt").write_text(plain_text, encoding="utf-8")
    write_jsonl(out_dir / "pages.jsonl", pages)
    write_jsonl(out_dir / "blocks.jsonl", blocks)
    (out_dir / "outline.json").write_text(
        json.dumps(outline, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "parser-output.json").write_text(
        json.dumps(
            {
                "helperVersion": HELPER_VERSION,
                "extractor": "PyMuPDF4LLM",
                "extractorVersion": pymupdf4llm.version,
                "pageCount": len(pages),
                "warnings": warnings,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return 0


def extract_page_chunks(
    pymupdf4llm: Any,
    pdf_path: Path,
    warnings: list[str],
) -> list[dict[str, Any]]:
    primary = require_page_chunks(
        pymupdf4llm.to_markdown(
            str(pdf_path),
            page_chunks=True,
            header=False,
            footer=False,
            page_separators=False,
            show_progress=False,
            force_text=True,
            use_ocr=False,
            write_images=False,
            embed_images=False,
        )
    )
    missing_indexes = [
        index
        for index, chunk in enumerate(primary)
        if readable_character_count(str(chunk["text"])) < 24
    ]
    if not missing_indexes:
        return primary

    try:
        ocr_pages = require_page_chunks(
            pymupdf4llm.to_markdown(
                str(pdf_path),
                pages=missing_indexes,
                page_chunks=True,
                header=False,
                footer=False,
                page_separators=False,
                show_progress=False,
                force_text=True,
                use_ocr=True,
                write_images=False,
                embed_images=False,
            )
        )
    except Exception as exc:
        warnings.append(f"OCR fallback failed: {exc!r}")
        return primary

    by_page = {
        page_number_from_chunk(chunk, fallback): chunk
        for fallback, chunk in enumerate(ocr_pages, start=1)
    }
    used_pages: list[int] = []
    for index in missing_indexes:
        page_number = index + 1
        ocr_chunk = by_page.get(page_number)
        if ocr_chunk is None:
            continue
        if readable_character_count(str(ocr_chunk["text"])) <= (
            readable_character_count(str(primary[index]["text"]))
        ):
            continue
        primary[index] = ocr_chunk
        used_pages.append(page_number)
    if used_pages:
        warnings.append(
            "OCR fallback was used for pages "
            + ", ".join(str(page) for page in used_pages)
            + "."
        )
    return primary


def readable_character_count(value: str) -> int:
    return len(re.findall(r"[\w]", markdown_to_plain_text(value), re.UNICODE))


def require_page_chunks(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise TypeError("PyMuPDF4LLM did not return page chunks.")
    chunks: list[dict[str, Any]] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise TypeError(f"Invalid page chunk at page {index}.")
        if not isinstance(item.get("text"), str):
            raise TypeError(f"Missing page text at page {index}.")
        if not isinstance(item.get("page_boxes"), list):
            raise TypeError(f"Missing page layout at page {index}.")
        chunks.append(item)
    return chunks


def build_document_ir(
    page_chunks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pages: list[dict[str, Any]] = []
    blocks: list[dict[str, Any]] = []
    for fallback_page, chunk in enumerate(page_chunks, start=1):
        page_number = page_number_from_chunk(chunk, fallback_page)
        raw_page_text = str(chunk["text"])
        pages.append({"page": page_number, "text": raw_page_text.strip()})
        for fallback_index, raw_box in enumerate(chunk["page_boxes"]):
            if not isinstance(raw_box, dict):
                continue
            layout_class = str(raw_box.get("class", "text"))
            if layout_class in EXCLUDED_LAYOUT_CLASSES:
                continue
            text = text_for_box(raw_page_text, raw_box)
            if not text:
                continue
            raw_index = raw_box.get("index")
            box_index = (
                int(raw_index)
                if isinstance(raw_index, int) and raw_index >= 0
                else fallback_index
            )
            bbox = parse_bbox(raw_box.get("bbox"))
            heading_level = markdown_heading_level(text)
            text_parts = split_extracted_text(text)
            for part_index, text_part in enumerate(text_parts):
                block: dict[str, Any] = {
                    "id": (
                        f"p{page_number:04d}-b{box_index:04d}"
                        + (
                            f"-s{part_index + 1:03d}"
                            if len(text_parts) > 1
                            else ""
                        )
                    ),
                    "page": page_number,
                    "index": box_index * 1_000 + part_index,
                    "type": material_block_type(layout_class),
                    "text": text_part,
                }
                if bbox is not None:
                    block["bbox"] = bbox
                if (
                    part_index == 0
                    and layout_class == "section-header"
                    and heading_level is not None
                ):
                    block["headingLevel"] = heading_level
                blocks.append(block)
    blocks.sort(key=lambda block: (block["page"], block["index"]))
    return pages, blocks


def page_number_from_chunk(chunk: dict[str, Any], fallback: int) -> int:
    metadata = chunk.get("metadata")
    if isinstance(metadata, dict):
        value = metadata.get("page_number")
        if isinstance(value, int) and value > 0:
            return value
    return fallback


def text_for_box(page_text: str, box: dict[str, Any]) -> str:
    position = box.get("pos")
    if (
        not isinstance(position, (list, tuple))
        or len(position) != 2
        or not all(isinstance(value, int) for value in position)
    ):
        return ""
    start, end = position
    if start < 0 or end < start or end > len(page_text):
        return ""
    return normalize_extracted_markdown(page_text[start:end])


def normalize_extracted_markdown(value: str) -> str:
    return (
        PICTURE_TEXT_COMMENTS.sub("", value)
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .strip()
    )


def split_extracted_text(value: str) -> list[str]:
    if len(value) <= MAX_BLOCK_CHARS:
        return [value]
    parts: list[str] = []
    start = 0
    while start < len(value):
        target = min(len(value), start + MAX_BLOCK_CHARS)
        if target < len(value):
            lower_bound = max(start + 1, target - 1_500)
            boundary = max(
                value.rfind("\n\n", lower_bound, target),
                value.rfind("\n", lower_bound, target),
                value.rfind(" ", lower_bound, target),
            )
            if boundary >= lower_bound:
                target = boundary
        part = value[start:target].strip()
        if part:
            parts.append(part)
        start = max(target, start + 1)
        while start < len(value) and value[start].isspace():
            start += 1
    return parts


def material_block_type(layout_class: str) -> str:
    return {
        "title": "title",
        "section-header": "heading",
        "text": "paragraph",
        "list-item": "list",
        "caption": "caption",
        "table": "table",
        "formula": "equation",
        "footnote": "footnote",
        "picture": "figure",
    }.get(layout_class, "other")


def markdown_heading_level(value: str) -> int | None:
    match = re.match(r"^\s*(#{1,6})\s+", value)
    return len(match.group(1)) if match else None


def parse_bbox(value: object) -> list[float] | None:
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 4
        or not all(isinstance(item, (int, float)) for item in value)
    ):
        return None
    return [float(item) for item in value]


def build_outline(
    page_chunks: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    embedded = embedded_outline(page_chunks, blocks)
    if embedded:
        return {
            "status": "ready",
            "provenance": "embedded",
            "entries": embedded,
            "warnings": [],
        }

    inferred = layout_outline(blocks)
    if inferred:
        return {
            "status": "partial",
            "provenance": "inferred",
            "entries": inferred,
            "warnings": [
                "The PDF has no embedded outline; the outline comes from "
                "PyMuPDF4LLM layout analysis."
            ],
        }
    return {
        "status": "unavailable",
        "provenance": "unavailable",
        "entries": [],
        "warnings": ["The PDF has no usable embedded or layout outline."],
    }


def embedded_outline(
    page_chunks: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    raw_entries: list[tuple[int, str, int]] = []
    seen: set[tuple[int, str, int]] = set()
    for chunk in page_chunks:
        for raw in chunk.get("toc_items", []):
            if not isinstance(raw, (list, tuple)) or len(raw) < 3:
                continue
            level, title, page = raw[:3]
            if (
                not isinstance(level, int)
                or not isinstance(page, int)
                or level < 1
                or page < 1
            ):
                continue
            normalized_title = str(title).strip()
            if not normalized_title:
                continue
            key = (level, normalized_title, page)
            if key in seen:
                continue
            seen.add(key)
            raw_entries.append(key)

    entries: list[dict[str, Any]] = []
    for index, (level, title, page) in enumerate(raw_entries, start=1):
        entries.append(
            {
                "id": f"section-{index:04d}",
                "title": title,
                "level": min(6, level),
                "page": page,
                "blockId": matching_heading_block_id(blocks, page, title),
                "provenance": "embedded",
            }
        )
    return entries


def layout_outline(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    headings = [
        block
        for block in blocks
        if block["type"] == "heading"
        and markdown_to_plain_text(str(block["text"]))
    ]
    if not headings:
        return []
    levels = [
        level
        for block in headings
        if isinstance((level := block.get("headingLevel")), int)
    ]
    level_offset = max(0, min(levels, default=1) - 1)
    entries: list[dict[str, Any]] = []
    for block in headings:
        title = markdown_to_plain_text(str(block["text"]))
        raw_level = block.get("headingLevel")
        level = raw_level if isinstance(raw_level, int) else 1
        numbered_level = numbered_heading_level(title)
        entries.append(
            {
                "id": f"section-{len(entries) + 1:04d}",
                "title": title,
                "level": min(
                    6,
                    max(
                        1,
                        numbered_level
                        if numbered_level is not None
                        else level - level_offset,
                    ),
                ),
                "page": block["page"],
                "blockId": block["id"],
                "provenance": "inferred",
            }
        )
    return entries


def numbered_heading_level(value: str) -> int | None:
    match = re.match(r"^\s*(\d+(?:\.\d+)*)[.)]?\s+\S", value)
    return len(match.group(1).split(".")) if match else None


def matching_heading_block_id(
    blocks: list[dict[str, Any]],
    page: int,
    title: str,
) -> str | None:
    normalized_title = normalize_for_match(title)
    page_blocks = [block for block in blocks if block["page"] == page]
    for block in page_blocks:
        block_text = normalize_for_match(
            markdown_to_plain_text(str(block["text"]))
        )
        if normalized_title and (
            normalized_title == block_text
            or normalized_title in block_text
            or block_text in normalized_title
        ):
            return str(block["id"])
    return str(page_blocks[0]["id"]) if page_blocks else None


def normalize_for_match(value: str) -> str:
    return re.sub(r"[^\w]+", " ", value, flags=re.UNICODE).strip().casefold()


def markdown_to_plain_text(value: str) -> str:
    text = re.sub(r"<!--[\s\S]*?-->", " ", value)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~`]+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def render_pages(
    document: Any,
    pages: list[dict[str, Any]],
    assets_dir: Path,
    warnings: list[str],
    pymupdf: Any,
) -> None:
    pages_by_number = {page["page"]: page for page in pages}
    for page_number, pdf_page in enumerate(document, start=1):
        material_page = pages_by_number.get(page_number)
        if material_page is None:
            continue
        image_path = assets_dir / f"page-{page_number:04d}.png"
        try:
            pixmap = pdf_page.get_pixmap(
                matrix=pymupdf.Matrix(1.5, 1.5),
                alpha=False,
            )
            pixmap.save(str(image_path))
            material_page["imagePath"] = str(image_path)
        except Exception as exc:
            warnings.append(
                f"Page render failed for page {page_number}: {exc!r}"
            )


def write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as file:
        for value in values:
            file.write(json.dumps(value, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
