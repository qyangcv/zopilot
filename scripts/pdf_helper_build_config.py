from __future__ import annotations

import os
import platform as platform_module

DEFAULT_HELPER_VERSION = "0.2.0"
PDF_HELPER_PACKAGE_NAME = "zopilot-pdf-helper"
SUPPORTED_PLATFORMS = ("macos-arm64", "macos-x64", "windows-x64")


def helper_version() -> str:
    return os.environ.get("ZOPILOT_PDF_HELPER_VERSION", DEFAULT_HELPER_VERSION)


def helper_base_url(version: str) -> str:
    return os.environ.get(
        "ZOPILOT_PDF_HELPER_BASE_URL",
        f"https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v{version}",
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
            "PyInstaller builds must run on the target platform.",
        )


def entrypoint_name(target: str) -> str:
    return (
        f"{PDF_HELPER_PACKAGE_NAME}.exe"
        if target == "windows-x64"
        else PDF_HELPER_PACKAGE_NAME
    )
