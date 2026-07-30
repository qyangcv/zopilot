from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "pdf_helper.py"
SPEC = importlib.util.spec_from_file_location("pdf_helper_build", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load the PDF helper build module.")
BUILD = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BUILD
SPEC.loader.exec_module(BUILD)


class PdfHelperBuildTests(unittest.TestCase):
    def test_reads_helper_package_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_path = Path(temp_dir) / "package.json"
            package_path.write_text(
                json.dumps(
                    {
                        "name": "example-helper",
                        "version": "1.2.3-beta.1",
                    }
                ),
                encoding="utf-8",
            )

            package = BUILD.read_helper_package(package_path)

        self.assertEqual(package.name, "example-helper")
        self.assertEqual(package.version, "1.2.3-beta.1")
        self.assertEqual(package.tag, "pdf-helper-v1.2.3-beta.1")

    def test_rejects_a_tag_that_does_not_match_the_package(self) -> None:
        package = BUILD.HelperPackage("example-helper", "1.2.3")

        with self.assertRaisesRegex(SystemExit, "tag/version mismatch"):
            BUILD.verify_release_tag(package, "pdf-helper-v1.2.4")

    def test_detects_supported_build_hosts(self) -> None:
        self.assertEqual(
            BUILD.host_platform("darwin", "arm64"),
            "macos-arm64",
        )
        self.assertEqual(
            BUILD.host_platform("darwin", "x86_64"),
            "macos-x64",
        )
        self.assertEqual(
            BUILD.host_platform("windows", "amd64"),
            "windows-x64",
        )
        self.assertIsNone(BUILD.host_platform("linux", "x86_64"))

    def test_assembles_and_validates_all_platform_artifacts(self) -> None:
        package = BUILD.HelperPackage("example-helper", "1.2.3")
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            artifacts_dir = root / "artifacts"
            output_dir = root / "release"
            for target in BUILD.SUPPORTED_PLATFORMS:
                platform_dir = artifacts_dir / target
                platform_dir.mkdir(parents=True)
                archive_path = (
                    platform_dir
                    / f"{BUILD.artifact_stem(package, target)}.zip"
                )
                archive_path.write_bytes(f"archive-{target}".encode())
                metadata = {
                    "schemaVersion": 1,
                    "version": package.version,
                    "artifact": BUILD.expected_artifact(
                        package,
                        target,
                        archive_path,
                    ),
                }
                (
                    platform_dir / BUILD.artifact_metadata_name(target)
                ).write_text(
                    json.dumps(metadata),
                    encoding="utf-8",
                )

            manifest_path = BUILD.assemble_release(
                package,
                artifacts_dir,
                output_dir,
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(manifest["schemaVersion"], 2)
        self.assertEqual(manifest["version"], package.version)
        self.assertEqual(
            [artifact["platform"] for artifact in manifest["artifacts"]],
            list(BUILD.SUPPORTED_PLATFORMS),
        )

    def test_rejects_artifacts_from_another_version(self) -> None:
        package = BUILD.HelperPackage("example-helper", "1.2.3")
        with tempfile.TemporaryDirectory() as temp_dir:
            artifacts_dir = Path(temp_dir)
            metadata_path = (
                artifacts_dir
                / BUILD.artifact_metadata_name("macos-arm64")
            )
            metadata_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "version": "9.9.9",
                        "artifact": {},
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(SystemExit, "Invalid PDF helper"):
                BUILD.validate_artifact_metadata(
                    package,
                    "macos-arm64",
                    metadata_path,
                )


if __name__ == "__main__":
    unittest.main()
