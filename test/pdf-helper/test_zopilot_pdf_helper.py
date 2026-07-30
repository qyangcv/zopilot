from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELPER_PATH = ROOT / "helpers" / "pdf-helper" / "zopilot_pdf_helper.py"
SPEC = importlib.util.spec_from_file_location("zopilot_pdf_helper", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the PDF helper.")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)


class DocumentIrTests(unittest.TestCase):
    def test_reports_the_package_version(self) -> None:
        package = json.loads(
            (ROOT / "helpers" / "pdf-helper" / "package.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(HELPER.HELPER_VERSION, package["version"])

    def test_uses_layout_boxes_as_the_document_structure(self) -> None:
        text = (
            "ignored header"
            "\n\n## **1 Methods**\n\n"
            "The method preserves word spacing."
            "\n\n|A|B|\n|---|---|\n|1|2|"
        )
        heading_start = text.index("##")
        paragraph_start = text.index("The method")
        table_start = text.index("|A|")
        chunks = [
            {
                "metadata": {"page_number": 1},
                "text": text,
                "toc_items": [],
                "page_boxes": [
                    {
                        "index": 0,
                        "class": "page-header",
                        "bbox": [0, 0, 10, 10],
                        "pos": [0, heading_start],
                    },
                    {
                        "index": 1,
                        "class": "section-header",
                        "bbox": [10, 20, 200, 40],
                        "pos": [heading_start, paragraph_start],
                    },
                    {
                        "index": 2,
                        "class": "text",
                        "bbox": [10, 50, 200, 100],
                        "pos": [paragraph_start, table_start],
                    },
                    {
                        "index": 3,
                        "class": "table",
                        "bbox": [10, 110, 200, 180],
                        "pos": [table_start, len(text)],
                    },
                ],
            }
        ]

        pages, blocks = HELPER.build_document_ir(chunks)
        outline = HELPER.build_outline(chunks, blocks)

        self.assertEqual(pages[0]["page"], 1)
        self.assertEqual(
            [block["type"] for block in blocks],
            ["heading", "paragraph", "table"],
        )
        self.assertEqual(outline["provenance"], "inferred")
        self.assertEqual(outline["entries"][0]["title"], "1 Methods")
        self.assertEqual(outline["entries"][0]["level"], 1)

    def test_prefers_the_embedded_outline(self) -> None:
        chunks = [
            {
                "metadata": {"page_number": 1},
                "text": "# Layout title",
                "toc_items": [[1, "Embedded title", 1]],
                "page_boxes": [
                    {
                        "index": 0,
                        "class": "section-header",
                        "bbox": [0, 0, 100, 20],
                        "pos": [0, 14],
                    }
                ],
            }
        ]
        _, blocks = HELPER.build_document_ir(chunks)

        outline = HELPER.build_outline(chunks, blocks)

        self.assertEqual(outline["status"], "ready")
        self.assertEqual(outline["provenance"], "embedded")
        self.assertEqual(outline["entries"][0]["title"], "Embedded title")

    def test_splits_oversized_layout_boxes_without_losing_text(self) -> None:
        text = ("word " * 4_000).strip()
        chunks = [
            {
                "metadata": {"page_number": 1},
                "text": text,
                "toc_items": [],
                "page_boxes": [
                    {
                        "index": 0,
                        "class": "text",
                        "bbox": [0, 0, 100, 100],
                        "pos": [0, len(text)],
                    }
                ],
            }
        ]

        _, blocks = HELPER.build_document_ir(chunks)

        self.assertGreater(len(blocks), 1)
        self.assertTrue(all(len(block["text"]) <= HELPER.MAX_BLOCK_CHARS for block in blocks))
        self.assertEqual(
            " ".join(block["text"] for block in blocks).split(),
            text.split(),
        )


if __name__ == "__main__":
    unittest.main()
