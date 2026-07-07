#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import platform as platform_module
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from pdf_helper_build_config import (
    PDF_HELPER_PACKAGE_NAME,
    SUPPORTED_PLATFORMS,
    assert_host_matches,
    entrypoint_name,
    helper_base_url,
    helper_version,
)


def main() -> int:
    args = parse_args()
    version = helper_version()
    base_url = helper_base_url(version)
    assert_host_matches(args.platform)

    root_dir = Path(__file__).resolve().parents[1]
    dist_dir = root_dir / "dist" / "pdf-helper"
    package_name = f"{PDF_HELPER_PACKAGE_NAME}-{args.platform}-v{version}"
    package_root = dist_dir / package_name
    build_venv = dist_dir / f"build-venv-{args.platform}-v{version}"
    pyinstaller_work = dist_dir / f"pyinstaller-work-{args.platform}-v{version}"
    pyinstaller_spec = dist_dir / f"pyinstaller-spec-{args.platform}-v{version}"
    archive_name = f"{package_name}.zip"
    archive_path = dist_dir / archive_name
    metadata_path = dist_dir / f"pdf-helper-artifact-{args.platform}.json"

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
    run([python, "-m", "pip", "install", "--upgrade", "pip"])
    run(
        [
            python,
            "-m",
            "pip",
            "install",
            "-r",
            str(root_dir / "helpers" / "pdf-helper" / "requirements.txt"),
        ],
    )
    run([python, "-m", "pip", "install", "pyinstaller"])
    run(
        [
            python,
            "-m",
            "PyInstaller",
            "--clean",
            "--noconfirm",
            "--onedir",
            "--name",
            PDF_HELPER_PACKAGE_NAME,
            "--distpath",
            str(package_root / "bin"),
            "--workpath",
            str(pyinstaller_work),
            "--specpath",
            str(pyinstaller_spec),
            str(root_dir / "helpers" / "pdf-helper" / "zopilot_pdf_helper.py"),
        ],
    )

    (package_root / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    write_zip(archive_path, dist_dir, package_root)
    sha256 = sha256_file(archive_path)
    size = archive_path.stat().st_size
    entrypoint = (
        f"{package_name}/bin/{PDF_HELPER_PACKAGE_NAME}/"
        f"{entrypoint_name(args.platform)}"
    )
    metadata = {
        "platform": args.platform,
        "fileName": archive_name,
        "url": f"{base_url}/{archive_name}",
        "sha256": sha256,
        "size": size,
        "entrypoint": entrypoint,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Built {archive_path}")
    print(f"Built {metadata_path}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Zopilot PDF helper ZIP")
    parser.add_argument("--platform", choices=SUPPORTED_PLATFORMS, required=True)
    return parser.parse_args()


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


def write_zip(archive_path: Path, dist_dir: Path, package_root: Path) -> None:
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(package_root.rglob("*")):
            zf.write(path, path.relative_to(dist_dir).as_posix())


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
