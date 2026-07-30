#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import platform as platform_module
import re
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[1]
HELPER_DIR = ROOT_DIR / "helpers" / "pdf-helper"
HELPER_PACKAGE_PATH = HELPER_DIR / "package.json"
DEFAULT_DIST_DIR = ROOT_DIR / "dist" / "pdf-helper"
SUPPORTED_PLATFORMS = ("macos-arm64", "macos-x64", "windows-x64")
RELEASES_BASE_URL = "https://github.com/qyangcv/zopilot/releases/download"
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


@dataclass(frozen=True)
class HelperPackage:
    name: str
    version: str

    @property
    def tag(self) -> str:
        return f"pdf-helper-v{self.version}"

    @property
    def base_url(self) -> str:
        return f"{RELEASES_BASE_URL}/{self.tag}"


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    package = read_helper_package()

    if args.command == "build":
        target = (
            current_host_platform()
            if args.platform == "auto"
            else args.platform
        )
        if not target:
            system = platform_module.system().lower()
            machine = platform_module.machine().lower()
            raise SystemExit(
                f"Unsupported PDF helper build host: {system}/{machine}"
            )
        build_helper(package, target, args.dist_dir)
        return 0

    if args.command == "manifest":
        assemble_release(
            package,
            artifacts_dir=args.artifacts_dir,
            output_dir=args.output_dir,
        )
        return 0

    if args.command == "version":
        print(package.version)
        return 0

    if args.command == "verify-tag":
        verify_release_tag(package, args.tag)
        print(f"Verified {args.tag}")
        return 0

    raise AssertionError(f"Unhandled command: {args.command}")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and assemble Zopilot PDF helper releases"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    build = commands.add_parser("build", help="Build one native helper archive")
    build.add_argument(
        "--platform",
        choices=("auto", *SUPPORTED_PLATFORMS),
        default="auto",
    )
    build.add_argument(
        "--dist-dir",
        type=Path,
        default=DEFAULT_DIST_DIR,
    )

    manifest = commands.add_parser(
        "manifest",
        help="Validate platform artifacts and assemble a release manifest",
    )
    manifest.add_argument(
        "--artifacts-dir",
        type=Path,
        default=DEFAULT_DIST_DIR,
    )
    manifest.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_DIST_DIR,
    )

    commands.add_parser("version", help="Print the configured helper version")

    verify_tag = commands.add_parser(
        "verify-tag",
        help="Verify a release tag against the configured version",
    )
    verify_tag.add_argument("tag")

    return parser.parse_args(argv)


def read_helper_package(
    path: Path = HELPER_PACKAGE_PATH,
) -> HelperPackage:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Unable to read PDF helper package: {path}") from error

    if not isinstance(raw, dict):
        raise SystemExit(f"Invalid PDF helper package: {path}")

    name = raw.get("name")
    version = raw.get("version")
    if not isinstance(name, str) or not name.strip():
        raise SystemExit(f"Invalid PDF helper package name: {path}")
    if not isinstance(version, str) or not SEMVER_PATTERN.fullmatch(version):
        raise SystemExit(f"Invalid PDF helper package version: {path}")
    return HelperPackage(name=name, version=version)


def verify_release_tag(package: HelperPackage, tag: str) -> None:
    if tag != package.tag:
        raise SystemExit(
            f"PDF helper tag/version mismatch: expected {package.tag}, got {tag}"
        )


def current_host_platform() -> str | None:
    return host_platform(
        platform_module.system().lower(),
        platform_module.machine().lower(),
    )


def host_platform(system: str, machine: str) -> str | None:
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "macos-arm64"
    if system == "darwin" and machine in {"x86_64", "amd64"}:
        return "macos-x64"
    if system == "windows" and machine in {"amd64", "x86_64"}:
        return "windows-x64"
    return None


def assert_host_matches(target: str) -> None:
    system = platform_module.system().lower()
    machine = platform_module.machine().lower()
    actual = host_platform(system, machine)
    if actual != target:
        raise SystemExit(
            f"Cannot build {target} on host {system}/{machine}. "
            "PyInstaller builds must run on the target platform."
        )


