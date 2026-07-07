#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform as platform_module
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

SUPPORTED_PLATFORMS = ("macos-arm64", "macos-x64", "windows-x64")


def main() -> int:
    args = parse_args()
    helper_version = os.environ.get("ZOPILOT_PDF_HELPER_VERSION", "0.2.0")
    base_url = os.environ.get(
        "ZOPILOT_PDF_HELPER_BASE_URL",
        f"https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v{helper_version}",
    )
    assert_host_matches(args.platform)

    root_dir = Path(__file__).resolve().parents[1]
    dist_dir = root_dir / "dist" / "pdf-helper"
    package_name = f"zopilot-pdf-helper-{args.platform}-v{helper_version}"
    package_root = dist_dir / package_name
    build_venv = dist_dir / f"build-venv-{args.platform}-v{helper_version}"
    pyinstaller_work = dist_dir / f"pyinstaller-work-{args.platform}-v{helper_version}"
    pyinstaller_spec = dist_dir / f"pyinstaller-spec-{args.platform}-v{helper_version}"
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
            "zopilot-pdf-helper",
            "--distpath",
            str(package_root / "bin"),
            "--workpath",
            str(pyinstaller_work),
            "--specpath",
            str(pyinstaller_spec),
            str(root_dir / "helpers" / "pdf-helper" / "zopilot_pdf_helper.py"),
        ],
    )

    (package_root / "VERSION").write_text(f"{helper_version}\n", encoding="utf-8")
    write_zip(archive_path, dist_dir, package_root)
    sha256 = sha256_file(archive_path)
    size = archive_path.stat().st_size
    metadata = {
        "platform": args.platform,
        "fileName": archive_name,
        "url": f"{base_url}/{archive_name}",
        "sha256": sha256,
        "size": size,
        "entrypoint": f"{package_name}/bin/zopilot-pdf-helper/{entrypoint_name(args.platform)}",
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Built {archive_path}")
    print(f"Built {metadata_path}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a Zopilot PDF helper ZIP")
    parser.add_argument("--platform", choices=SUPPORTED_PLATFORMS, required=True)
    return parser.parse_args()


def assert_host_matches(target: str) -> None:
    system = platform_module.system().lower()
    machine = platform_module.machine().lower()
    actual = None
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        actual = "macos-arm64"
    elif system == "darwin" and machine in {"x86_64", "amd64"}:
        actual = "macos-x64"
    elif system == "windows" and machine in {"amd64", "x86_64"}:
        actual = "windows-x64"
    if actual != target:
        raise SystemExit(
            f"Cannot build {target} on host {system}/{machine}. "
            "PyInstaller builds must run on the target platform.",
        )


def create_venv(path: Path) -> None:
    run([sys.executable, "-m", "venv", str(path)])


def venv_python(path: Path) -> str:
    if platform_module.system().lower() == "windows":
        return str(path / "Scripts" / "python.exe")
    return str(path / "bin" / "python")


def entrypoint_name(target: str) -> str:
    return "zopilot-pdf-helper.exe" if target == "windows-x64" else "zopilot-pdf-helper"


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