def build_helper(
    package: HelperPackage,
    target: str,
    dist_dir: Path,
) -> None:
    assert_host_matches(target)
    package_name = artifact_stem(package, target)
    package_root = dist_dir / package_name
    build_venv = dist_dir / f"build-venv-{target}-v{package.version}"
    pyinstaller_work = (
        dist_dir / f"pyinstaller-work-{target}-v{package.version}"
    )
    pyinstaller_spec = (
        dist_dir / f"pyinstaller-spec-{target}-v{package.version}"
    )
    archive_path = dist_dir / f"{package_name}.zip"
    metadata_path = dist_dir / artifact_metadata_name(target)

    for path in (
        package_root,
        build_venv,
        pyinstaller_work,
        pyinstaller_spec,
        archive_path,
        metadata_path,
    ):
        remove_path(path)
    package_root.mkdir(parents=True, exist_ok=True)
    dist_dir.mkdir(parents=True, exist_ok=True)

    create_venv(build_venv)
    python = venv_python(build_venv)
    run(
        [
            python,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            str(HELPER_DIR / "requirements-build.txt"),
        ]
    )
    run(
        [
            python,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            "--onedir",
            "--name",
            package.name,
            "--collect-all",
            "pymupdf",
            "--collect-all",
            "pymupdf4llm",
            "--distpath",
            str(package_root / "bin"),
            "--workpath",
            str(pyinstaller_work),
            "--specpath",
            str(pyinstaller_spec),
            str(HELPER_DIR / "zopilot_pdf_helper.py"),
        ]
    )

    (package_root / "VERSION").write_text(
        f"{package.version}\n",
        encoding="utf-8",
    )
    write_zip(archive_path, dist_dir, package_root)
    artifact = expected_artifact(package, target, archive_path)
    metadata = {
        "schemaVersion": 1,
        "version": package.version,
        "artifact": artifact,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built {archive_path}")
    print(f"Built {metadata_path}")


def assemble_release(
    package: HelperPackage,
    artifacts_dir: Path,
    output_dir: Path,
) -> Path:
    metadata_by_platform = discover_artifact_metadata(artifacts_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []

    for target in SUPPORTED_PLATFORMS:
        metadata_path = metadata_by_platform.get(target)
        if not metadata_path:
            raise SystemExit(
                f"Missing PDF helper artifact metadata for {target}"
            )
        artifact, archive_path = validate_artifact_metadata(
            package,
            target,
            metadata_path,
        )
        destination = output_dir / artifact["fileName"]
        if archive_path.resolve() != destination.resolve():
            shutil.copy2(archive_path, destination)
        artifacts.append(artifact)

    manifest = {
        "schemaVersion": 2,
        "version": package.version,
        "artifacts": artifacts,
    }
    output_path = output_dir / "pdf-helper-manifest.json"
    output_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built {output_path}")
    return output_path


def discover_artifact_metadata(
    artifacts_dir: Path,
) -> dict[str, Path]:
    discovered: dict[str, Path] = {}
    for path in artifacts_dir.rglob("pdf-helper-artifact-*.json"):
        target = path.stem.removeprefix("pdf-helper-artifact-")
        if target not in SUPPORTED_PLATFORMS:
            raise SystemExit(f"Unsupported PDF helper artifact: {path}")
        if target in discovered:
            raise SystemExit(
                f"Duplicate PDF helper artifact metadata for {target}"
            )
        discovered[target] = path
    return discovered


def validate_artifact_metadata(
    package: HelperPackage,
    target: str,
    metadata_path: Path,
) -> tuple[dict[str, Any], Path]:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(
            f"Unable to read PDF helper artifact metadata: {metadata_path}"
        ) from error

    if (
        not isinstance(metadata, dict)
        or metadata.get("schemaVersion") != 1
        or metadata.get("version") != package.version
        or not isinstance(metadata.get("artifact"), dict)
    ):
        raise SystemExit(
            f"Invalid PDF helper artifact metadata: {metadata_path}"
        )

    artifact = metadata["artifact"]
    expected_name = f"{artifact_stem(package, target)}.zip"
    expected_entrypoint = (
        f"{artifact_stem(package, target)}/bin/{package.name}/"
        f"{entrypoint_name(package, target)}"
    )
    expected_values = {
        "platform": target,
        "fileName": expected_name,
        "url": f"{package.base_url}/{expected_name}",
        "entrypoint": expected_entrypoint,
    }
    for key, expected in expected_values.items():
        if artifact.get(key) != expected:
            raise SystemExit(
                f"Invalid {key} in PDF helper artifact metadata: "
                f"{metadata_path}"
            )

    archive_path = metadata_path.parent / expected_name
    if not archive_path.is_file():
        raise SystemExit(f"Missing PDF helper artifact archive: {archive_path}")
    if artifact.get("size") != archive_path.stat().st_size:
        raise SystemExit(
            f"Invalid size in PDF helper artifact metadata: {metadata_path}"
        )
    if artifact.get("sha256") != sha256_file(archive_path):
        raise SystemExit(
            f"Invalid sha256 in PDF helper artifact metadata: {metadata_path}"
        )
    return artifact, archive_path


def expected_artifact(
    package: HelperPackage,
    target: str,
    archive_path: Path,
) -> dict[str, Any]:
    file_name = archive_path.name
    return {
        "platform": target,
        "fileName": file_name,
        "url": f"{package.base_url}/{file_name}",
        "sha256": sha256_file(archive_path),
        "size": archive_path.stat().st_size,
        "entrypoint": (
            f"{artifact_stem(package, target)}/bin/{package.name}/"
            f"{entrypoint_name(package, target)}"
        ),
    }


def artifact_stem(package: HelperPackage, target: str) -> str:
    return f"{package.name}-{target}-v{package.version}"


def artifact_metadata_name(target: str) -> str:
    return f"pdf-helper-artifact-{target}.json"


def entrypoint_name(package: HelperPackage, target: str) -> str:
    return f"{package.name}.exe" if target == "windows-x64" else package.name


def create_venv(path: Path) -> None:
    run([sys.executable, "-m", "venv", str(path)])


def venv_python(path: Path) -> str:
    if platform_module.system().lower() == "windows":
        return str(path / "Scripts" / "python.exe")
    return str(path / "bin" / "python")


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def remove_path(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def write_zip(
    archive_path: Path,
    dist_dir: Path,
    package_root: Path,
) -> None:
    with zipfile.ZipFile(
        archive_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        for path in sorted(package_root.rglob("*")):
            archive.write(path, path.relative_to(dist_dir).as_posix())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
